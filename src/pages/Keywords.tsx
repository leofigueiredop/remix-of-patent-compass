import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import AppLayout from "@/components/AppLayout";
import WizardSteps from "@/components/WizardSteps";
import LoadingTransition from "@/components/LoadingTransition";
import { mockKeywords, mockClassifications } from "@/data/mockData";

const steps = ["Briefing", "Transcrição", "Briefing Técnico", "Palavras-chave", "Resultados", "Análise", "Relatório"];

export default function Keywords() {
  const navigate = useNavigate();
  const [keywords, setKeywords] = useState(mockKeywords);
  const [classifications, setClassifications] = useState(mockClassifications);
  const [newKeyword, setNewKeyword] = useState("");
  const [newClassCode, setNewClassCode] = useState("");
  const [loading, setLoading] = useState(false);

  const toggleKeyword = (id: string) => {
    setKeywords((prev) =>
      prev.map((k) => (k.id === id ? { ...k, selected: !k.selected } : k))
    );
  };

  const toggleClassification = (id: string) => {
    setClassifications((prev) =>
      prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c))
    );
  };

  const addKeyword = () => {
    if (!newKeyword.trim()) return;
    setKeywords((prev) => [
      ...prev,
      { id: Date.now().toString(), term: newKeyword.trim(), selected: true },
    ]);
    setNewKeyword("");
  };

  const removeKeyword = (id: string) => {
    setKeywords((prev) => prev.filter((k) => k.id !== id));
  };

  return (
    <AppLayout>
      {loading && (
        <LoadingTransition
          message="Pesquisando nas bases de patentes..."
          subMessage="Consultando INPI e Espacenet"
          duration={4000}
          onComplete={() => navigate("/research/results")}
        />
      )}
      <WizardSteps currentStep={3} steps={steps} />

      <div className="max-w-4xl">
        <h1 className="text-2xl font-bold mb-1">Palavras-chave e Classificação</h1>
        <p className="text-muted-foreground text-sm mb-8">
          Defina a estratégia de busca selecionando termos e classificações
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Keywords */}
          <div className="bg-card rounded-lg border">
            <div className="px-5 py-3 border-b">
              <h2 className="text-sm font-semibold">Palavras-chave</h2>
            </div>
            <div className="p-4 space-y-2">
              {keywords.map((kw) => (
                <div
                  key={kw.id}
                  className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={kw.selected}
                      onCheckedChange={() => toggleKeyword(kw.id)}
                    />
                    <span className="text-sm">{kw.term}</span>
                  </div>
                  <button
                    onClick={() => removeKeyword(kw.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2 pt-2">
                <Input
                  placeholder="Adicionar termo..."
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addKeyword()}
                  className="text-sm"
                />
                <Button variant="outline" size="sm" onClick={addKeyword}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Classifications */}
          <div className="bg-card rounded-lg border">
            <div className="px-5 py-3 border-b">
              <h2 className="text-sm font-semibold">Classificações Técnicas (IPC)</h2>
            </div>
            <div className="p-4 space-y-2">
              {classifications.map((cls) => (
                <div
                  key={cls.id}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50"
                >
                  <Checkbox
                    checked={cls.selected}
                    onCheckedChange={() => toggleClassification(cls.id)}
                  />
                  <div>
                    <span className="text-sm font-mono font-medium">{cls.code}</span>
                    <p className="text-xs text-muted-foreground">{cls.description}</p>
                  </div>
                </div>
              ))}
              <div className="flex gap-2 pt-2">
                <Input
                  placeholder="Ex: G06F 17/00"
                  value={newClassCode}
                  onChange={(e) => setNewClassCode(e.target.value)}
                  className="text-sm font-mono"
                />
                <Button variant="outline" size="sm" onClick={() => setNewClassCode("")}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-between mt-8">
          <Button variant="outline" onClick={() => navigate("/research/structured")}>
            Voltar
          </Button>
          <Button onClick={() => setLoading(true)}>
            Confirmar Estratégia de Busca
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
