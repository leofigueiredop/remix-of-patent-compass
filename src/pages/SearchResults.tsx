import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import LoadingTransition from "@/components/LoadingTransition";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AppLayout from "@/components/AppLayout";
import WizardSteps from "@/components/WizardSteps";
import { mockPatents } from "@/data/mockData";

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
  const [tab, setTab] = useState("inpi");
  const [loading, setLoading] = useState(false);

  const inpiPatents = mockPatents.filter((p) => p.source === "INPI");
  const espacenetPatents = mockPatents.filter((p) => p.source === "Espacenet");

  const renderPatentList = (patents: typeof mockPatents) => (
    <div className="space-y-3">
      {patents.map((patent) => (
        <div key={patent.id} className="patent-card flex items-start gap-4">
          <ScoreBadge score={patent.score} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium mb-1">{patent.title}</p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="font-mono">{patent.number}</span>
              <span>{patent.applicant}</span>
              <span>{new Date(patent.date).toLocaleDateString("pt-BR")}</span>
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
    </div>
  );

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

      <div>
        <h1 className="text-2xl font-bold mb-1">Resultados de Busca</h1>
        <p className="text-muted-foreground text-sm mb-6">
          {mockPatents.length} patentes encontradas nas bases selecionadas
        </p>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="inpi">
              INPI ({inpiPatents.length})
            </TabsTrigger>
            <TabsTrigger value="espacenet">
              Espacenet ({espacenetPatents.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="inpi" className="mt-4">
            {renderPatentList(inpiPatents)}
          </TabsContent>
          <TabsContent value="espacenet" className="mt-4">
            {renderPatentList(espacenetPatents)}
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
