import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import AppLayout from "@/components/AppLayout";
import WizardSteps from "@/components/WizardSteps";
import LoadingTransition from "@/components/LoadingTransition";
import { useResearch } from "@/contexts/ResearchContext";
import { aiService } from "@/services/ai";

const steps = ["Briefing", "Transcrição", "Briefing Técnico", "Palavras-chave", "Resultados", "Análise", "Relatório"];

const fields = [
  { key: "problemaTecnico", label: "Problema Técnico", icon: "🔍" },
  { key: "solucaoProposta", label: "Solução Proposta", icon: "💡" },
  { key: "diferenciais", label: "Diferenciais", icon: "⭐" },
  { key: "aplicacoes", label: "Aplicações", icon: "🏭" },
] as const;

export default function StructuredBriefing() {
  const navigate = useNavigate();
  const { briefing, setBriefing, setStrategy } = useResearch();
  const [localBriefing, setLocalBriefing] = useState(briefing || {
    problemaTecnico: "",
    solucaoProposta: "",
    diferenciais: "",
    aplicacoes: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateField = (key: string, value: string) => {
    setLocalBriefing((prev) => ({ ...prev, [key]: value }));
  };

  const handleConfirm = async () => {
    setError(null);
    setLoading(true);
    setBriefing(localBriefing);

    try {
      const result = await aiService.generateStrategy(localBriefing);
      setStrategy(result);
      navigate("/research/keywords");
    } catch (err: any) {
      setError(err.message || "Erro ao gerar estratégia de busca.");
      setLoading(false);
    }
  };

  return (
    <AppLayout>
      {loading && (
        <LoadingTransition
          message="Extraindo palavras-chave..."
          subMessage="Identificando termos e classificações IPC com IA"
          duration={3000}
          onComplete={() => { }}
        />
      )}
      <WizardSteps currentStep={2} steps={steps} />

      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold mb-1">Briefing Técnico Estruturado</h1>
        <p className="text-muted-foreground text-sm mb-8">
          Revise os campos organizados automaticamente a partir da transcrição
        </p>

        {error && (
          <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <div className="space-y-5">
          {fields.map((field) => (
            <div key={field.key} className="bg-card rounded-lg border p-5">
              <label className="flex items-center gap-2 text-sm font-semibold mb-3">
                <span>{field.icon}</span>
                {field.label}
              </label>
              <Textarea
                value={localBriefing[field.key]}
                onChange={(e) => updateField(field.key, e.target.value)}
                className="min-h-[80px] resize-y text-sm leading-relaxed"
              />
            </div>
          ))}
        </div>

        <div className="flex justify-between mt-8">
          <Button variant="outline" onClick={() => navigate("/research/transcription")}>
            Voltar
          </Button>
          <Button onClick={handleConfirm} disabled={loading}>
            Confirmar Briefing
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
