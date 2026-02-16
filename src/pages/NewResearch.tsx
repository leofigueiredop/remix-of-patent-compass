import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mic, FileText, Upload } from "lucide-react";
import LoadingTransition from "@/components/LoadingTransition";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import AppLayout from "@/components/AppLayout";
import WizardSteps from "@/components/WizardSteps";

const steps = ["Briefing", "Transcrição", "Briefing Técnico", "Palavras-chave", "Resultados", "Análise", "Relatório"];

export default function NewResearch() {
  const navigate = useNavigate();
  const [inputMode, setInputMode] = useState<"audio" | "text" | "files">("text");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  const getLoadingMessage = () => {
    switch (inputMode) {
      case "audio": return "Transcrevendo áudio...";
      case "files": return "Analisando arquivos e mídia...";
      default: return "Organizando briefing...";
    }
  };

  return (
    <AppLayout>
      {loading && (
        <LoadingTransition
          message={getLoadingMessage()}
          subMessage="Processando entrada com IA"
          duration={3000}
          onComplete={() => navigate("/research/transcription")}
        />
      )}
      <WizardSteps currentStep={0} steps={steps} />

      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold mb-1">Nova Pesquisa</h1>
        <p className="text-muted-foreground text-sm mb-8">
          Descreva a invenção para iniciar a análise de patentes
        </p>

        {/* Input mode selector */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          <button
            onClick={() => setInputMode("audio")}
            className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-colors ${inputMode === "audio"
                ? "border-accent bg-accent/5"
                : "border-border hover:border-muted-foreground/30"
              }`}
          >
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${inputMode === "audio" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}>
              <Mic className="w-5 h-5" />
            </div>
            <div className="text-left">
              <p className="text-sm font-medium">Áudio</p>
              <p className="text-[10px] text-muted-foreground leading-tight">Gravação do briefing</p>
            </div>
          </button>

          <button
            onClick={() => setInputMode("files")}
            className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-colors ${inputMode === "files"
                ? "border-accent bg-accent/5"
                : "border-border hover:border-muted-foreground/30"
              }`}
          >
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${inputMode === "files" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}>
              <Upload className="w-5 h-5" />
            </div>
            <div className="text-left">
              <p className="text-sm font-medium">Arquivos/Mídia</p>
              <p className="text-[10px] text-muted-foreground leading-tight">Fotos, vídeos e docs</p>
            </div>
          </button>

          <button
            onClick={() => setInputMode("text")}
            className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-colors ${inputMode === "text"
                ? "border-accent bg-accent/5"
                : "border-border hover:border-muted-foreground/30"
              }`}
          >
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${inputMode === "text" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}>
              <FileText className="w-5 h-5" />
            </div>
            <div className="text-left">
              <p className="text-sm font-medium">Digitação</p>
              <p className="text-[10px] text-muted-foreground leading-tight">Descrição em texto</p>
            </div>
          </button>
        </div>

        {inputMode === "text" ? (
          <Textarea
            placeholder="Descreva a invenção com o máximo de detalhes possível: qual o problema técnico, qual a solução proposta, quais os diferenciais em relação ao estado da arte..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[200px] resize-y"
          />
        ) : (
          <div className="border-2 border-dashed border-border rounded-lg p-12 text-center">
            <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium mb-1">Arraste os arquivos aqui</p>
            <p className="text-xs text-muted-foreground mb-4">
              {inputMode === "audio"
                ? "MP3, WAV, M4A — máx. 25MB"
                : "Imagens, Vídeos (MP4), PDFs — máx. 50MB"}
            </p>
            <Button variant="outline" size="sm">
              Selecionar Arquivos
            </Button>
          </div>
        )}

        <div className="flex justify-end mt-6">
          <Button onClick={() => setLoading(true)} className="gap-2">
            {inputMode === "text" ? "Organizar" : inputMode === "audio" ? "Transcrever" : "Analisar"}
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
