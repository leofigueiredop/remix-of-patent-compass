import AppLayout from "@/components/AppLayout";
import { FilterBar, PageHeader, SectionCard, StatusBadge } from "@/components/platform/components";
import { alerts } from "@/data/platformMock";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function AlertsCenter() {
  return (
    <AppLayout>
      <PageHeader
        title="Central de Alertas"
        subtitle="Fila unificada de eventos operacionais, técnicos e de risco."
        breadcrumbs={[{ label: "Operações" }, { label: "Alertas" }]}
        actions={<Button className="bg-slate-900 hover:bg-slate-800">Resolver em lote</Button>}
        filters={
          <FilterBar
            fields={
              <>
                <Input placeholder="Tipo" />
                <Input placeholder="Prioridade" />
                <Input placeholder="Cliente" />
                <Input placeholder="Responsável" />
                <Input placeholder="Origem" />
                <Input placeholder="Status" />
              </>
            }
          />
        }
      />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi title="Não lidos" value={String(alerts.filter((item) => item.status === "não lido").length)} />
        <Kpi title="Críticos" value={String(alerts.filter((item) => item.priority === "crítica").length)} />
        <Kpi title="Atribuídos" value={String(alerts.filter((item) => item.status === "atribuído").length)} />
        <Kpi title="Resolvidos hoje" value={String(alerts.filter((item) => item.status === "resolvido").length)} />
      </section>

      <SectionCard title="Fila de eventos">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Prioridade</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Data</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {alerts.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.title}</TableCell>
                <TableCell>{item.type}</TableCell>
                <TableCell><StatusBadge label={item.priority} variant={item.priority === "crítica" ? "critical" : "attention"} /></TableCell>
                <TableCell>{item.client}</TableCell>
                <TableCell>{item.owner}</TableCell>
                <TableCell>{item.source}</TableCell>
                <TableCell><StatusBadge label={item.status} variant={item.status === "resolvido" ? "stable" : "info"} /></TableCell>
                <TableCell>{item.date}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline">Atribuir</Button>
                    <Button size="sm" variant="outline">Comentar</Button>
                    <Button size="sm">Resolver</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
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
