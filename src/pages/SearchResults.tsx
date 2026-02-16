import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ExternalLink, AlertCircle } from "lucide-react";
import LoadingTransition from "@/components/LoadingTransition";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import AppLayout from "@/components/AppLayout";
import WizardSteps from "@/components/WizardSteps";
import { mockPatents } from "@/data/mockData";
import { OpsSearchResult } from "@/services/espacenet"; // Import type

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
  const location = useLocation();
  const [tab, setTab] = useState("espacenet"); // Default to Espacenet if we have real results
  const [loading, setLoading] = useState(false);

  // Get state from navigation
  const { results, query, error } = location.state || {};
  const realEspacenetResults: OpsSearchResult[] = results || [];

  const displayedEspacenet = realEspacenetResults.length > 0
    ? realEspacenetResults.map(p => ({
      id: p.publicationNumber,
      title: p.title,
      number: p.publicationNumber,
      applicant: p.applicant,
      date: p.date,
      abstract: p.abstract,
      score: Math.floor(Math.random() * 40) + 60, // Simulate score for now as OPS doesn't give similarity score easily
      source: "Espacenet"
    }))
    : mockPatents.filter((p) => p.source === "Espacenet");

  const inpiPatents = mockPatents.filter((p) => p.source === "INPI");

  // Use mock or real list
  const patentList = tab === "inpi" ? inpiPatents : displayedEspacenet;

  return (
    <AppLayout>
      {loading && (
        <LoadingTransition
          message="Analisando similaridade técnica..."
          subMessage="Comparando reivindicações e classificações"
          duration={3500}
          onComplete={() => navigate("/research/analysis")}
        />
      )}
      <WizardSteps currentStep={4} steps={steps} />

      <div className="max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Resultados de Busca</h1>
          <p className="text-muted-foreground text-sm">
            {realEspacenetResults.length > 0
              ? `${realEspacenetResults.length} resultados reais encontrados via Espacenet (OPS)`
              : `${mockPatents.length} patentes encontradas (Modo Simulação)`
            }
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Erro na Busca</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {query && (
          <div className="bg-muted/30 p-3 rounded-lg border text-xs font-mono text-muted-foreground break-all">
            QUERY: {query}
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="espacenet">
              Espacenet ({displayedEspacenet.length})
            </TabsTrigger>
            <TabsTrigger value="inpi">
              INPI ({inpiPatents.length})
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
                <Button variant="ghost" size="sm" className="shrink-0 gap-1.5 text-xs">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir
                </Button>
              </div>
            ))}
            {patentList.length === 0 && (
              <div className="text-center py-10 text-muted-foreground">
                Nenhum resultado encontrado.
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="flex justify-between mt-8">
          <Button variant="outline" onClick={() => navigate("/research/keywords")}>
            Voltar
          </Button>
          <Button onClick={() => setLoading(true)}>
            Prosseguir para Análise
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
