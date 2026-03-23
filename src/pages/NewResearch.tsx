import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mic, FileText, Upload } from "lucide-react";
import LoadingTransition from "@/components/LoadingTransition";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import AppLayout from "@/components/AppLayout";
import WizardSteps from "@/components/WizardSteps";
import OperationalPageHeader from "@/components/operations/OperationalPageHeader";
import { useResearch } from "@/contexts/ResearchContext";
import { aiService } from "@/services/ai";

const steps = ["Briefing", "Transcrição", "Briefing Técnico", "Palavras-chave", "Resultados", "Análise", "Relatório"];

export default function NewResearch() {
  const navigate = useNavigate();
  const { setRawInput, setTranscription, setInputMode: setCtxInputMode, trackJourneyStep } = useResearch();
  const [inputMode, setInputMode] = useState<"audio" | "text" | "files">("text");
  const [text, setText] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getLoadingMessage = () => {
    switch (inputMode) {
      case "audio": return "Transcrevendo áudio com Whisper...";
      case "files": return "Analisando arquivos e mídia...";
      default: return "Organizando briefing...";
    }
  };

  useEffect(() => {
    trackJourneyStep("step_0_new_research", "view");
  }, [trackJourneyStep]);

  const buildFilesTranscription = async (files: File[]): Promise<string> => {
    const chunks: string[] = [];
    for (const file of files) {
      const header = `Arquivo: ${file.name} (${file.type || "tipo não identificado"}) - ${(file.size / 1024).toFixed(1)}KB`;
      if (file.type.startsWith("text/") || file.type === "application/json") {
        const content = await file.text().catch(() => "");
        const cleaned = content.replace(/\s+/g, " ").trim();
        chunks.push(`${header}\nTrecho: ${cleaned.slice(0, 2000) || "sem conteúdo textual legível"}`);
      } else {
        chunks.push(`${header}\nConteúdo não textual. Use metadados e contexto visual na análise.`);
      }
    }
    return chunks.join("\n\n");
  };

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    setCtxInputMode(inputMode);

    try {
      if (inputMode === "audio" && selectedFiles[0]) {
        const result = await aiService.transcribeAudio(selectedFiles[0]);
        setRawInput(result.text);
        setTranscription(result.text);
        trackJourneyStep("step_0_new_research", "complete");
        navigate("/research/transcription");
      } else if (inputMode === "text" && text.trim()) {
        setRawInput(text);
        setTranscription(text);
        trackJourneyStep("step_0_new_research", "complete");
        navigate("/research/transcription");
      } else if (inputMode === "files" && selectedFiles.length > 0) {
        const filesText = await buildFilesTranscription(selectedFiles);
        const preface = "Briefing a partir de arquivos anexados:\n\n";
        setRawInput(`${preface}${filesText}`);
        setTranscription(`${preface}${filesText}`);
        trackJourneyStep("step_0_new_research", "complete");
        navigate("/research/transcription");
      } else {
        setError("Insira um texto ou selecione arquivo(s) para continuar.");
        setLoading(false);
      }
    } catch (err: any) {
      setError(err.message || "Erro ao processar entrada. Verifique se o backend está rodando.");
      setLoading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) setSelectedFiles(files);
  };

  return (
    <AppLayout>
      {loading && (
        <LoadingTransition
          message={getLoadingMessage()}
          subMessage="Processando entrada com IA"
          duration={3000}
          onComplete={() => { }}
        />
      )}
      <div className="space-y-6">
        <WizardSteps currentStep={0} steps={steps} />
        <OperationalPageHeader
          title="Nova Pesquisa"
          description="Estruture o briefing técnico para iniciar a análise de patentes com melhor qualidade de resultado."
          icon={<FileText className="w-5 h-5 text-slate-600" />}
          metrics={
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Modo selecionado</p>
                <p className="text-sm font-semibold text-slate-800 uppercase">{inputMode}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Arquivos anexados</p>
                <p className="text-sm font-semibold text-slate-800">{selectedFiles.length}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Briefing digitado</p>
                <p className="text-sm font-semibold text-slate-800">{text.trim().length} caracteres</p>
              </div>
            </div>
          }
        />

        {error && (
          <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg mb-6">
            {error}
          </div>
        )}

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
            className="min-h-[260px] resize-y"
          />
        ) : (
          <div className="border-2 border-dashed border-border rounded-lg p-12 text-center">
            <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium mb-1">
              {selectedFiles.length > 0 ? `${selectedFiles.length} arquivo(s) selecionado(s)` : "Arraste os arquivos aqui"}
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              {inputMode === "audio"
                ? "MP3, WAV, M4A — máx. 25MB"
                : "Imagens, Vídeos (MP4), PDFs — máx. 50MB"}
            </p>
            <label>
              <Button variant="outline" size="sm" asChild>
                <span>Selecionar Arquivos</span>
              </Button>
              <input
                type="file"
                className="hidden"
                accept={inputMode === "audio" ? "audio/*" : "image/*,video/*,.pdf,text/*,application/json"}
                multiple={inputMode !== "audio"}
                onChange={handleFileSelect}
              />
            </label>
          </div>
        )}

        <div className="flex justify-end mt-6">
          <Button onClick={handleSubmit} className="gap-2" disabled={loading}>
            {inputMode === "text" ? "Organizar" : inputMode === "audio" ? "Transcrever" : "Analisar"}
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
