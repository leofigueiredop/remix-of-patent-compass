import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Maximize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const { briefing, setBriefing, setStrategy, trackJourneyStep } = useResearch();
  const [localBriefing, setLocalBriefing] = useState(briefing || {
    problemaTecnico: "",
    solucaoProposta: "",
    diferenciais: "",
    aplicacoes: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedField, setExpandedField] = useState<string | null>(null);

  useEffect(() => {
    trackJourneyStep("step_2_structured_briefing", "view");
  }, [trackJourneyStep]);

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
      trackJourneyStep("step_2_structured_briefing", "complete");
      navigate("/research/keywords");
    } catch (err: any) {
      setError(err.message || "Erro ao gerar estratégia de busca.");
      setLoading(false);
    }
  };

  const expandedFieldData = expandedField
    ? fields.find(f => f.key === expandedField)
    : null;

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

      <div className="max-w-5xl w-full">
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
              <div className="flex items-center justify-between mb-3">
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <span>{field.icon}</span>
                  {field.label}
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setExpandedField(field.key)}
                  title="Maximizar"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <Textarea
                value={localBriefing[field.key]}
                onChange={(e) => updateField(field.key, e.target.value)}
                className="min-h-[140px] resize-y text-sm leading-relaxed"
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

      {/* Maximize Modal */}
      <Dialog open={!!expandedField} onOpenChange={(open) => !open && setExpandedField(null)}>
        <DialogContent className="max-w-4xl w-[95vw] h-[85vh] flex flex-col p-0 gap-0">
          {expandedFieldData && (
            <>
              <DialogHeader className="p-5 pb-3 border-b shrink-0">
                <DialogTitle className="flex items-center gap-2 text-base">
                  <span>{expandedFieldData.icon}</span>
                  {expandedFieldData.label}
                </DialogTitle>
              </DialogHeader>
              <div className="flex-1 p-5 min-h-0">
                <Textarea
                  value={localBriefing[expandedFieldData.key]}
                  onChange={(e) => updateField(expandedFieldData.key, e.target.value)}
                  className="w-full h-full resize-none text-sm leading-relaxed"
                  autoFocus
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
