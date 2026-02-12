import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import AppLayout from "@/components/AppLayout";
import WizardSteps from "@/components/WizardSteps";
import LoadingTransition from "@/components/LoadingTransition";
import { mockStructuredBriefing } from "@/data/mockData";

const steps = ["Briefing", "Transcrição", "Briefing Técnico", "Palavras-chave", "Resultados", "Análise", "Relatório"];

const fields = [
  { key: "problemaTecnico", label: "Problema Técnico", icon: "🔍" },
  { key: "solucaoProposta", label: "Solução Proposta", icon: "💡" },
  { key: "diferenciais", label: "Diferenciais", icon: "⭐" },
  { key: "aplicacoes", label: "Aplicações", icon: "🏭" },
] as const;

export default function StructuredBriefing() {
  const navigate = useNavigate();
  const [briefing, setBriefing] = useState(mockStructuredBriefing);
  const [loading, setLoading] = useState(false);

  const updateField = (key: string, value: string) => {
    setBriefing((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <AppLayout>
      {loading && (
        <LoadingTransition
          message="Extraindo palavras-chave..."
          subMessage="Identificando termos e classificações IPC"
          duration={2800}
          onComplete={() => navigate("/research/keywords")}
        />
      )}
      <WizardSteps currentStep={2} steps={steps} />

      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold mb-1">Briefing Técnico Estruturado</h1>
        <p className="text-muted-foreground text-sm mb-8">
          Revise os campos organizados automaticamente a partir da transcrição
        </p>

        <div className="space-y-5">
          {fields.map((field) => (
            <div key={field.key} className="bg-card rounded-lg border p-5">
              <label className="flex items-center gap-2 text-sm font-semibold mb-3">
                <span>{field.icon}</span>
                {field.label}
              </label>
              <Textarea
                value={briefing[field.key]}
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
          <Button onClick={() => setLoading(true)}>
            Confirmar Briefing
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
