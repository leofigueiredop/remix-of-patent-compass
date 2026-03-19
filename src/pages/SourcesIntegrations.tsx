import AppLayout from "@/components/AppLayout";
import { PageHeader, SectionCard, StatusBadge } from "@/components/platform/components";

export default function SourcesIntegrations() {
  return (
    <AppLayout>
      <PageHeader
        title="Fontes / Integrações"
        subtitle="Controle de conectores para ingestão, enriquecimento e indexação."
        breadcrumbs={[{ label: "Base" }, { label: "Fontes / Integrações" }]}
      />
      <SectionCard title="Conectores">
        <div className="space-y-2">
          {[
            ["INPI", "ativo", "Último sync 09:05"],
            ["OPS", "ativo", "Último sync 09:08"],
            ["Google Patents", "ativo", "Último sync 09:00"],
            ["BigQuery", "ativo", "Último sync 08:58"],
            ["S3", "ativo", "Último sync 09:03"],
            ["Espacenet", "atenção", "Timeout intermitente"],
          ].map(([name, status, details]) => (
            <div key={name} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3">
              <div>
                <p className="text-sm font-medium">{name}</p>
                <p className="text-xs text-slate-500">{details}</p>
              </div>
              <StatusBadge label={status} variant={status === "ativo" ? "stable" : "attention"} />
            </div>
          ))}
        </div>
      </SectionCard>
    </AppLayout>
  );
}
