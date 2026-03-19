import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import AppLayout from "@/components/AppLayout";
import { PageHeader, SectionCard, SourceBadge, StatusBadge } from "@/components/platform/components";
import { workers as mockWorkers } from "@/data/platformMock";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/+$/, "");

type QueuePayload = {
  rpi: { counts?: { processing: number; errors: number; success: number } };
  docs: { counts?: { processing: number; errors: number; success: number } };
  ops: { counts?: { processing: number; errors: number; success: number } };
  inpi: { counts?: { processing: number; errors: number; success: number } };
  bigquery: { counts?: { processing: number; errors: number; success: number } };
};

export default function OperationsWorkers() {
  const [queues, setQueues] = useState<QueuePayload | null>(null);
  const [lastSync, setLastSync] = useState<string>("agora");
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const result = await axios.get(`${API_URL}/background-workers/queues?limit=20`);
      setQueues(result.data);
      setLastSync(new Date().toLocaleString("pt-BR"));
    } catch {
      setQueues(null);
      setLastSync("fallback mock");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const allWorkers = useMemo(
    () =>
      mockWorkers.map((worker) => {
        const fromQueue = queues?.[worker.queue as keyof QueuePayload]?.counts;
        return {
          ...worker,
          pending: fromQueue?.processing ?? worker.pending,
          failures: fromQueue?.errors ?? worker.failures,
          success: fromQueue?.success ?? 0,
        };
      }),
    [queues],
  );

  return (
    <AppLayout>
      <PageHeader
        title="Background Workers"
        subtitle="Painel obrigatório com dados de todos os workers, filas e falhas."
        breadcrumbs={[{ label: "Operações" }, { label: "Background Workers" }]}
        actions={
          <>
            <Button variant="outline" onClick={refresh} disabled={loading}>Atualizar</Button>
            <Button asChild className="bg-slate-900 hover:bg-slate-800"><a href="/monitoring/background-workers">Abrir painel avançado</a></Button>
          </>
        }
      />

      <section className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <Kpi title="Workers online" value={String(allWorkers.filter((item) => item.online).length)} />
        <Kpi title="Jobs pendentes" value={String(allWorkers.reduce((acc, item) => acc + item.pending, 0))} />
        <Kpi title="Última sincronização RPI" value="#2819" />
        <Kpi title="Falhas" value={String(allWorkers.reduce((acc, item) => acc + item.failures, 0))} />
        <Kpi title="Tempo médio" value={`${Math.round(allWorkers.reduce((acc, item) => acc + item.avgSeconds, 0) / allWorkers.length)}s`} />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <SectionCard title="Todos os workers" className="xl:col-span-7" description={`Atualizado em ${lastSync}`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Worker</TableHead>
                <TableHead>Fila</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pendentes</TableHead>
                <TableHead>Sucesso</TableHead>
                <TableHead>Falhas</TableHead>
                <TableHead>Última execução</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allWorkers.map((worker) => (
                <TableRow key={worker.queue}>
                  <TableCell className="font-medium">{worker.name}</TableCell>
                  <TableCell><SourceBadge label={worker.queue} /></TableCell>
                  <TableCell><StatusBadge label={worker.online ? "online" : "offline"} variant={worker.online ? "stable" : "critical"} /></TableCell>
                  <TableCell>{worker.pending}</TableCell>
                  <TableCell>{worker.success}</TableCell>
                  <TableCell>{worker.failures}</TableCell>
                  <TableCell>{worker.lastRun}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
        <SectionCard title="Saúde dos pipelines" className="xl:col-span-5">
          <div className="space-y-2">
            {allWorkers.map((worker) => (
              <div key={worker.name} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span>{worker.name}</span>
                  <StatusBadge label={worker.online ? "estável" : "incidente"} variant={worker.online ? "stable" : "critical"} />
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded bg-slate-100">
                  <div className="h-full bg-cyan-600" style={{ width: `${Math.max(5, 100 - worker.failures * 8)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>
    </AppLayout>
  );
}

function Kpi({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
