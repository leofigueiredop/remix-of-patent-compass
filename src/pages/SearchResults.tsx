import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import LoadingTransition from "@/components/LoadingTransition";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AppLayout from "@/components/AppLayout";
import WizardSteps from "@/components/WizardSteps";

const steps = ["Briefing", "Transcrição", "Briefing Técnico", "Palavras-chave", "Resultados", "Análise", "Relatório"];

interface SearchResultItem {
  id: string;
  title: string;
  number: string;
  applicant: string;
  date: string;
  abstract: string;
  score: number;
  source: string;
  url?: string;
}

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
  const location = useLocation();
  const [tab, setTab] = useState("espacenet");
  const [loading, setLoading] = useState(false);

  // Get state from navigation (set by Keywords page after search)
  const { results, query } = (location.state || {}) as {
    results?: { espacenet?: any[]; inpi?: any[] };
    query?: string;
  };

  const espacenetResults: SearchResultItem[] = (results?.espacenet || []).map((p: any) => ({
    id: p.publicationNumber || p.number,
    title: p.title,
    number: p.publicationNumber || p.number,
    applicant: p.applicant || "Desconhecido",
    date: p.date || "",
    abstract: p.abstract || "",
    score: p.score || 0,
    source: "Espacenet",
    url: p.url,
  }));

  const inpiResults: SearchResultItem[] = (results?.inpi || []).map((p: any, idx: number) => ({
    id: p.numero || `inpi-${idx}`,
    title: p.titulo || p.title || "Sem título",
    number: p.numero || p.number || "",
    applicant: p.titular || p.applicant || "Desconhecido",
    date: p.dataDeposito || p.date || "",
    abstract: p.resumo || p.abstract || "",
    score: p.score || 0,
    source: "INPI",
    url: p.url,
  }));

  const patentList = tab === "inpi" ? inpiResults : espacenetResults;
  const totalResults = espacenetResults.length + inpiResults.length;

  return (
    <AppLayout>
      {loading && (
        <LoadingTransition
          message="Analisando similaridade técnica..."
          subMessage="Comparando reivindicações e classificações"
          duration={3500}
          onComplete={() => navigate("/research/analysis", {
            state: { results: [...espacenetResults, ...inpiResults] }
          })}
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

        {query && (
          <div className="bg-muted/30 p-3 rounded-lg border text-xs font-mono text-muted-foreground break-all">
            QUERY: {query}
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
                <ScoreBadge score={patent.score} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium mb-1">{patent.title}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="font-mono">{patent.number}</span>
                    <span>{patent.applicant}</span>
                    <span>{patent.date ? new Date(patent.date.toString().replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')).toLocaleDateString("pt-BR") : "N/A"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                    {patent.abstract}
                  </p>
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
            onClick={() => setLoading(true)}
            disabled={totalResults === 0}
          >
            Prosseguir para Análise
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
