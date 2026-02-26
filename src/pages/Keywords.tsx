import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, X, ListFilter, Braces, Search, Trash2, ArrowRight, Copy, ThumbsUp, ThumbsDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AppLayout from "@/components/AppLayout";
import WizardSteps from "@/components/WizardSteps";
import LoadingTransition from "@/components/LoadingTransition";
import { useResearch } from "@/contexts/ResearchContext";
import { aiService } from "@/services/ai";

const steps = ["Briefing", "Transcrição", "Briefing Técnico", "Palavras-chave", "Resultados", "Análise", "Relatório"];

interface KeywordGroup {
  id: string;
  terms: string[];
}

interface StrategyBlock {
  id: string;
  groups: KeywordGroup[];
  connector: "AND" | "OR";
}

export default function Keywords() {
  const navigate = useNavigate();
  const { strategy, setSearchResults, setCqlQuery, briefing } = useResearch();

  // Initialize blocks from strategy (LLM-generated keywords)
  const [blocks, setBlocks] = useState<StrategyBlock[]>([{
    id: "b1",
    connector: "AND",
    groups: [{ id: "g1", terms: [] }]
  }]);

  const [classifications, setClassifications] = useState<string[]>([]);
  const [newTerm, setNewTerm] = useState<{ blockId: string; groupId: string; value: string }>({ blockId: "", groupId: "", value: "" });
  const [newClassCode, setNewClassCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate from strategy when available
  useEffect(() => {
    if (strategy) {
      const ptTerms = strategy.keywords_pt || [];
      const enTerms = strategy.keywords_en || [];
      setBlocks([{
        id: "b1",
        connector: "AND",
        groups: [
          { id: "g1", terms: ptTerms.slice(0, 4) },
          { id: "g2", terms: enTerms.slice(0, 4) }
        ].filter(g => g.terms.length > 0)
      }]);
      setClassifications(strategy.ipc_codes || []);
    }
  }, [strategy]);

  const addBlock = () => {
    setBlocks([...blocks, {
      id: Date.now().toString(),
      connector: "AND",
      groups: [{ id: `g-${Date.now()}`, terms: [] }]
    }]);
  };

  const removeBlock = (id: string) => {
    if (blocks.length > 1) setBlocks(blocks.filter(b => b.id !== id));
  };

  const addGroupToBlock = (blockId: string) => {
    setBlocks(blocks.map(b =>
      b.id === blockId
        ? { ...b, groups: [...b.groups, { id: `g-${Date.now()}`, terms: [] }] }
        : b
    ));
  };

  const removeGroupFromBlock = (blockId: string, groupId: string) => {
    setBlocks(blocks.map(b => {
      if (b.id !== blockId) return b;
      const newGroups = b.groups.filter(g => g.id !== groupId);
      return { ...b, groups: newGroups.length > 0 ? newGroups : [{ id: `g-${Date.now()}`, terms: [] }] };
    }));
  };

  const addTermToGroup = (blockId: string, groupId: string) => {
    if (!newTerm.value.trim() || newTerm.blockId !== blockId || newTerm.groupId !== groupId) return;
    setBlocks(blocks.map(b => {
      if (b.id !== blockId) return b;
      return {
        ...b,
        groups: b.groups.map(g =>
          g.id === groupId ? { ...g, terms: [...g.terms, newTerm.value.trim()] } : g
        )
      };
    }));
    setNewTerm({ blockId: "", groupId: "", value: "" });
  };

  const removeTerm = (blockId: string, groupId: string, term: string) => {
    setBlocks(blocks.map(b => {
      if (b.id !== blockId) return b;
      return {
        ...b,
        groups: b.groups.map(g =>
          g.id === groupId ? { ...g, terms: g.terms.filter(t => t !== term) } : g
        )
      };
    }));
  };

  const addClassification = () => {
    if (!newClassCode.trim()) return;
    if (!classifications.includes(newClassCode.trim())) {
      setClassifications([...classifications, newClassCode.trim()]);
    }
    setNewClassCode("");
  };

  const removeClassification = (code: string) => {
    setClassifications(classifications.filter(c => c !== code));
  };

  const updateBlockConnector = (id: string, connector: "AND" | "OR") => {
    setBlocks(blocks.map(b => b.id === id ? { ...b, connector } : b));
  };

  const renderQuery = (forApi = false) => {
    const blockQueries = blocks.map(block => {
      const groupQueries = block.groups
        .filter(g => g.terms.length > 0)
        .map(g => {
          const terms = g.terms.map(t => {
            return forApi ? `(ti all "${t}" OR ab all "${t}")` : t;
          });
          return `(${terms.join(" OR ")})`;
        });

      if (groupQueries.length === 0) return "";
      return groupQueries.length === 1 ? groupQueries[0] : `(${groupQueries.join(" AND ")})`;
    }).filter(q => q !== "");

    let query = blockQueries.length > 0 ? blockQueries[0] : "";
    for (let i = 1; i < blockQueries.length; i++) {
      query = `(${query} ${blocks[i - 1].connector} ${blockQueries[i]})`;
    }

    const classQuery = classifications.length > 0
      ? ` AND (${classifications.map(c => forApi ? `ic="${c}"` : `IPC: ${c}`).join(" OR ")})`
      : "";

    if (!query && classifications.length === 0) return "";
    return `${query}${classQuery}`;
  };

  // Collect all keywords for INPI search
  const getAllKeywords = (): string[] => {
    const allTerms: string[] = [];
    blocks.forEach(b => b.groups.forEach(g => allTerms.push(...g.terms)));
    return allTerms;
  };

  const handleExecution = async () => {
    setError(null);
    setLoading(true);
    const cql = renderQuery(true);
    setCqlQuery(cql);

    try {
      const results = await aiService.searchPatents(cql, getAllKeywords(), classifications);
      setSearchResults(results);
      navigate("/research/results");
    } catch (err: any) {
      setError(err.message || "Erro na busca. Verifique as credenciais do Espacenet.");
      setLoading(false);
    }
  };

  return (
    <AppLayout>
      {loading && (
        <LoadingTransition
          message="Pesquisando nas bases de patentes..."
          subMessage="Consultando Espacenet (EPO) e INPI em tempo real..."
          duration={2000}
          onComplete={() => { }}
          mode="detailed"
        />
      )}
      <WizardSteps currentStep={3} steps={steps} />

      <div className="max-w-6xl space-y-8">
        <div>
          <h1 className="text-2xl font-bold mb-1">Estratégia de Busca Avançada</h1>
          <p className="text-muted-foreground text-sm">
            Construa lógicas horizontais (AND) e camadas verticais (AND/OR)
          </p>
        </div>

        {error && (
          <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Strategy Blocks Area */}
        <div className="space-y-8">
          {blocks.map((block, bIndex) => (
            <div key={block.id} className="space-y-6">
              <div className="bg-card/30 rounded-xl border-2 border-dashed border-border p-6 relative">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-bold uppercase tracking-tighter text-muted-foreground flex items-center gap-2">
                    <Braces className="w-4 h-4" /> Camada {bIndex + 1}
                  </h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeBlock(block.id)}
                    disabled={blocks.length === 1}
                    className="h-7 text-muted-foreground hover:text-destructive transition-colors px-2"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Remover Camada
                  </Button>
                </div>

                {/* Horizontal Groups */}
                <div className="flex flex-wrap gap-4">
                  {block.groups.map((group, gIndex) => (
                    <div key={group.id} className="flex-1 min-w-[300px] flex items-center gap-2">
                      {gIndex > 0 && <div className="text-[10px] font-black text-accent bg-accent/10 px-1 rounded">AND</div>}
                      <div className="bg-card rounded-lg border shadow-sm p-4 flex-1 group/item">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase">Grupo {gIndex + 1} (OR)</span>
                          <button
                            onClick={() => removeGroupFromBlock(block.id, group.id)}
                            className="opacity-0 group-hover/item:opacity-100 hover:text-destructive transition-all"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>

                        <div className="flex flex-wrap gap-1.5 mb-3 min-h-[32px]">
                          {group.terms.map((term) => (
                            <Badge
                              key={term}
                              variant="secondary"
                              className="px-1.5 py-0.5 gap-1 text-[11px] bg-muted/60 hover:bg-muted border-none"
                            >
                              {term}
                              <button onClick={() => removeTerm(block.id, group.id, term)} className="hover:text-destructive">
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </Badge>
                          ))}
                        </div>

                        <div className="flex gap-1">
                          <Input
                            placeholder="Termo..."
                            value={(newTerm.blockId === block.id && newTerm.groupId === group.id) ? newTerm.value : ""}
                            onChange={(e) => setNewTerm({ blockId: block.id, groupId: group.id, value: e.target.value })}
                            onKeyDown={(e) => e.key === "Enter" && addTermToGroup(block.id, group.id)}
                            className="text-xs h-7 px-2"
                          />
                          <Button size="icon" onClick={() => addTermToGroup(block.id, group.id)} className="h-7 w-7">
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => addGroupToBlock(block.id)}
                    className="flex-1 min-w-[150px] border-2 border-dashed border-border rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent/5 hover:border-accent/50 transition-all text-sm gap-2"
                  >
                    <Plus className="w-4 h-4" /> Add AND
                  </button>
                </div>
              </div>

              {/* Block Connector */}
              {bIndex < blocks.length - 1 && (
                <div className="flex justify-center -my-2 relative z-20">
                  <div className="bg-background flex items-center gap-2 p-1 border rounded-lg shadow-sm">
                    <Select
                      value={block.connector}
                      onValueChange={(val: "AND" | "OR") => updateBlockConnector(block.id, val)}
                    >
                      <SelectTrigger className="w-20 h-8 text-[10px] font-bold border-none bg-accent text-accent-foreground uppercase tracking-wider">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AND" className="text-[10px] font-bold">AND</SelectItem>
                        <SelectItem value="OR" className="text-[10px] font-bold">OR</SelectItem>
                      </SelectContent>
                    </Select>
                    <ArrowRight className="w-3 h-3 text-muted-foreground rotate-90" />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Logic Layer Button */}
        <div className="flex justify-end mb-2">
          <Button variant="outline" size="sm" onClick={addBlock} className="gap-2 h-10 px-4 font-semibold">
            <Plus className="w-4 h-4" /> Nova Camada Lógica
          </Button>
        </div>

        {/* Classifications Section (Horizontal) */}
        <div className="bg-card rounded-xl border p-6 space-y-4 shadow-sm">
          <div className="flex items-center gap-2">
            <ListFilter className="w-4 h-4 text-accent" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Classificações IPC / CPC (Editáveis)</h2>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2 flex-1">
              {classifications.map((code) => (
                <Badge
                  key={code}
                  variant="outline"
                  className="px-2 py-1 gap-2 font-mono text-xs bg-muted/20 border-border hover:bg-muted transition-colors"
                >
                  {code}
                  <button onClick={() => removeClassification(code)} className="hover:text-destructive">
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
              {classifications.length === 0 && (
                <p className="text-xs text-muted-foreground italic">Nenhuma classificação adicionada...</p>
              )}
            </div>

            <div className="flex gap-2 w-full md:w-auto">
              <Input
                placeholder="Código (ex: hf*, G01K 11/32)"
                value={newClassCode}
                onChange={(e) => setNewClassCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addClassification()}
                className="text-xs h-9 w-full md:w-48 font-mono"
              />
              <Button variant="outline" size="icon" onClick={addClassification} className="h-9 w-9 shrink-0">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Action Buttons Row */}
        <div className="flex justify-between items-center gap-4 pt-8 mt-4 border-t">
          <Button variant="outline" onClick={() => navigate("/research/structured")} className="h-10 px-6">
            Voltar
          </Button>
          <Button onClick={handleExecution} className="h-10 px-8 shadow-lg shadow-primary/20 font-bold" disabled={loading}>
            Executar Análise de Patenteabilidade
          </Button>
        </div>

        {/* Query Helper */}
        <div className="bg-muted/30 rounded-lg p-5 border border-dashed border-border mt-8">
          <div className="flex items-start gap-3 text-muted-foreground">
            <Search className="w-5 h-5 mt-1" />
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/50">Lógica Gerada pela IA (Copiável):</p>
                <Badge variant="outline" className="text-[10px] gap-1 py-0 h-5 bg-green-50 text-green-700 border-green-200">
                  <Check className="w-3 h-3" /> Lógica Otimizada
                </Badge>
              </div>
              <div className="bg-slate-950 text-slate-300 font-mono text-[13px] p-4 rounded-lg border border-slate-800 shadow-inner relative group">
                {renderQuery() || "(vazio — adicione termos acima)"}
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 h-6 w-6 text-slate-500 hover:text-white hover:bg-slate-800"
                  onClick={() => navigator.clipboard.writeText(renderQuery())}
                >
                  <Copy className="w-3 h-3" />
                </Button>
              </div>

              {/* Feedback Loop */}
              <div className="flex justify-end gap-2 mt-2">
                <p className="text-[10px] text-muted-foreground mr-2 self-center">Avaliar esta estratégia:</p>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full hover:bg-green-100 hover:text-green-600 transition-colors">
                    <ThumbsUp className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full hover:bg-red-100 hover:text-red-600 transition-colors">
                    <ThumbsDown className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
