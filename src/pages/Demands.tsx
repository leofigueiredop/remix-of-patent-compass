import AppLayout from "@/components/AppLayout";
import { PageHeader, SectionCard, StatusBadge, TypeBadge } from "@/components/platform/components";
import { demands } from "@/data/platformMock";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const statusColumns = ["nova", "triagem", "em execução", "aguardando cliente", "concluída", "arquivada"] as const;

export default function Demands() {
  return (
    <AppLayout>
      <PageHeader
        title="Demandas / Pipeline"
        subtitle="Fluxo operacional com origem rastreável por módulo."
        breadcrumbs={[{ label: "Operações" }, { label: "Demandas" }]}
        actions={<Button className="bg-slate-900 hover:bg-slate-800">Nova demanda</Button>}
      />

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-6">
        {statusColumns.map((status) => (
          <SectionCard key={status} title={status} className="min-h-[260px]">
            <div className="space-y-2">
              {demands.filter((item) => item.status === status).map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-sm font-medium">{item.title}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <TypeBadge label={item.origin} />
                    <StatusBadge label={item.priority} variant={item.priority === "alta" ? "critical" : "info"} />
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        ))}
      </section>

      <SectionCard title="Visualização em tabela" description="Visão complementar para operação e SLA">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Prioridade</TableHead>
              <TableHead>Prazo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {demands.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.title}</TableCell>
                <TableCell><TypeBadge label={row.origin} /></TableCell>
                <TableCell>{row.client}</TableCell>
                <TableCell>{row.owner}</TableCell>
                <TableCell><StatusBadge label={row.status} variant={row.status === "concluída" ? "stable" : "attention"} /></TableCell>
                <TableCell>{row.priority}</TableCell>
                <TableCell>{row.dueDate}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
    </AppLayout>
  );
}
