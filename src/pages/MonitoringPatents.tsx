import { useMemo, useState } from "react";
import { ArrowRightLeft, Download, Filter, UserPlus } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import {
  DetailDrawer,
  FilterBar,
  PageHeader,
  RiskBadge,
  ScoreBadge,
  SectionCard,
  SecondaryToolbar,
  StatusBadge,
  TypeBadge,
} from "@/components/platform/components";
import { collisions } from "@/data/platformMock";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ViewMode = "tabela" | "kanban";

export default function MonitoringPatents() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("tabela");
  const [filters, setFilters] = useState({
    client: "",
    status: "",
    score: "",
    risk: "",
    owner: "",
    inventor: "",
    period: "",
    ipc: "",
  });

  const filtered = useMemo(
    () =>
      collisions.filter(
        (item) =>
          (!filters.client || item.client.toLowerCase().includes(filters.client.toLowerCase())) &&
          (!filters.status || item.status === filters.status) &&
          (!filters.risk || item.risk === filters.risk) &&
          (!filters.score || item.score >= Number(filters.score)),
      ),
    [filters],
  );

  const selected = filtered.find((item) => item.id === selectedId) ?? null;
  const statuses: Array<CollisionStatus> = ["novo", "triagem", "em análise", "confirmado", "descartado"];

  return (
    <AppLayout>
      <PageHeader
        title="Monitoramento de Colidência"
        subtitle="Triagem ativa de conflitos entre ativos monitorados e novos depósitos."
        breadcrumbs={[{ label: "Monitoramentos" }, { label: "Colidência" }]}
        actions={
          <>
            <Button variant="outline" className="gap-1"><Download className="h-4 w-4" />Exportar relatório</Button>
            <Button className="bg-slate-900 hover:bg-slate-800">Confirmar lote</Button>
          </>
        }
        filters={
          <FilterBar
            fields={
              <>
                <Input placeholder="Cliente" value={filters.client} onChange={(e) => setFilters((s) => ({ ...s, client: e.target.value }))} />
                <Input placeholder="Status" value={filters.status} onChange={(e) => setFilters((s) => ({ ...s, status: e.target.value }))} />
                <Input placeholder="Score mínimo" value={filters.score} onChange={(e) => setFilters((s) => ({ ...s, score: e.target.value }))} />
                <Input placeholder="Risco" value={filters.risk} onChange={(e) => setFilters((s) => ({ ...s, risk: e.target.value }))} />
                <Input placeholder="Titular" value={filters.owner} onChange={(e) => setFilters((s) => ({ ...s, owner: e.target.value }))} />
                <Input placeholder="Inventor" value={filters.inventor} onChange={(e) => setFilters((s) => ({ ...s, inventor: e.target.value }))} />
                <Input placeholder="Período" value={filters.period} onChange={(e) => setFilters((s) => ({ ...s, period: e.target.value }))} />
                <Input placeholder="Classe IPC/CPC" value={filters.ipc} onChange={(e) => setFilters((s) => ({ ...s, ipc: e.target.value }))} />
              </>
            }
          />
        }
      />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi title="Novos achados" value={String(filtered.filter((item) => item.status === "novo").length)} />
        <Kpi title="Alto risco" value={String(filtered.filter((item) => item.risk === "alto" || item.risk === "critico").length)} />
        <Kpi title="Aguardando triagem" value={String(filtered.filter((item) => item.status === "triagem").length)} />
        <Kpi title="Confirmados" value={String(filtered.filter((item) => item.status === "confirmado").length)} />
      </section>

      <SecondaryToolbar>
        <Button variant={view === "tabela" ? "default" : "outline"} size="sm" onClick={() => setView("tabela")}>Tabela</Button>
        <Button variant={view === "kanban" ? "default" : "outline"} size="sm" onClick={() => setView("kanban")}>Kanban</Button>
        <Button variant="outline" size="sm" className="gap-1"><Filter className="h-3.5 w-3.5" />Salvar view</Button>
      </SecondaryToolbar>

      {view === "tabela" ? (
        <SectionCard title="Achados de colidência" description="Visão full width para triagem diária">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Ativo monitorado</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Titular encontrado</TableHead>
                <TableHead>Score IA</TableHead>
                <TableHead>Risco</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id} className="cursor-pointer" onClick={() => setSelectedId(row.id)}>
                  <TableCell>{row.client}</TableCell>
                  <TableCell className="font-mono text-xs">{row.monitoredAsset}</TableCell>
                  <TableCell className="font-mono text-xs">{row.document}</TableCell>
                  <TableCell>{row.owner}</TableCell>
                  <TableCell><ScoreBadge score={row.score} /></TableCell>
                  <TableCell><RiskBadge value={row.risk} /></TableCell>
                  <TableCell><TypeBadge label={row.type} /></TableCell>
                  <TableCell>{row.date}</TableCell>
                  <TableCell>{row.assignee}</TableCell>
                  <TableCell><StatusBadge label={row.status} variant={row.status === "confirmado" ? "stable" : "attention"} /></TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="ghost">Abrir</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      ) : (
        <section className="grid grid-cols-1 gap-3 xl:grid-cols-5">
          {statuses.map((status) => (
            <SectionCard key={status} title={status} className="min-h-[420px]">
              <div className="space-y-2">
                {filtered
                  .filter((item) => item.status === status)
                  .map((item) => (
                    <button key={item.id} onClick={() => setSelectedId(item.id)} className="w-full rounded-lg border border-slate-200 p-3 text-left">
                      <p className="text-sm font-medium">{item.client}</p>
                      <p className="text-xs text-slate-500">{item.document}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <ScoreBadge score={item.score} />
                        <RiskBadge value={item.risk} />
                      </div>
                    </button>
                  ))}
              </div>
            </SectionCard>
          ))}
        </section>
      )}

      <DetailDrawer open={!!selected} onOpenChange={() => setSelectedId(null)} title="Detalhe de colidência">
        {selected ? (
          <>
            <SectionCard title="Resumo IA" description={`${selected.document} vs ${selected.monitoredAsset}`}>
              <p className="text-sm text-slate-600">
                Similaridade conceitual elevada com sobreposição em reivindicações de arquitetura térmica e controle de corrente.
              </p>
            </SectionCard>
            <SectionCard title="Motivos da colisão">
              <ul className="space-y-1 text-sm text-slate-600">
                <li>Termos coincidentes: solid-state battery, thermal layer, current balancing</li>
                <li>Classes relacionadas: H01M 10/052 e H01M 10/056</li>
                <li>Estrutura de reivindicações com match sintático de 88%</li>
              </ul>
            </SectionCard>
            <SectionCard title="Comparativo ativo x documento">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs text-slate-500">Ativo monitorado</p>
                  <p className="font-medium">{selected.monitoredAsset}</p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs text-slate-500">Documento encontrado</p>
                  <p className="font-medium">{selected.document}</p>
                </div>
              </div>
            </SectionCard>
            <div className="flex flex-wrap gap-2">
              <Button className="bg-slate-900 hover:bg-slate-800">Confirmar risco</Button>
              <Button variant="outline">Descartar</Button>
              <Button variant="outline" className="gap-1"><UserPlus className="h-4 w-4" />Atribuir responsável</Button>
              <Button variant="outline">Gerar demanda</Button>
              <Button variant="outline">Anexar ao cliente</Button>
              <Button variant="outline" className="gap-1"><ArrowRightLeft className="h-4 w-4" />Exportar relatório</Button>
            </div>
          </>
        ) : null}
      </DetailDrawer>
    </AppLayout>
  );
}

type CollisionStatus = "novo" | "triagem" | "em análise" | "confirmado" | "descartado";

function Kpi({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
