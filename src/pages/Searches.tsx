import { Link } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { PageHeader, SectionCard, StatusBadge } from "@/components/platform/components";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const searches = [
  { id: "sr-01", title: "Baterias de estado sólido para EV", stage: "análise", progress: 78, owner: "Felipe Moraes", client: "BioSyn Energia", updatedAt: "2026-03-19" },
  { id: "sr-02", title: "Cateter com telemetria ativa", stage: "resultados", progress: 61, owner: "Camila Neves", client: "Orion Medical Devices", updatedAt: "2026-03-18" },
  { id: "sr-03", title: "Polímero bioativo para prótese", stage: "briefing técnico", progress: 34, owner: "Amanda Luz", client: "Nexa Química", updatedAt: "2026-03-17" },
];

export default function Searches() {
  return (
    <AppLayout>
      <PageHeader
        title="Pesquisas"
        subtitle="Pipeline de pesquisa de patenteabilidade com visão operacional."
        breadcrumbs={[{ label: "Pesquisas" }]}
        actions={<Button asChild className="bg-slate-900 hover:bg-slate-800"><Link to="/searches/new">Nova pesquisa</Link></Button>}
      />
      <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Kpi title="Em execução" value="18" />
        <Kpi title="Aguardando análise" value="6" />
        <Kpi title="Finalizadas (30d)" value="27" />
        <Kpi title="SLA médio" value="4.2 dias" />
      </section>
      <SectionCard title="Pesquisas ativas">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pesquisa</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Etapa</TableHead>
              <TableHead>Progresso</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Atualizada</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {searches.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.title}</TableCell>
                <TableCell>{item.client}</TableCell>
                <TableCell><StatusBadge label={item.stage} variant="info" /></TableCell>
                <TableCell>{item.progress}%</TableCell>
                <TableCell>{item.owner}</TableCell>
                <TableCell>{item.updatedAt}</TableCell>
                <TableCell className="text-right"><Button size="sm" variant="outline">Abrir workspace</Button></TableCell>
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
