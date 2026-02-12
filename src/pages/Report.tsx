import { useNavigate } from "react-router-dom";
import { Download, Printer, FileText, Calendar, User, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import AppLayout from "@/components/AppLayout";
import WizardSteps from "@/components/WizardSteps";
import { mockStructuredBriefing, mockPatents, mockKeywords, mockClassifications } from "@/data/mockData";

const steps = ["Briefing", "Transcrição", "Briefing Técnico", "Palavras-chave", "Resultados", "Análise", "Relatório"];

export default function Report() {
  const navigate = useNavigate();

  const highRisk = mockPatents.filter((p) => p.riskLevel === "high");
  const mediumRisk = mockPatents.filter((p) => p.riskLevel === "medium");
  const lowRisk = mockPatents.filter((p) => p.riskLevel === "low");

  return (
    <AppLayout>
      <WizardSteps currentStep={6} steps={steps} />

      <div>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Relatório de Evidências</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Documento consolidado da análise de patentes
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-2">
              <Printer className="w-4 h-4" />
              Imprimir
            </Button>
            <Button size="sm" className="gap-2">
              <Download className="w-4 h-4" />
              Gerar Relatório de Evidências
            </Button>
          </div>
        </div>

        {/* Report document */}
        <div className="bg-card rounded-lg border shadow-sm max-w-4xl">
          {/* Header */}
          <div className="p-8 border-b" style={{ background: "var(--gradient-hero)" }}>
            <div className="flex items-center gap-3 mb-4">
              <ShieldCheck className="w-6 h-6 text-accent" />
              <span className="text-primary-foreground/80 text-sm font-medium">PatentScope — Relatório de Análise</span>
            </div>
            <h2 className="text-xl font-bold text-primary-foreground">
              Sistema de monitoramento de temperatura em transformadores de potência
            </h2>
            <div className="flex items-center gap-4 mt-4 text-primary-foreground/60 text-xs">
              <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date().toLocaleDateString("pt-BR")}</span>
              <span className="flex items-center gap-1"><User className="w-3 h-3" /> Analista: Maria Silva</span>
              <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> Ref: PSC-2025-001</span>
            </div>
          </div>

          <div className="p-8 space-y-8">
            {/* Summary */}
            <section>
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">Resumo Executivo</h3>
              <p className="text-sm leading-relaxed">
                Foram identificadas <strong>{mockPatents.length} patentes relevantes</strong> nas bases INPI e Espacenet. 
                A análise de similaridade técnica resultou em <strong className="text-risk-high">{highRisk.length} documentos de alto risco</strong>, {" "}
                <strong className="text-risk-medium">{mediumRisk.length} de risco médio</strong> e{" "}
                <strong className="text-risk-low">{lowRisk.length} de baixo risco</strong>. 
                Recomenda-se atenção especial aos documentos de alto risco antes do depósito.
              </p>
            </section>

            <Separator />

            {/* Briefing */}
            <section>
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">Briefing Técnico</h3>
              <div className="space-y-4">
                {[
                  { label: "Problema Técnico", value: mockStructuredBriefing.problemaTecnico },
                  { label: "Solução Proposta", value: mockStructuredBriefing.solucaoProposta },
                  { label: "Diferenciais", value: mockStructuredBriefing.diferenciais },
                  { label: "Aplicações", value: mockStructuredBriefing.aplicacoes },
                ].map((item) => (
                  <div key={item.label}>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">{item.label}</p>
                    <p className="text-sm leading-relaxed whitespace-pre-line">{item.value}</p>
                  </div>
                ))}
              </div>
            </section>

            <Separator />

            {/* Search Strategy */}
            <section>
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">Estratégia de Busca</h3>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Palavras-chave utilizadas</p>
                  <div className="flex flex-wrap gap-1.5">
                    {mockKeywords.filter(k => k.selected).map((kw) => (
                      <span key={kw.id} className="px-2 py-0.5 bg-muted rounded text-xs">
                        {kw.term}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Classificações IPC</p>
                  <div className="flex flex-wrap gap-1.5">
                    {mockClassifications.filter(c => c.selected).map((cls) => (
                      <span key={cls.id} className="px-2 py-0.5 bg-muted rounded text-xs font-mono">
                        {cls.code}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <Separator />

            {/* Patent Analysis */}
            <section>
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">Análise de Patentes</h3>
              <div className="space-y-4">
                {[...mockPatents].sort((a, b) => b.score - a.score).map((patent, idx) => (
                  <div key={patent.id} className="flex gap-4 text-sm">
                    <span className="text-muted-foreground font-mono text-xs w-5 shrink-0 pt-0.5">{idx + 1}.</span>
                    <div className="flex-1">
                      <div className="flex items-start justify-between">
                        <p className="font-medium">{patent.title}</p>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                          patent.riskLevel === "high" ? "bg-risk-high/15 text-risk-high" :
                          patent.riskLevel === "medium" ? "bg-risk-medium/15 text-risk-medium" :
                          "bg-risk-low/15 text-risk-low"
                        }`}>
                          {patent.score}%
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{patent.number} — {patent.source}</p>
                      <p className="text-xs text-muted-foreground mt-1">{patent.justification}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <Separator />

            {/* Conclusion */}
            <section>
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">Conclusão</h3>
              <p className="text-sm leading-relaxed">
                A pesquisa identificou sobreposições relevantes, especialmente nos documentos BR 10 2019 015432-7 e EP 3 285 042 A1, 
                que apresentam elementos técnicos semelhantes. Recomenda-se a análise detalhada das reivindicações destes documentos 
                por um agente de propriedade industrial antes do depósito do pedido. Os diferenciais identificados — uso de rede neural 
                recorrente e protocolo de comunicação proprietário — podem ser explorados para delimitar o escopo de proteção.
              </p>
            </section>

            <div className="pt-4 text-xs text-muted-foreground text-center">
              Documento gerado automaticamente pelo PatentScope — {new Date().toLocaleDateString("pt-BR")} — DEMO
            </div>
          </div>
        </div>

        <div className="flex justify-between mt-8">
          <Button variant="outline" onClick={() => navigate("/research/analysis")}>
            Voltar
          </Button>
          <Button onClick={() => navigate("/dashboard")}>
            Finalizar Pesquisa
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
