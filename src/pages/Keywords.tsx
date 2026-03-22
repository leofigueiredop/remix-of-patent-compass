import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, X, ListFilter, Braces, Search, Trash2, ArrowRight, Copy, ThumbsUp, ThumbsDown, Check, ChevronDown, ChevronUp, Info, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import AppLayout from "@/components/AppLayout";
import WizardSteps from "@/components/WizardSteps";
import LoadingTransition from "@/components/LoadingTransition";
import { useResearch } from "@/contexts/ResearchContext";
import { aiService } from "@/services/ai";
import type { TechBlock, SearchLevel, IpcCode } from "@/contexts/ResearchContext";

const steps = ["Briefing", "Transcrição", "Briefing Técnico", "Palavras-chave", "Resultados", "Análise", "Relatório"];

interface KeywordGroup {
  id: string;
  terms_pt: string[];
  terms_en: string[];
}

interface StrategyBlock {
  id: string;
  groups: KeywordGroup[];
  connector: "AND" | "OR";
}

// ─── Build deterministic search levels from blocks ──────────────────────
// OPS CQL limit: ~300 chars. INPI Titulo: only OR is reliable (AND+parentheses hangs).
function buildSearchLevelsFromBlocks(blocks: StrategyBlock[], classifications: string[]): SearchLevel[] {
  const validBlocks = blocks.filter(b => b.groups.some(g => (g.terms_pt && g.terms_pt.length > 0) || (g.terms_en && g.terms_en.length > 0)));
  if (validBlocks.length === 0) return [];

  // Pick the N shortest single-word terms first, then add multi-word if room.
  const pickTerms = (bks: StrategyBlock[], maxPerBlock: number, lang: 'pt' | 'en') => {
    return bks.map(block => {
      const allTerms = block.groups.flatMap(g => lang === 'pt' ? (g.terms_pt || []) : (g.terms_en || [])).filter((t: string) => t && t.trim() !== '');
      // Sort: single-word first, then by length ascending
      const sorted = [...allTerms].sort((a, b) => {
        const aSingle = !a.includes(' ') ? 0 : 1;
        const bSingle = !b.includes(' ') ? 0 : 1;
        return aSingle - bSingle || a.length - b.length;
      });
      return sorted.slice(0, maxPerBlock);
    });
  };

  const buildCql = (bks: StrategyBlock[], maxTerms = 5): string => {
    const termSets = pickTerms(bks, maxTerms, 'en');
    const parts = termSets.map(terms => {
      if (terms.length === 0) return '';
      return `(${terms.map(t => t.includes(' ') ? `ta all "${t}"` : `ta all ${t}`).join(' OR ')})`;
    }).filter(p => p !== '');
    let q = parts.join(' AND ');
    // Add IPC if available and room
    if (classifications.length > 0) {
      const ipcPart = `(${classifications.slice(0, 2).map(c => `ic="${c}"`).join(' OR ')})`;
      if (q) {
        if ((q + ' AND ' + ipcPart).length <= 300) q += ` AND ${ipcPart}`;
      } else {
        if (ipcPart.length <= 300) q = ipcPart;
      }
    }
    // If still over 300 chars, reduce terms
    if (q.length > 300) {
      return buildCql(bks, Math.max(2, maxTerms - 1));
    }
    return q;
  };

  // INPI: only OR is reliable. AND+parentheses causes timeouts.
  // So we just OR together the best Portuguese terms from the selected blocks.
  const buildInpi = (bks: StrategyBlock[], maxTerms = 8): string => {
    const ptTerms = bks.flatMap(block =>
      block.groups.flatMap(g => (g.terms_pt || [])).filter((t: string) => t && t.trim() !== '')
    );
    const enTerms = bks.flatMap(block =>
      block.groups.flatMap(g => (g.terms_en || [])).filter((t: string) => t && t.trim() !== '')
    );
    const all: string[] = [];
    const seen = new Set<string>();
    const pushUnique = (term: string) => {
      const key = term.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      all.push(term);
    };
    ptTerms.forEach(pushUnique);
    enTerms.forEach(pushUnique);
    if (all.length === 0) return '';
    const sorted = [...all].sort((a, b) => {
      const aSingle = a.includes(' ') ? 1 : 0;
      const bSingle = b.includes(' ') ? 1 : 0;
      return aSingle - bSingle || a.length - b.length;
    });
    const limited = sorted.slice(0, maxTerms);
    return limited.map(t => t.includes(' ') ? `"${t}"` : t).join(' OR ');
  };

  const levels: SearchLevel[] = [];

  if (validBlocks.length >= 1) {
    levels.push({
      level: 1,
      label: `Busca Ampla — apenas camada 1 (${validBlocks[0].groups.flatMap(g => [...(g.terms_pt || []), ...(g.terms_en || [])]).length} termos)`,
      cql: buildCql([validBlocks[0]], 6),
      inpi: buildInpi([validBlocks[0]], 10),
    });
  }
  if (validBlocks.length >= 2) {
    levels.push({
      level: 2,
      label: `Interseção — camada 1 AND camada 2`,
      cql: buildCql(validBlocks.slice(0, 2), 4),
      inpi: buildInpi(validBlocks.slice(0, 2), 10),
    });
  }
  if (validBlocks.length >= 3) {
    levels.push({
      level: 3,
      label: `Busca Refinada — todas as ${validBlocks.length} camadas`,
      cql: buildCql(validBlocks, 3),
      inpi: buildInpi(validBlocks, 12),
    });
  }

  return levels;
}

export default function Keywords() {
  const navigate = useNavigate();
  const { strategy, setSearchResults, setCqlQuery, briefing, trackJourneyStep } = useResearch();

  // Initialize blocks from strategy (LLM-generated keywords)
  const [blocks, setBlocks] = useState<StrategyBlock[]>([{
    id: "b1",
    connector: "AND",
    groups: [{ id: "g1", terms_pt: [], terms_en: [] }]
  }]);

  const [classifications, setClassifications] = useState<string[]>([]);
  const [ipcDetails, setIpcDetails] = useState<IpcCode[]>([]);
  const [techBlocks, setTechBlocks] = useState<TechBlock[]>([]);
  const [searchLevels, setSearchLevels] = useState<SearchLevel[]>([]);
  const [selectedLevel, setSelectedLevel] = useState<string>("custom");
  const [showTechBlocks, setShowTechBlocks] = useState(true);
  const [newTerm, setNewTerm] = useState<{ blockId: string; groupId: string; value: string; lang: 'pt' | 'en' }>({ blockId: "", groupId: "", value: "", lang: 'pt' });
  const [newClassCode, setNewClassCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [ignoreSecret, setIgnoreSecret] = useState(false);

  useEffect(() => {
    trackJourneyStep("step_3_keywords", "view");
  }, [trackJourneyStep]);

  // Populate from strategy when available
  useEffect(() => {
    if (strategy) {
      let newBlocks: StrategyBlock[] = [];
      if (strategy.blocks && strategy.blocks.length > 0) {
        // Map old format to new format just in case
        newBlocks = strategy.blocks.map((b: any) => ({
          ...b,
          groups: b.groups.map((g: any) => ({
            ...g,
            terms_pt: g.terms_pt || g.termsPt || g.terms || [],
            terms_en: g.terms_en || g.termsEn || []
          }))
        }));
      } else {
        // Fallback for old strategy format
        const ptTerms = strategy.keywords_pt || [];
        const enTerms = strategy.keywords_en || [];
        newBlocks = [{
          id: "b1",
          connector: "AND",
          groups: [
            { id: "g1", terms_pt: ptTerms.slice(0, 4), terms_en: enTerms.slice(0, 4) }
          ].filter(g => (g.terms_pt && g.terms_pt.length > 0) || (g.terms_en && g.terms_en.length > 0))
        }];
      }
      setBlocks(newBlocks);

      // Parse IPC codes (support both string[] and IpcCode[] formats)
      const ipcCodes: string[] = [];
      const ipcDets: IpcCode[] = [];
      for (const ipc of (strategy.ipc_codes || [])) {
        if (typeof ipc === 'string') {
          ipcCodes.push(ipc);
        } else {
          ipcCodes.push(ipc.code);
          ipcDets.push(ipc);
        }
      }
      setClassifications(ipcCodes);
      setIpcDetails(ipcDets);

      // Tech blocks
      if (strategy.techBlocks) setTechBlocks(strategy.techBlocks);

      // Build search levels deterministically from blocks (not from LLM)
      const deterministicLevels = buildSearchLevelsFromBlocks(newBlocks, ipcCodes);
      setSearchLevels(deterministicLevels);
      // Default to "custom" so the user always sees the full query from all blocks
      setSelectedLevel("custom");
    }
  }, [strategy]);

  // Rebuild search levels whenever blocks or classifications change
  useEffect(() => {
    const levels = buildSearchLevelsFromBlocks(blocks, classifications);
    setSearchLevels(levels);
  }, [blocks, classifications]);

  const addBlock = () => {
    setBlocks([...blocks, {
      id: Date.now().toString(),
      connector: "AND",
      groups: [{ id: `g-${Date.now()}`, terms_pt: [], terms_en: [] }]
    }]);
  };

  const removeBlock = (id: string) => {
    if (blocks.length > 1) setBlocks(blocks.filter(b => b.id !== id));
  };

  const addGroupToBlock = (blockId: string) => {
    setBlocks(blocks.map(b =>
      b.id === blockId
        ? { ...b, groups: [...b.groups, { id: `g-${Date.now()}`, terms_pt: [], terms_en: [] }] }
        : b
    ));
  };

  const removeGroupFromBlock = (blockId: string, groupId: string) => {
    setBlocks(blocks.map(b => {
      if (b.id !== blockId) return b;
      const newGroups = b.groups.filter(g => g.id !== groupId);
      return { ...b, groups: newGroups.length > 0 ? newGroups : [{ id: `g-${Date.now()}`, terms_pt: [], terms_en: [] }] };
    }));
  };

  const addTermToGroup = (blockId: string, groupId: string, lang: 'pt' | 'en') => {
    if (!newTerm.value.trim() || newTerm.blockId !== blockId || newTerm.groupId !== groupId) return;
    setBlocks(blocks.map(b => {
      if (b.id !== blockId) return b;
      return {
        ...b,
        groups: b.groups.map(g => {
          if (g.id !== groupId) return g;
          return lang === 'pt'
            ? { ...g, terms_pt: [...(g.terms_pt || []), newTerm.value.trim()] }
            : { ...g, terms_en: [...(g.terms_en || []), newTerm.value.trim()] };
        })
      };
    }));
    setNewTerm({ blockId: "", groupId: "", value: "", lang: 'pt' });
  };

  const removeTerm = (blockId: string, groupId: string, term: string, lang: 'pt' | 'en') => {
    setBlocks(blocks.map(b => {
      if (b.id !== blockId) return b;
      return {
        ...b,
        groups: b.groups.map(g => {
          if (g.id !== groupId) return g;
          return lang === 'pt'
            ? { ...g, terms_pt: (g.terms_pt || []).filter(t => t !== term) }
            : { ...g, terms_en: (g.terms_en || []).filter(t => t !== term) };
        })
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
    setIpcDetails(ipcDetails.filter(d => d.code !== code));
  };

  const updateBlockConnector = (id: string, connector: "AND" | "OR") => {
    setBlocks(blocks.map(b => b.id === id ? { ...b, connector } : b));
  };

  // Build CQL query from blocks (Espacenet format)
  // Must stay under 300 chars for OPS API.
  const renderCqlQuery = () => {
    const blockQueries = blocks.map(block => {
      const allTerms = block.groups.flatMap(g => (g.terms_en || [])).filter(t => t && t.trim() !== "");
      if (allTerms.length === 0) return "";
      // Prefer shorter terms first for space efficiency
      const sorted = [...allTerms].sort((a, b) => a.length - b.length);
      const termsStr = sorted.map(t => t.includes(' ') ? `ta all "${t}"` : `ta all ${t}`).join(" OR ");
      return `(${termsStr})`;
    }).filter(q => q !== "");

    if (blockQueries.length === 0 && classifications.length === 0) return "";

    let query = blockQueries.length > 0 ? blockQueries[0] : "";
    for (let i = 1; i < blockQueries.length; i++) {
      query = `${query} ${blocks[i - 1].connector} ${blockQueries[i]}`;
    }

    const classQuery = classifications.length > 0
      ? `${query ? " AND " : ""}(${classifications.map(c => `ic="${c}"`).join(" OR ")})`
      : "";

    let fullQuery = `${query}${classQuery}`;

    // Enforce 300-char limit: progressively drop terms from largest block
    if (fullQuery.length > 300) {
      const reduced = blocks.map(block => {
        const allTerms = block.groups.flatMap(g => (g.terms_en || [])).filter(t => t && t.trim() !== "");
        // Keep max 4 shortest terms
        const sorted = [...allTerms].sort((a, b) => a.length - b.length).slice(0, 4);
        if (sorted.length === 0) return "";
        return `(${sorted.map(t => t.includes(' ') ? `ta all "${t}"` : `ta all ${t}`).join(" OR ")})`;
      }).filter(q => q !== "");

      query = reduced.length > 0 ? reduced[0] : "";
      for (let i = 1; i < reduced.length; i++) {
        query = `${query} AND ${reduced[i]}`;
      }
      fullQuery = query;
    }

    return fullQuery;
  };

  // Build display-friendly query from blocks
  const renderDisplayQuery = () => {
    const blockQueries = blocks.map(block => {
      const groupQueries = block.groups
        .filter(g => (g.terms_pt && g.terms_pt.length > 0) || (g.terms_en && g.terms_en.length > 0))
        .map(g => `(${[...(g.terms_pt || []), ...(g.terms_en || [])].join(" OR ")})`);

      if (groupQueries.length === 0) return "";
      return groupQueries.length === 1 ? groupQueries[0] : `(${groupQueries.join(" AND ")})`;
    }).filter(q => q !== "");

    let query = blockQueries.length > 0 ? blockQueries[0] : "";
    for (let i = 1; i < blockQueries.length; i++) {
      query = `(${query} ${blocks[i - 1].connector} ${blockQueries[i]})`;
    }

    const classQuery = classifications.length > 0
      ? ` AND (${classifications.map(c => `IPC: ${c}`).join(" OR ")})`
      : "";

    if (!query && classifications.length === 0) return "";
    return `${query}${classQuery}`;
  };

  const getInpiQuery = (): string => {
    const blockQueries = blocks.map(block => {
      const groupQueries = block.groups
        .map(g => {
          const terms = (g.terms_pt || []).filter(t => t && t.trim() !== "");
          if (terms.length === 0) return "";
          return `(${terms.map(t => t.includes(' ') ? `"${t}"` : t).join(" OR ")})`;
        })
        .filter(q => q !== "");

      if (groupQueries.length === 0) return "";
      return `(${groupQueries.join(" AND ")})`;
    }).filter(q => q !== "");

    if (blockQueries.length === 0) return "";

    let query = blockQueries[0];
    for (let i = 1; i < blockQueries.length; i++) {
      query = `${query} ${blocks[i - 1].connector} ${blockQueries[i]}`;
    }

    // Apply sane limit if it gets too colossal
    if (query.length > 350) {
      const reduced = blocks.map(block => {
        const terms = block.groups.flatMap(g => g.terms_pt || []).filter(t => t && t.trim() !== "");
        const sorted = [...terms].sort((a, b) => a.length - b.length).slice(0, 4);
        if (sorted.length === 0) return "";
        return `(${sorted.map(t => t.includes(' ') ? `"${t}"` : t).join(" OR ")})`;
      }).filter(q => q !== "");

      query = reduced.length > 0 ? reduced[0] : "";
      for (let i = 1; i < reduced.length; i++) {
        query = `${query} AND ${reduced[i]}`;
      }
    }

    return query;
  };

  const getActiveCql = (): string => {
    if (selectedLevel !== "custom") {
      const lvl = searchLevels.find(l => l.level === Number(selectedLevel));
      if (lvl) return lvl.cql;
    }
    return renderCqlQuery();
  };

  const getActiveInpi = (): string => {
    if (selectedLevel !== "custom") {
      const lvl = searchLevels.find(l => l.level === Number(selectedLevel));
      if (lvl) return lvl.inpi;
    }
    return getInpiQuery();
  };

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleExecution = async () => {
    setError(null);
    setLoading(true);
    const cql = getActiveCql();
    const inpiQuery = getActiveInpi();
    setCqlQuery(cql);

    try {
      const results = await aiService.searchPatents(cql, inpiQuery, classifications, ignoreSecret);
      setSearchResults(results);
      trackJourneyStep("step_3_keywords", "complete");
      navigate("/research/results");
    } catch (err: any) {
      setError(err.message || "Erro na busca. Verifique as credenciais do Espacenet e INPI.");
      setLoading(false);
    }
  };

  const getIpcJustification = (code: string): string | undefined => {
    return ipcDetails.find(d => d.code === code)?.justification;
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

      <div className="w-full space-y-8">
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

        {/* Overconstraint Warning */}
        {blocks.length > 3 && (
          <div className="flex items-center gap-3 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 text-sm p-3 rounded-lg border border-yellow-500/20">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              <strong>Atenção:</strong> {blocks.length} camadas com AND pode gerar overconstraint.
              Considere agrupar eixos relacionados para melhor recall.
            </span>
          </div>
        )}

        {/* Technology Blocks Section  */}
        {techBlocks.length > 0 && (
          <div className="bg-card/50 rounded-xl border p-5 space-y-3">
            <button
              onClick={() => setShowTechBlocks(!showTechBlocks)}
              className="flex items-center justify-between w-full text-left"
            >
              <div className="flex items-center gap-2">
                <Braces className="w-4 h-4 text-accent" />
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Blocos Tecnológicos ({techBlocks.length})
                </h2>
              </div>
              {showTechBlocks ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>

            {showTechBlocks && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
                {techBlocks.map((tb) => (
                  <div key={tb.id} className="bg-background rounded-lg border p-4 space-y-1.5">
                    <p className="text-sm font-semibold">{tb.name}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{tb.description}</p>
                  </div>
                ))}
              </div>
            )}
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

                        <div className="space-y-3">
                          {/* PT Section */}
                          <div className="bg-muted/30 p-2 rounded border border-border/50">
                            <div className="text-[10px] uppercase font-bold text-muted-foreground mb-2 flex items-center justify-between">
                              <span>🇧🇷 INPI (PT)</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 mb-2 min-h-[24px]">
                              {(group.terms_pt || []).map((term) => (
                                <Badge key={term} variant="secondary" className="px-1.5 py-0.5 gap-1 text-[11px] bg-muted/60 hover:bg-muted border-none">
                                  {term}
                                  <button onClick={() => removeTerm(block.id, group.id, term, 'pt')} className="hover:text-destructive"><X className="w-2.5 h-2.5" /></button>
                                </Badge>
                              ))}
                            </div>
                            <div className="flex gap-1">
                              <Input placeholder="Termo PT..." value={(newTerm.blockId === block.id && newTerm.groupId === group.id && newTerm.lang === 'pt') ? newTerm.value : ""} onChange={(e) => setNewTerm({ blockId: block.id, groupId: group.id, value: e.target.value, lang: 'pt' })} onKeyDown={(e) => e.key === "Enter" && addTermToGroup(block.id, group.id, 'pt')} className="text-xs h-6 px-2 bg-background" />
                              <Button size="icon" onClick={() => addTermToGroup(block.id, group.id, 'pt')} className="h-6 w-6"><Plus className="w-3 h-3" /></Button>
                            </div>
                          </div>

                          {/* EN Section */}
                          <div className="bg-muted/30 p-2 rounded border border-border/50">
                            <div className="text-[10px] uppercase font-bold text-muted-foreground mb-2 flex items-center justify-between">
                              <span>🇬🇧 Espacenet (EN)</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 mb-2 min-h-[24px]">
                              {(group.terms_en || []).map((term) => (
                                <Badge key={term} variant="secondary" className="px-1.5 py-0.5 gap-1 text-[11px] bg-sky-900/20 text-sky-400 hover:bg-sky-900/40 border-none">
                                  {term}
                                  <button onClick={() => removeTerm(block.id, group.id, term, 'en')} className="hover:text-destructive"><X className="w-2.5 h-2.5" /></button>
                                </Badge>
                              ))}
                            </div>
                            <div className="flex gap-1">
                              <Input placeholder="Termo EN..." value={(newTerm.blockId === block.id && newTerm.groupId === group.id && newTerm.lang === 'en') ? newTerm.value : ""} onChange={(e) => setNewTerm({ blockId: block.id, groupId: group.id, value: e.target.value, lang: 'en' })} onKeyDown={(e) => e.key === "Enter" && addTermToGroup(block.id, group.id, 'en')} className="text-xs h-6 px-2 bg-background" />
                              <Button size="icon" onClick={() => addTermToGroup(block.id, group.id, 'en')} className="h-6 w-6"><Plus className="w-3 h-3" /></Button>
                            </div>
                          </div>
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
              {classifications.map((code) => {
                const justification = getIpcJustification(code);
                return (
                  <div key={code} className="relative group/ipc">
                    <Badge
                      variant="outline"
                      className="px-2 py-1 gap-2 font-mono text-xs bg-muted/20 border-border hover:bg-muted transition-colors cursor-default"
                    >
                      {code}
                      {justification && <Info className="w-3 h-3 text-muted-foreground" />}
                      <button onClick={() => removeClassification(code)} className="hover:text-destructive">
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                    {justification && (
                      <div className="absolute bottom-full left-0 mb-1 px-3 py-2 bg-popover text-popover-foreground text-xs rounded-lg shadow-lg border opacity-0 group-hover/ipc:opacity-100 transition-opacity z-30 whitespace-nowrap pointer-events-none">
                        {justification}
                      </div>
                    )}
                  </div>
                );
              })}
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
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-8 mt-4 border-t">
          <Button variant="outline" onClick={() => navigate("/research/structured")} className="h-10 px-6 shrink-0">
            Voltar
          </Button>
          <div className="flex flex-col sm:flex-row items-end sm:items-center gap-4 w-full sm:w-auto">
            <div className="flex items-center space-x-2">
              <Checkbox id="ignoreSecretAdvanced" checked={ignoreSecret} onCheckedChange={(c) => setIgnoreSecret(c === true)} />
              <label htmlFor="ignoreSecretAdvanced" className="text-sm font-medium leading-none cursor-pointer text-muted-foreground whitespace-nowrap">
                Ignorar patentes em sigilo / não publicadas
              </label>
            </div>
            <Button onClick={handleExecution} className="h-10 px-8 shadow-lg shadow-primary/20 font-bold shrink-0" disabled={loading}>
              Executar Análise de Patenteabilidade
            </Button>
          </div>
        </div>

        {/* Dual Query Preview */}
        <div className="bg-muted/30 rounded-lg p-5 border border-dashed border-border mt-8 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Search className="w-5 h-5 text-muted-foreground" />
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/50">
                Queries Geradas
              </p>
            </div>
            <Badge variant="outline" className="text-[10px] gap-1 py-0 h-5 bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800">
              <Check className="w-3 h-3" /> Lógica Otimizada
            </Badge>
          </div>

          {/* Search Level Selector */}
          {searchLevels.length > 0 && (
            <Tabs value={selectedLevel} onValueChange={setSelectedLevel}>
              <TabsList className="w-full grid grid-cols-4">
                <TabsTrigger value="custom" className="text-xs">Custom</TabsTrigger>
                {searchLevels.map((lvl) => (
                  <TabsTrigger key={lvl.level} value={String(lvl.level)} className="text-xs">
                    Nível {lvl.level}
                  </TabsTrigger>
                ))}
              </TabsList>

              {searchLevels.map((lvl) => (
                <TabsContent key={lvl.level} value={String(lvl.level)} className="mt-3">
                  <p className="text-xs text-muted-foreground mb-3 font-medium">{lvl.label}</p>
                </TabsContent>
              ))}
            </Tabs>
          )}

          {/* CQL Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-accent">
                CQL — Espacenet
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => handleCopy(getActiveCql(), 'cql')}
              >
                {copiedField === 'cql' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copiedField === 'cql' ? 'Copiado!' : 'Copiar'}
              </Button>
            </div>
            <div className="bg-slate-950 text-slate-300 font-mono text-[12px] p-4 rounded-lg border border-slate-800 shadow-inner break-all leading-relaxed">
              {getActiveCql() || "(vazio — adicione termos acima)"}
            </div>
          </div>

          {/* INPI Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500">
                Boolean — INPI
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => handleCopy(getActiveInpi(), 'inpi')}
              >
                {copiedField === 'inpi' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copiedField === 'inpi' ? 'Copiado!' : 'Copiar'}
              </Button>
            </div>
            <div className="bg-blue-950 text-blue-200 font-mono text-[12px] p-4 rounded-lg border border-blue-900 shadow-inner break-all leading-relaxed">
              {getActiveInpi() || "(vazio — adicione termos acima)"}
            </div>
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
    </AppLayout>
  );
}
