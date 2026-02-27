import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import LoadingTransition from "@/components/LoadingTransition";
import AppLayout from "@/components/AppLayout";
import WizardSteps from "@/components/WizardSteps";

const steps = ["Briefing", "Transcrição", "Briefing Técnico", "Palavras-chave", "Resultados", "Análise", "Relatório"];

interface AnalyzedPatent {
  id: string;
  publicationNumber: string;
  title: string;
  applicant: string;
  date: string;
  abstract: string;
  selected: boolean;
  riskLevel: "high" | "medium" | "low";
  score: number;
  comments: string;
  url?: string;
  classification?: string;
}

export default function Analysis() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [patents, setPatents] = useState<AnalyzedPatent[]>([]);

  useEffect(() => {
    const incomingResults = location.state?.results as any[];
    const analyzedData = location.state?.analyzed as any[];

    if (incomingResults && incomingResults.length > 0) {
      setPatents(incomingResults.map((p, idx) => {
        // Merge AI analysis if available
        const analysis = analyzedData?.find(
          (a: any) => a.publicationNumber === (p.publicationNumber || p.number)
        ) || analyzedData?.[idx];

        return {
          publicationNumber: p.publicationNumber || p.number || `PAT-${idx}`,
          title: p.title || "Sem título",
          applicant: p.applicant || "Desconhecido",
          date: p.date || "",
          abstract: p.abstract || "",
          classification: p.classification || "",
          id: p.publicationNumber || p.id || `id-${idx}`,
          selected: (analysis?.riskLevel === "high" || analysis?.riskLevel === "medium") || false,
          riskLevel: analysis?.riskLevel || "medium",
          score: analysis?.score || 0,
          comments: analysis?.justificativa || analysis?.comments || "",
          url: p.url,
        };
      }));
    }
  }, [location.state]);

  const toggleSelection = (id: string) => {
    setPatents(prev => prev.map(p => p.id === id ? { ...p, selected: !p.selected } : p));
  };

  const updateRisk = (id: string, level: "high" | "medium" | "low") => {
    setPatents(prev => prev.map(p => p.id === id ? { ...p, riskLevel: level } : p));
  };

  const updateComments = (id: string, text: string) => {
    setPatents(prev => prev.map(p => p.id === id ? { ...p, comments: text } : p));
  };

  const handleGenerateReport = () => {
    setLoading(true);
    const selectedPatents = patents.filter(p => p.selected);
    setTimeout(() => {
      navigate("/research/report", { state: { patents: selectedPatents } });
    }, 2000);
  };

  const riskColor = (level: string) => {
    switch (level) {
      case "high": return "bg-red-500/10 border-red-500/30 text-red-600";
      case "medium": return "bg-amber-500/10 border-amber-500/30 text-amber-600";
      case "low": return "bg-green-500/10 border-green-500/30 text-green-600";
      default: return "";
    }
  };

  return (
    <AppLayout>
      {loading && (
        <LoadingTransition
          message="Gerando relatório de evidências..."
          subMessage="Compilando patentes selecionadas e parecer técnico conforme Lei 9.279/96"
          duration={2000}
          onComplete={() => { }}
        />
      )}
      <WizardSteps currentStep={5} steps={steps} />

      <div className="max-w-5xl mx-auto space-y-8 pb-20">
        <div>
          <h1 className="text-2xl font-bold mb-1">Análise de Similaridade e Seleção</h1>
          <p className="text-muted-foreground text-sm">
            {patents.some(p => p.score > 0)
              ? "A IA analisou as patentes. Revise os resultados e selecione as relevantes para o relatório."
              : "Selecione as patentes relevantes para o relatório e adicione seus comentários técnicos."
            }
          </p>
        </div>

        <div className="space-y-6">
          {patents.map((patent) => (
            <Card key={patent.id} className={`border transition-all ${patent.selected ? "border-primary/50 shadow-md bg-accent/5" : "border-border opacity-80"}`}>
              <CardHeader className="pb-3 flex flex-row items-start gap-4">
                <Checkbox
                  checked={patent.selected}
                  onCheckedChange={() => toggleSelection(patent.id)}
                  className="mt-1.5"
                />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-base font-semibold leading-tight">
                      {patent.title}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      {patent.score > 0 && (
                        <Badge className={`text-[10px] ${riskColor(patent.riskLevel)}`}>
                          {patent.score}% sobreposição
                        </Badge>
                      )}
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {patent.publicationNumber}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {patent.applicant} • {patent.date || "Data N/A"}
                    {patent.classification && ` • IPC: ${patent.classification}`}
                  </p>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <p className="text-xs text-foreground/80 leading-relaxed line-clamp-3 bg-muted/20 p-2 rounded">
                  {patent.abstract || "Resumo não disponível."}
                </p>

                {patent.selected && (
                  <div className="pt-2 space-y-4 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center gap-4">
                      <span className="text-xs font-semibold text-muted-foreground uppercase">Nível de Risco:</span>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={patent.riskLevel === "low" ? "default" : "outline"}
                          className={`h-7 text-xs ${patent.riskLevel === "low" ? "bg-green-600 hover:bg-green-700" : "text-green-600 border-green-600/20"}`}
                          onClick={() => updateRisk(patent.id, "low")}
                        >
                          Baixo
                        </Button>
                        <Button
                          size="sm"
                          variant={patent.riskLevel === "medium" ? "default" : "outline"}
                          className={`h-7 text-xs ${patent.riskLevel === "medium" ? "bg-yellow-600 hover:bg-yellow-700" : "text-yellow-600 border-yellow-600/20"}`}
                          onClick={() => updateRisk(patent.id, "medium")}
                        >
                          Médio
                        </Button>
                        <Button
                          size="sm"
                          variant={patent.riskLevel === "high" ? "default" : "outline"}
                          className={`h-7 text-xs ${patent.riskLevel === "high" ? "bg-red-600 hover:bg-red-700" : "text-red-600 border-red-600/20"}`}
                          onClick={() => updateRisk(patent.id, "high")}
                        >
                          Alto
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-2">
                        Parecer Técnico / Justificativa
                      </label>
                      <Textarea
                        placeholder="Descreva os elementos conflitantes ou diferenciais deste documento..."
                        className="text-sm min-h-[80px]"
                        value={patent.comments}
                        onChange={(e) => updateComments(patent.id, e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          {patents.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">
              Nenhuma patente para analisar. Volte e realize uma busca.
            </div>
          )}
        </div>

        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 backdrop-blur border-t z-10 flex justify-center gap-4">
          <Button variant="outline" onClick={() => navigate("/research/results")} className="shadow-sm">
            Voltar aos Resultados
          </Button>
          <Button
            onClick={handleGenerateReport}
            disabled={patents.filter(p => p.selected).length === 0}
            className="shadow-lg shadow-primary/20 min-w-[200px]"
          >
            <FileText className="w-4 h-4 mr-2" />
            Gerar Relatório ({patents.filter(p => p.selected).length})
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
