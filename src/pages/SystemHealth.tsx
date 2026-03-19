import AppLayout from "@/components/AppLayout";
import { PageHeader, SectionCard, StatusBadge } from "@/components/platform/components";
import { workers } from "@/data/platformMock";

export default function SystemHealth() {
  return (
    <AppLayout>
      <PageHeader
        title="Saúde do Sistema"
        subtitle="Visão técnica de serviços, integrações e timeline operacional."
        breadcrumbs={[{ label: "Operações" }, { label: "Saúde do Sistema" }]}
      />

      <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Kpi title="APIs externas saudáveis" value="5/6" />
        <Kpi title="Uso de quota (24h)" value="68%" />
        <Kpi title="Falhas críticas (24h)" value="2" />
        <Kpi title="Tempo médio de pipeline" value="44s" />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <SectionCard title="Saúde dos serviços" className="xl:col-span-6">
          <div className="space-y-2">
            {[
              ["Backend API", "estável"],
              ["RPI Parser", "estável"],
              ["INPI Scraper", "atenção"],
              ["OPS API", "estável"],
              ["BigQuery Sync", "estável"],
              ["Storage S3", "estável"],
            ].map(([name, status]) => (
              <div key={name} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                <span>{name}</span>
                <StatusBadge label={status} variant={status === "atenção" ? "attention" : "stable"} />
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Consumo de fontes/APIs" className="xl:col-span-6">
          <div className="space-y-2">
            {[
              ["INPI", "74%"],
              ["OPS", "52%"],
              ["Google Patents", "38%"],
              ["BigQuery", "44%"],
              ["S3", "67%"],
            ].map(([source, usage]) => (
              <div key={source} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between text-sm"><span>{source}</span><span>{usage}</span></div>
                <div className="mt-2 h-2 overflow-hidden rounded bg-slate-100">
                  <div className="h-full bg-slate-900" style={{ width: usage }} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>

      <SectionCard title="Timeline operacional">
        <div className="space-y-2 text-sm">
          <div className="rounded-lg border border-slate-200 p-3">09:12 · Worker INPI reprocessou 18 itens com fallback OPS.</div>
          <div className="rounded-lg border border-slate-200 p-3">09:05 · RPI #2819 consolidada com 932 registros.</div>
          <div className="rounded-lg border border-slate-200 p-3">08:48 · Latência elevada em endpoint de download de PDFs.</div>
          <div className="rounded-lg border border-slate-200 p-3">08:30 · BigQuery index atualizado com +1.280 documentos.</div>
          <div className="rounded-lg border border-slate-200 p-3">08:12 · Workers online: {workers.filter((item) => item.online).length}/{workers.length}</div>
        </div>
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
