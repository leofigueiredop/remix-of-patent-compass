import { useMemo } from "react";
import { useParams } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { PageHeader, SectionCard, StatusBadge } from "@/components/platform/components";
import { clients, collisions, demands, processEvents } from "@/data/platformMock";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function ClientProfile() {
  const { id } = useParams();
  const client = useMemo(() => clients.find((item) => item.id === id) ?? clients[0], [id]);

  return (
    <AppLayout>
      <PageHeader
        title={client.name}
        subtitle={`Segmento ${client.segment} · responsável ${client.owner}`}
        breadcrumbs={[{ label: "Clientes", href: "/clients" }, { label: client.name }]}
        actions={
          <>
            <StatusBadge label={client.status} variant={client.status === "ativo" ? "stable" : "attention"} />
            <Button variant="outline">Nova proposta</Button>
            <Button className="bg-slate-900 hover:bg-slate-800">Nova demanda</Button>
          </>
        }
      />

      <Tabs defaultValue="overview">
        <TabsList className="h-auto flex-wrap justify-start gap-2 bg-transparent p-0">
          {["overview", "demands", "searches", "monitoring", "processes", "collisions", "proposals", "docs", "history"].map((tab) => (
            <TabsTrigger key={tab} value={tab} className="rounded-md border border-slate-200 bg-white px-3 py-1.5">
              {tab}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview" className="mt-4 space-y-4">
          <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Kpi title="Monitoramentos ativos" value={String(client.monitorings)} />
            <Kpi title="Demandas abertas" value={String(client.openDemands)} />
            <Kpi title="Colidências recentes" value={String(collisions.filter((item) => item.client === client.name).length)} />
            <Kpi title="Próximo follow-up" value={client.nextFollowUp} />
          </section>
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <SectionCard title="Timeline de atividade">
              <div className="space-y-2 text-sm">
                <div className="rounded-lg border border-slate-200 p-3">19/03 · Nova colisão detectada e atribuída para triagem.</div>
                <div className="rounded-lg border border-slate-200 p-3">17/03 · Reunião de acompanhamento com jurídico interno.</div>
                <div className="rounded-lg border border-slate-200 p-3">14/03 · Relatório de vigilância competitiva entregue.</div>
              </div>
            </SectionCard>
            <SectionCard title="Itens críticos">
              <div className="space-y-2 text-sm">
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">Exigência com prazo inferior a 7 dias.</div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">Colisão com score superior a 90.</div>
              </div>
            </SectionCard>
          </section>
        </TabsContent>
        <TabsContent value="demands" className="mt-4">
          <SectionCard title="Demandas do cliente">
            <div className="space-y-2 text-sm">
              {demands.filter((item) => item.client === client.name).map((item) => (
                <div className="rounded-lg border border-slate-200 p-3" key={item.id}>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-xs text-slate-500">{item.status} · {item.owner}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>
        <TabsContent value="processes" className="mt-4">
          <SectionCard title="Processos vinculados">
            <div className="space-y-2 text-sm">
              {processEvents.filter((item) => item.client === client.name).map((item) => (
                <div className="rounded-lg border border-slate-200 p-3" key={item.id}>
                  <p className="font-medium">{item.process}</p>
                  <p className="text-xs text-slate-500">{item.title}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}

function Kpi({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
