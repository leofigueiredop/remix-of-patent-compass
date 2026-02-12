import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, AlertCircle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import LoadingTransition from "@/components/LoadingTransition";
import AppLayout from "@/components/AppLayout";
import WizardSteps from "@/components/WizardSteps";
import { mockPatents } from "@/data/mockData";

const steps = ["Briefing", "Transcrição", "Briefing Técnico", "Palavras-chave", "Resultados", "Análise", "Relatório"];

const riskIcons = {
  high: AlertTriangle,
  medium: AlertCircle,
  low: CheckCircle,
};

const riskLabels = {
  high: "Alto Risco",
  medium: "Risco Médio",
  low: "Baixo Risco",
};

export default function Analysis() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const sorted = [...mockPatents].sort((a, b) => b.score - a.score);
  const grouped = {
    high: sorted.filter((p) => p.riskLevel === "high"),
    medium: sorted.filter((p) => p.riskLevel === "medium"),
    low: sorted.filter((p) => p.riskLevel === "low"),
  };

  return (
    <AppLayout>
      {loading && (
        <LoadingTransition
          message="Gerando relatório de evidências..."
          subMessage="Compilando análise e recomendações"
          duration={3000}
          onComplete={() => navigate("/research/report")}
        />
      )}
      <WizardSteps currentStep={5} steps={steps} />

      <div>
        <h1 className="text-2xl font-bold mb-1">Análise de Similaridade</h1>
        <p className="text-muted-foreground text-sm mb-8">
          Patentes ranqueadas por nível de risco de conflito
        </p>

        <div className="space-y-8">
          {(["high", "medium", "low"] as const).map((level) => {
            const patents = grouped[level];
            if (patents.length === 0) return null;
            const Icon = riskIcons[level];
            return (
              <div key={level}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon className={`w-4 h-4 ${level === "high" ? "text-risk-high" : level === "medium" ? "text-risk-medium" : "text-risk-low"}`} />
                  <h2 className="text-sm font-semibold">
                    {riskLabels[level]} ({patents.length})
                  </h2>
                </div>
                <div className="space-y-3">
                  {patents.map((patent) => (
                    <div key={patent.id} className={`risk-${level} rounded-lg p-5`}>
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{patent.title}</p>
                          <p className="text-xs text-muted-foreground font-mono mt-1">{patent.number}</p>
                        </div>
                        <span className={`score-badge text-sm ${
                          level === "high" ? "bg-risk-high/15 text-risk-high" :
                          level === "medium" ? "bg-risk-medium/15 text-risk-medium" :
                          "bg-risk-low/15 text-risk-low"
                        }`}>
                          {patent.score}%
                        </span>
                      </div>
                      <div className="space-y-2">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Resumo Técnico</p>
                          <p className="text-sm text-foreground leading-relaxed">{patent.abstract}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Justificativa da Similaridade</p>
                          <p className="text-sm text-foreground leading-relaxed">{patent.justification}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-between mt-8">
          <Button variant="outline" onClick={() => navigate("/research/results")}>
            Voltar
          </Button>
          <Button onClick={() => setLoading(true)}>
            Gerar Relatório
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
