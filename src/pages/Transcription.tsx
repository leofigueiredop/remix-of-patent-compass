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

export default function Transcription() {
  const navigate = useNavigate();
  const { transcription, setTranscription, setBriefing } = useResearch();
  const [text, setText] = useState(transcription);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setError(null);
    setLoading(true);
    setTranscription(text);

    try {
      const result = await aiService.generateBriefing(text);
      setBriefing(result);
      navigate("/research/structured");
    } catch (err: any) {
      setError(err.message || "Erro ao gerar briefing. O LLM pode estar carregando.");
      setLoading(false);
    }
  };

  return (
    <AppLayout>
      {loading && (
        <LoadingTransition
          message="Estruturando briefing técnico..."
          subMessage="Extraindo campos do texto com IA (pode levar até 60s no primeiro uso)"
          duration={5000}
          onComplete={() => { }}
        />
      )}
      <WizardSteps currentStep={1} steps={steps} />

      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold mb-1">Transcrição e Ajuste</h1>
        <p className="text-muted-foreground text-sm mb-8">
          Revise e edite o texto antes de prosseguir com a estruturação
        </p>

        {error && (
          <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <div className="bg-card rounded-lg border p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-accent" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Texto Original / Transcrito
            </span>
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[250px] resize-y border-0 p-0 focus-visible:ring-0 text-sm leading-relaxed"
          />
        </div>

        <p className="text-xs text-muted-foreground mb-6">
          Você pode editar livremente o texto acima antes de confirmar.
        </p>

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => navigate("/research/new")}>
            Voltar
          </Button>
          <Button onClick={handleConfirm} disabled={loading || !text.trim()}>
            Confirmar Transcrição
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
