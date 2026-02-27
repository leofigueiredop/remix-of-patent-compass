import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import LoadingTransition from "@/components/LoadingTransition";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AppLayout from "@/components/AppLayout";
import WizardSteps from "@/components/WizardSteps";
import { useResearch } from "@/contexts/ResearchContext";
import { aiService } from "@/services/ai";

const steps = ["Briefing", "Transcrição", "Briefing Técnico", "Palavras-chave", "Resultados", "Análise", "Relatório"];

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 70 ? "bg-risk-high/15 text-risk-high" :
      score >= 50 ? "bg-risk-medium/15 text-risk-medium" :
        "bg-risk-low/15 text-risk-low";
  return (
    <span className={`score-badge text-sm ${color}`}>
      {score}%
    </span>
  );
}

export default function SearchResults() {
  const navigate = useNavigate();
  const { searchResults, briefing, cqlQuery } = useResearch();
  const [tab, setTab] = useState("espacenet");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const espacenetResults = (searchResults?.espacenet || []).map((p: any) => ({
    id: p.publicationNumber || p.number,
    title: p.title,
    number: p.publicationNumber || p.number,
    applicant: p.applicant || "Desconhecido",
    date: p.date || "",
    abstract: p.abstract || "",
    score: p.score || 0,
    source: "Espacenet",
    url: p.url,
    classification: p.classification || "",
  }));

  const inpiResults = (searchResults?.inpi || []).map((p: any, idx: number) => ({
    id: p.publicationNumber || p.numero || `inpi-${idx}`,
    title: p.titulo || p.title || "Sem título",
    number: p.publicationNumber || p.numero || p.number || "",
    applicant: p.titular || p.applicant || "Desconhecido",
    date: p.dataDeposito || p.date || "",
    abstract: p.resumo || p.abstract || "",
    score: p.score || 0,
    source: "INPI",
    url: p.url,
    classification: p.classification || "",
  }));

  const patentList = tab === "inpi" ? inpiResults : espacenetResults;
  const allResults = [...espacenetResults, ...inpiResults];
  const totalResults = allResults.length;

  const handleAnalyze = async () => {
    setError(null);
    setLoading(true);
    try {
      // Call AI analysis with all patents + briefing
      const response = await aiService.analyzePatents(allResults, briefing);
      navigate("/research/analysis", {
        state: { results: allResults, analyzed: response.patents }
      });
    } catch (err: any) {
      // If AI fails, proceed without AI analysis
      console.warn("AI analysis failed, proceeding manually:", err.message);
      navigate("/research/analysis", {
        state: { results: allResults }
      });
    }
  };

  return (
    <AppLayout>
      {loading && (
        <LoadingTransition
          message="Analisando similaridade técnica com IA..."
          subMessage="Comparando reivindicações e classificações (pode levar alguns minutos)"
          duration={5000}
          onComplete={() => { }}
        />
      )}
      <WizardSteps currentStep={4} steps={steps} />

      <div className="max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Resultados de Busca</h1>
          <p className="text-muted-foreground text-sm">
            {totalResults > 0
              ? `${totalResults} patentes encontradas`
              : "Nenhum resultado encontrado. Tente ajustar suas palavras-chave."
            }
          </p>
        </div>

        {error && (
          <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg">
            {error}
          </div>
        )}

        {cqlQuery && (
          <div className="bg-muted/30 p-3 rounded-lg border text-xs font-mono text-muted-foreground break-all">
            QUERY: {cqlQuery}
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="espacenet">
              Espacenet ({espacenetResults.length})
            </TabsTrigger>
            <TabsTrigger value="inpi">
              INPI ({inpiResults.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="mt-4 space-y-3">
            {patentList.map((patent) => (
              <div key={patent.id} className="patent-card flex items-start gap-4">
                {patent.score > 0 && <ScoreBadge score={patent.score} />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs font-mono font-medium text-accent bg-accent/10 px-2 py-0.5 rounded">
                      {patent.number}
                    </span>
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {patent.source}
                    </span>
                    {patent.date && (
                      <span className="text-xs text-muted-foreground">{patent.date}</span>
                    )}
                  </div>
                  <p className="text-sm font-medium mb-1">{patent.title}</p>
                  <p className="text-xs text-muted-foreground">{patent.applicant}</p>
                  {patent.abstract && (
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                      {patent.abstract}
                    </p>
                  )}
                  {patent.classification && (
                    <p className="text-xs text-muted-foreground mt-1">
                      <span className="font-medium">IPC:</span> {patent.classification}
                    </p>
                  )}
                </div>
                {patent.url && (
                  <a href={patent.url} target="_blank" rel="noopener noreferrer">
                    <Button variant="ghost" size="sm" className="shrink-0 gap-1.5 text-xs">
                      <ExternalLink className="w-3.5 h-3.5" />
                      Abrir
                    </Button>
                  </a>
                )}
              </div>
            ))}
            {patentList.length === 0 && (
              <div className="text-center py-10 text-muted-foreground">
                Nenhum resultado encontrado nesta base.
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="flex justify-between mt-8">
          <Button variant="outline" onClick={() => navigate("/research/keywords")}>
            Voltar
          </Button>
          <Button
            onClick={handleAnalyze}
            disabled={totalResults === 0 || loading}
          >
            Prosseguir para Análise
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
