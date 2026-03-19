import AppLayout from "@/components/AppLayout";
import { PageHeader, SectionCard, ScoreBadge, StatusBadge } from "@/components/platform/components";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

const steps = ["briefing", "transcrição", "briefing técnico", "palavras-chave", "resultados", "análise", "relatório"] as const;

export default function NewSearchWorkspace() {
  return (
    <AppLayout>
      <PageHeader
        title="Nova Pesquisa"
        subtitle="Workspace orientado por etapas, com resumo persistente e ações rápidas."
        breadcrumbs={[{ label: "Pesquisas", href: "/searches" }, { label: "Nova Pesquisa" }]}
        actions={
          <>
            <Button variant="outline">Importar arquivo</Button>
            <Button variant="outline">Iniciar por áudio</Button>
            <Button className="bg-slate-900 hover:bg-slate-800">Salvar versão</Button>
          </>
        }
      />

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <SectionCard title="ResearchStepper" className="xl:col-span-8" description="Controle de completude por etapa">
          <div className="space-y-3">
            {steps.map((step, index) => (
              <div key={step} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium capitalize">{index + 1}. {step}</p>
                  <StatusBadge label={index <= 3 ? "completo" : index === 4 ? "em andamento" : "pendente"} variant={index <= 3 ? "stable" : index === 4 ? "attention" : "neutral"} />
                </div>
                <Progress value={index <= 3 ? 100 : index === 4 ? 56 : 0} className="mt-2 h-2" />
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="AnalysisSidebar" className="xl:col-span-4" description="Contexto persistente da pesquisa">
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Cliente</p>
              <p className="font-medium">BioSyn Energia</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Progresso geral</p>
              <p className="font-medium">63%</p>
              <Progress value={63} className="mt-2 h-2" />
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Checklist</p>
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                <li>Briefing validado</li>
                <li>Classes IPC preliminares definidas</li>
                <li>Falta fechar seleção final de resultados</li>
              </ul>
            </div>
          </div>
        </SectionCard>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <SectionCard title="Resultados" className="xl:col-span-4" description="Lista de resultados à esquerda">
          <div className="space-y-2">
            {[
              { id: "WO2026022445A1", score: 92 },
              { id: "US20260118890A1", score: 84 },
              { id: "EP4528811A1", score: 73 },
            ].map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                <p className="font-mono text-xs">{item.id}</p>
                <div className="mt-2 flex items-center justify-between">
                  <ScoreBadge score={item.score} />
                  <Button size="sm" variant="outline">Selecionar</Button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="ResultComparisonPanel" className="xl:col-span-8" description="Detalhe comparativo à direita">
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="font-medium">WO2026022445A1</p>
              <p className="text-slate-500">Arquitetura de bateria sólida com camadas térmicas dinâmicas.</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="font-medium">Comentário IA</p>
              <p className="text-slate-500">Alto match conceitual em reivindicações 1, 2 e 6. Risco potencial em escopo de controle térmico.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline">Comparar</Button>
              <Button variant="outline">Marcar relevante</Button>
              <Button variant="outline">Anexar ao cliente</Button>
              <Button variant="outline">Virar análise</Button>
              <Button className="bg-slate-900 hover:bg-slate-800">Gerar relatório</Button>
            </div>
          </div>
        </SectionCard>
      </section>
    </AppLayout>
  );
}
