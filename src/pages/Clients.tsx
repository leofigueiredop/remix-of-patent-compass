import { Link } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { FilterBar, PageHeader, SectionCard, StatusBadge } from "@/components/platform/components";
import { clients } from "@/data/platformMock";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Clients() {
  return (
    <AppLayout>
      <PageHeader
        title="Clientes"
        subtitle="CRM operacional conectado com pesquisas, monitoramentos e demandas."
        breadcrumbs={[{ label: "Clientes" }]}
        actions={<Button className="bg-slate-900 hover:bg-slate-800">Novo cliente</Button>}
        filters={
          <FilterBar
            fields={
              <>
                <Input placeholder="Status" />
                <Input placeholder="Responsável" />
                <Input placeholder="Segmento" />
                <Input placeholder="Tag" />
              </>
            }
          />
        }
      />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi title="Clientes ativos" value="46" />
        <Kpi title="Em negociação" value="8" />
        <Kpi title="Sem atividade recente" value="5" />
        <Kpi title="Pendências críticas" value="9" />
      </section>

      <SectionCard title="Lista de clientes">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Segmento</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Monitoramentos</TableHead>
              <TableHead>Demandas</TableHead>
              <TableHead>Próximo follow-up</TableHead>
              <TableHead>Última atividade</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>{row.segment}</TableCell>
                <TableCell><StatusBadge label={row.status} variant={row.status === "ativo" ? "stable" : "attention"} /></TableCell>
                <TableCell>{row.owner}</TableCell>
                <TableCell>{row.monitorings}</TableCell>
                <TableCell>{row.openDemands}</TableCell>
                <TableCell>{row.nextFollowUp}</TableCell>
                <TableCell>{row.lastActivity}</TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="outline"><Link to={`/clients/${row.id}`}>Abrir perfil</Link></Button>
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
