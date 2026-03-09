import { useState } from "react";
import { Search, Loader2, ExternalLink, Hash, User, UserCheck, FileText, X, ChevronDown, ChevronUp, Building2, Lightbulb, ChevronLeft, ChevronRight, Expand } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AppLayout from "@/components/AppLayout";
import PatentDocumentModal, { PatentDocumentData } from "@/components/PatentDocumentModal";
import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

interface PatentResult {
    publicationNumber: string;
    title: string;
    applicant: string;
    inventor?: string;
    date: string;
    abstract: string;
    classification: string;
    source: string;
    url: string;
    figures?: string[];
}

interface PatentDetail {
    applicant?: string;
    inventor?: string;
    abstract?: string;
    classification?: string;
    filingDate?: string;
    title?: string;
    status?: string;
    figures?: string[];
}

interface QuickSearchResponse {
    inpi?: PatentResult[];
    espacenet?: PatentResult[];
    totals?: {
        inpi?: number;
        espacenet?: number;
        all?: number;
    };
    results?: PatentResult[];
}

export default function QuickSearch() {
    const [number, setNumber] = useState("");
    const [titular, setTitular] = useState("");
    const [inventor, setInventor] = useState("");
    const [keywords, setKeywords] = useState("");
    const [inpiResults, setInpiResults] = useState<PatentResult[]>([]);
    const [espacenetResults, setEspacenetResults] = useState<PatentResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [error, setError] = useState("");
    const [tab, setTab] = useState<"inpi" | "espacenet">("inpi");
    const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
    const [detailCache, setDetailCache] = useState<Record<string, PatentDetail>>({});
    const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({});
    const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
    const [figureIndexByPatent, setFigureIndexByPatent] = useState<Record<string, number>>({});
    const [modalOpen, setModalOpen] = useState(false);
    const [modalFigures, setModalFigures] = useState<string[]>([]);
    const [modalIndex, setModalIndex] = useState(0);
    const [patentModalOpen, setPatentModalOpen] = useState(false);
    const [selectedPatent, setSelectedPatent] = useState<PatentDocumentData | null>(null);

    const hasInput = number || titular || inventor || keywords;
    const totalResults = inpiResults.length + espacenetResults.length;

    const prefetchInitialInpiDetails = (patents: PatentResult[]) => {
        const initial = patents.filter((p) => p.source === "INPI").slice(0, 10);
        initial.forEach((patent) => {
            const codPedido = getCodPedido(patent);
            if (!codPedido) return;
            void loadInpiDetail(codPedido, patent.publicationNumber);
        });
    };

    const getCodPedido = (patent: PatentResult): string | null => {
        if (!patent.url) return null;
        if (URL.canParse(patent.url)) {
            const parsed = new URL(patent.url);
            const codByQuery = parsed.searchParams.get("CodPedido") || parsed.searchParams.get("codPedido");
            if (codByQuery) return codByQuery;
        }
        const codMatch = patent.url.match(/[?&]CodPedido=([^&]+)/i);
        return codMatch ? decodeURIComponent(codMatch[1]) : null;
    };

    const readText = (value: unknown): string => {
        if (typeof value === "string") return value.trim();
        if (Array.isArray(value)) {
            return value
                .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
                .map((item) => item.trim())
                .join(" • ");
        }
        return "";
    };

    const normalizePatentDetail = (value: unknown): PatentDetail => {
        const raw = (value && typeof value === "object") ? (value as Record<string, unknown>) : {};
        const figuresRaw = raw.figures;
        const figures = Array.isArray(figuresRaw)
            ? figuresRaw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            : [];

        return {
            applicant: readText(raw.applicant) || undefined,
            inventor: readText(raw.inventor) || undefined,
            abstract: readText(raw.abstract) || undefined,
            classification: readText(raw.classification) || undefined,
            filingDate: readText(raw.filingDate) || undefined,
            title: readText(raw.title) || undefined,
            status: readText(raw.status) || undefined,
            figures
        };
    };

    const loadInpiDetail = async (codPedido: string, publicationNumber?: string) => {
        if (!codPedido) return;
        if (detailCache[codPedido]) return;
        if (loadingDetails[codPedido]) return;

        setDetailErrors(prev => {
            const next = { ...prev };
            delete next[codPedido];
            return next;
        });
        setLoadingDetails(prev => ({ ...prev, [codPedido]: true }));
        try {
            const response = await axios.get(`${API_URL}/search/inpi/detail/${codPedido}`, {
                params: publicationNumber ? { publicationNumber } : undefined
            });
            const normalizedDetail = normalizePatentDetail(response.data);
            setDetailCache(prev => ({ ...prev, [codPedido]: normalizedDetail }));
        } catch (err) {
            console.warn("Failed to load detail:", err);
            setDetailErrors(prev => ({
                ...prev,
                [codPedido]: "Não foi possível carregar os detalhes do INPI para esta patente."
            }));
        } finally {
            setLoadingDetails(prev => {
                const next = { ...prev };
                delete next[codPedido];
                return next;
            });
        }
    };

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!hasInput) return;

        setLoading(true);
        setError("");
        setSearched(true);
        setExpandedIdx(null);
        setDetailCache({});
        setLoadingDetails({});
        setDetailErrors({});
        setFigureIndexByPatent({});

        try {
            const response = await axios.post<QuickSearchResponse>(`${API_URL}/search/quick`, {
                number: number || undefined,
                titular: titular || undefined,
                inventor: inventor || undefined,
                keywords: keywords || undefined,
            });
            const fetchedInpi = response.data.inpi || [];
            const fetchedEspacenet = response.data.espacenet || [];
            setInpiResults(fetchedInpi);
            setEspacenetResults(fetchedEspacenet);
            setTab("inpi");
            prefetchInitialInpiDetails(fetchedInpi);
        } catch (err: unknown) {
            const message = axios.isAxiosError(err)
                ? (err.response?.data?.error as string | undefined)
                : undefined;
            setError(message || "Erro ao buscar patentes");
            setInpiResults([]);
            setEspacenetResults([]);
        } finally {
            setLoading(false);
        }
    };

    const toggleDetail = async (idx: number, patent: PatentResult) => {
        if (expandedIdx === idx) {
            setExpandedIdx(null);
            return;
        }
        setExpandedIdx(idx);

        if (patent.source !== "INPI") return;
        const codPedido = getCodPedido(patent);
        if (!codPedido) return;
        await loadInpiDetail(codPedido, patent.publicationNumber);
    };

    const getDetail = (patent: PatentResult): PatentDetail | null => {
        const codPedido = getCodPedido(patent);
        if (!codPedido) return null;
        return detailCache[codPedido] || null;
    };

    const getPatentKey = (patent: PatentResult, idx: number) => {
        return `${patent.source}-${patent.publicationNumber || idx}`;
    };

    const getPatentFigures = (patent: PatentResult, detail: PatentDetail | null): string[] => {
        const detailFigures = detail?.figures || [];
        const baseFigures = patent.figures || [];
        if (detailFigures.length > 0) return detailFigures;
        return baseFigures;
    };

    const getCurrentFigureIndex = (patent: PatentResult, idx: number, total: number) => {
        if (total <= 0) return 0;
        const key = getPatentKey(patent, idx);
        const current = figureIndexByPatent[key] || 0;
        return Math.min(current, total - 1);
    };

    const setFigureIndex = (patent: PatentResult, idx: number, nextIndex: number, total: number) => {
        if (total <= 0) return;
        const bounded = ((nextIndex % total) + total) % total;
        const key = getPatentKey(patent, idx);
        setFigureIndexByPatent(prev => ({ ...prev, [key]: bounded }));
    };

    const openFigureModal = (figures: string[], index: number) => {
        if (!figures.length) return;
        const bounded = Math.min(Math.max(index, 0), figures.length - 1);
        setModalFigures(figures);
        setModalIndex(bounded);
        setModalOpen(true);
    };

    const openPatentModal = (patent: PatentResult, detail?: PatentDetail | null) => {
        setSelectedPatent({
            publicationNumber: patent.publicationNumber,
            title: detail?.title || patent.title,
            applicant: detail?.applicant || patent.applicant,
            inventor: detail?.inventor || patent.inventor,
            date: detail?.filingDate || patent.date,
            abstract: detail?.abstract || patent.abstract,
            classification: detail?.classification || patent.classification,
            source: patent.source,
            url: patent.url,
            status: detail?.status
        });
        setPatentModalOpen(true);
    };

    const clearAll = () => {
        setNumber("");
        setTitular("");
        setInventor("");
        setKeywords("");
        setInpiResults([]);
        setEspacenetResults([]);
        setSearched(false);
        setError("");
        setExpandedIdx(null);
        setTab("inpi");
        setFigureIndexByPatent({});
        setModalOpen(false);
        setModalFigures([]);
        setModalIndex(0);
        setPatentModalOpen(false);
        setSelectedPatent(null);
    };

    return (
        <AppLayout>
            <div className="space-y-6">
                {/* Header */}
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                            <Search className="w-5 h-5 text-accent" />
                        </div>
                        Busca Rápida de Patentes
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Pesquise diretamente no INPI por número, titular, inventor ou palavras-chave
                    </p>
                </div>

                {/* Search Form */}
                <form onSubmit={handleSearch} className="bg-card rounded-xl border p-6 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="text-sm font-medium mb-1.5 flex items-center gap-2">
                                <Hash className="w-3.5 h-3.5 text-muted-foreground" />
                                Número do Pedido
                            </label>
                            <Input
                                placeholder="Ex: BR102018008765"
                                value={number}
                                onChange={(e) => setNumber(e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="text-sm font-medium mb-1.5 flex items-center gap-2">
                                <User className="w-3.5 h-3.5 text-muted-foreground" />
                                Titular / Depositante
                            </label>
                            <Input
                                placeholder="Ex: Petrobras, Embrapa..."
                                value={titular}
                                onChange={(e) => setTitular(e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="text-sm font-medium mb-1.5 flex items-center gap-2">
                                <UserCheck className="w-3.5 h-3.5 text-muted-foreground" />
                                Inventor
                            </label>
                            <Input
                                placeholder="Ex: João Silva"
                                value={inventor}
                                onChange={(e) => setInventor(e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="text-sm font-medium mb-1.5 flex items-center gap-2">
                                <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                                Palavras-chave (Título/Resumo)
                            </label>
                            <Input
                                placeholder="Ex: painel modular construção civil"
                                value={keywords}
                                onChange={(e) => setKeywords(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <Button type="submit" disabled={loading || !hasInput} className="gap-2">
                            {loading ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> Buscando...</>
                            ) : (
                                <><Search className="w-4 h-4" /> Buscar</>
                            )}
                        </Button>
                        {hasInput && (
                            <Button type="button" variant="outline" onClick={clearAll} className="gap-2">
                                <X className="w-4 h-4" /> Limpar
                            </Button>
                        )}
                    </div>
                </form>

                {/* Error */}
                {error && (
                    <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                        {error}
                    </div>
                )}

                {/* Results */}
                {searched && !loading && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold">
                                {totalResults > 0 ? `${totalResults} resultado${totalResults > 1 ? "s" : ""} encontrado${totalResults > 1 ? "s" : ""}` : "Nenhum resultado"}
                            </h2>
                        </div>

                        {totalResults === 0 ? (
                            <div className="bg-card rounded-xl border p-12 text-center">
                                <Search className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                                <p className="text-muted-foreground">
                                    Nenhuma patente encontrada com os critérios informados.
                                </p>
                                <p className="text-sm text-muted-foreground/70 mt-1">
                                    Tente termos mais genéricos ou verifique o número do pedido.
                                </p>
                            </div>
                        ) : (
                            <Tabs value={tab} onValueChange={(value) => setTab(value as "inpi" | "espacenet")} className="space-y-3">
                                <TabsList>
                                    <TabsTrigger value="inpi">INPI ({inpiResults.length})</TabsTrigger>
                                    <TabsTrigger value="espacenet">Espacenet ({espacenetResults.length})</TabsTrigger>
                                </TabsList>

                                <TabsContent value="inpi" className="space-y-3 mt-0">
                                    {inpiResults.length === 0 ? (
                                        <div className="bg-card rounded-xl border p-6 text-center text-sm text-muted-foreground">
                                            Nenhum resultado do INPI para os critérios informados.
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {inpiResults.map((patent, idx) => {
                                                const isExpanded = expandedIdx === idx;
                                                const detail = getDetail(patent);
                                                const codPedido = getCodPedido(patent);
                                                const isLoadingThis = Boolean(codPedido && loadingDetails[codPedido]);
                                                const detailError = codPedido ? detailErrors[codPedido] : "";
                                                const applicantText = detail?.applicant || patent.applicant;
                                                const inventorText = detail?.inventor || patent.inventor || "";
                                                const abstractText = detail?.abstract || patent.abstract || "";
                                                const figures = getPatentFigures(patent, detail);
                                                const currentFigureIndex = getCurrentFigureIndex(patent, idx, figures.length);
                                                const currentFigure = figures[currentFigureIndex];

                                                return (
                                                    <div key={idx} className="bg-card rounded-xl border hover:shadow-md transition-shadow overflow-hidden">
                                                        <div
                                                            className="p-5 cursor-pointer"
                                                            onClick={() => toggleDetail(idx, patent)}
                                                        >
                                                            <div className="flex items-start justify-between gap-4">
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                                        <span className="text-xs font-mono font-medium text-accent bg-accent/10 px-2 py-0.5 rounded">
                                                                            {patent.publicationNumber}
                                                                        </span>
                                                                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                                                            INPI
                                                                        </span>
                                                                        {patent.date && (
                                                                            <span className="text-xs text-muted-foreground">
                                                                                {patent.date}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <h3 className="font-semibold text-sm mb-1 line-clamp-2">
                                                                        {detail?.title || patent.title}
                                                                    </h3>
                                                                    {applicantText && (
                                                                        <p className="text-xs text-muted-foreground mb-1">
                                                                            <span className="font-medium">Titular:</span> {applicantText}
                                                                        </p>
                                                                    )}
                                                                    {inventorText && (
                                                                        <p className="text-xs text-muted-foreground mb-1">
                                                                            <span className="font-medium">Inventor:</span> {inventorText}
                                                                        </p>
                                                                    )}
                                                                    {abstractText && (
                                                                        <p className="text-xs text-muted-foreground line-clamp-2">
                                                                            <span className="font-medium">Resumo:</span> {abstractText}
                                                                        </p>
                                                                    )}
                                                                    {patent.classification && (
                                                                        <p className="text-xs text-muted-foreground">
                                                                            <span className="font-medium">IPC:</span> {patent.classification}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-1 shrink-0">
                                                                    <button
                                                                        type="button"
                                                                        className="p-2 rounded-lg hover:bg-muted transition-colors"
                                                                        title="Abrir documento da patente"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            openPatentModal(patent, detail);
                                                                        }}
                                                                    >
                                                                        <ExternalLink className="w-4 h-4 text-muted-foreground" />
                                                                    </button>
                                                                    <div className="p-2">
                                                                        {isExpanded
                                                                            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                                                                            : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                                                        }
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {isExpanded && (
                                                            <div className="border-t px-5 py-4 bg-muted/20 space-y-3">
                                                                {isLoadingThis ? (
                                                                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                                        Carregando detalhes do INPI...
                                                                    </div>
                                                                ) : detailError ? (
                                                                    <p className="text-sm text-destructive text-center py-2">
                                                                        {detailError}
                                                                    </p>
                                                                ) : (
                                                                    <>
                                                                        {applicantText && (
                                                                            <div className="flex items-start gap-2">
                                                                                <Building2 className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                                                                                <div>
                                                                                    <p className="text-xs font-medium text-muted-foreground">Depositante / Titular</p>
                                                                                    <p className="text-sm">{applicantText}</p>
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                        {inventorText && (
                                                                            <div className="flex items-start gap-2">
                                                                                <Lightbulb className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
                                                                                <div>
                                                                                    <p className="text-xs font-medium text-muted-foreground">Inventor(es)</p>
                                                                                    <p className="text-sm">{inventorText}</p>
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                        {abstractText && (
                                                                            <div>
                                                                                <p className="text-xs font-medium text-muted-foreground mb-1">Resumo</p>
                                                                                <p className="text-sm text-muted-foreground leading-relaxed">{abstractText}</p>
                                                                            </div>
                                                                        )}
                                                                        {(detail?.classification || patent.classification) && (
                                                                            <div>
                                                                                <p className="text-xs font-medium text-muted-foreground mb-1">Classificação Completa</p>
                                                                                <p className="text-sm font-mono">{detail?.classification || patent.classification}</p>
                                                                            </div>
                                                                        )}
                                                                        {detail?.status && (
                                                                            <div>
                                                                                <p className="text-xs font-medium text-muted-foreground mb-1">Situação</p>
                                                                                <p className="text-sm">{detail.status}</p>
                                                                            </div>
                                                                        )}
                                                                        {figures.length > 0 && currentFigure && (
                                                                            <div className="space-y-2">
                                                                                <div className="flex items-center justify-between">
                                                                                    <p className="text-xs font-medium text-muted-foreground">Figuras</p>
                                                                                    <p className="text-xs text-muted-foreground">
                                                                                        {currentFigureIndex + 1} de {figures.length}
                                                                                    </p>
                                                                                </div>
                                                                                <div className="relative rounded-lg border bg-background overflow-hidden">
                                                                                    <img
                                                                                        src={currentFigure}
                                                                                        alt={`Figura ${currentFigureIndex + 1} da patente ${patent.publicationNumber}`}
                                                                                        className="w-full h-64 object-contain bg-muted/30"
                                                                                    />
                                                                                    {figures.length > 1 && (
                                                                                        <>
                                                                                            <Button
                                                                                                type="button"
                                                                                                variant="secondary"
                                                                                                size="icon"
                                                                                                className="absolute left-3 top-1/2 -translate-y-1/2"
                                                                                                onClick={() => setFigureIndex(patent, idx, currentFigureIndex - 1, figures.length)}
                                                                                            >
                                                                                                <ChevronLeft className="w-4 h-4" />
                                                                                            </Button>
                                                                                            <Button
                                                                                                type="button"
                                                                                                variant="secondary"
                                                                                                size="icon"
                                                                                                className="absolute right-3 top-1/2 -translate-y-1/2"
                                                                                                onClick={() => setFigureIndex(patent, idx, currentFigureIndex + 1, figures.length)}
                                                                                            >
                                                                                                <ChevronRight className="w-4 h-4" />
                                                                                            </Button>
                                                                                        </>
                                                                                    )}
                                                                                    <Button
                                                                                        type="button"
                                                                                        variant="secondary"
                                                                                        size="icon"
                                                                                        className="absolute right-3 top-3"
                                                                                        onClick={() => openFigureModal(figures, currentFigureIndex)}
                                                                                    >
                                                                                        <Expand className="w-4 h-4" />
                                                                                    </Button>
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                        {!applicantText && !inventorText && !abstractText && figures.length === 0 && (
                                                                            <p className="text-sm text-muted-foreground text-center py-2">
                                                                                Detalhes não disponíveis para esta patente.
                                                                            </p>
                                                                        )}
                                                                    </>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </TabsContent>

                                <TabsContent value="espacenet" className="space-y-3 mt-0">
                                    {espacenetResults.length === 0 ? (
                                        <div className="bg-card rounded-xl border p-6 text-center text-sm text-muted-foreground">
                                            Nenhum resultado do Espacenet para os critérios informados.
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {espacenetResults.map((patent, idx) => (
                                                <div key={`esp-${idx}`} className="bg-card rounded-xl border hover:shadow-md transition-shadow overflow-hidden">
                                                    <div className="p-5">
                                                        <div className="flex items-start justify-between gap-4">
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                                    <span className="text-xs font-mono font-medium text-accent bg-accent/10 px-2 py-0.5 rounded">
                                                                        {patent.publicationNumber}
                                                                    </span>
                                                                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                                                        Espacenet
                                                                    </span>
                                                                    {patent.date && (
                                                                        <span className="text-xs text-muted-foreground">
                                                                            {patent.date}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <h3 className="font-semibold text-sm mb-1 line-clamp-2">
                                                                    {patent.title}
                                                                </h3>
                                                                {patent.applicant && (
                                                                    <p className="text-xs text-muted-foreground mb-1">
                                                                        <span className="font-medium">Titular:</span> {patent.applicant}
                                                                    </p>
                                                                )}
                                                                {patent.inventor && (
                                                                    <p className="text-xs text-muted-foreground mb-1">
                                                                        <span className="font-medium">Inventor:</span> {patent.inventor}
                                                                    </p>
                                                                )}
                                                                {patent.abstract && (
                                                                    <p className="text-xs text-muted-foreground line-clamp-2">
                                                                        <span className="font-medium">Resumo:</span> {patent.abstract}
                                                                    </p>
                                                                )}
                                                                {patent.classification && (
                                                                    <p className="text-xs text-muted-foreground">
                                                                        <span className="font-medium">IPC:</span> {patent.classification}
                                                                    </p>
                                                                )}
                                                            </div>
                                                            <button
                                                                type="button"
                                                                className="p-2 rounded-lg hover:bg-muted transition-colors shrink-0"
                                                                title="Abrir documento da patente"
                                                                onClick={() => openPatentModal(patent, null)}
                                                            >
                                                                <ExternalLink className="w-4 h-4 text-muted-foreground" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </TabsContent>
                            </Tabs>
                        )}
                    </div>
                )}
            </div>
            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                <DialogContent className="max-w-6xl p-4">
                    {modalFigures.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between pr-10">
                                <p className="text-sm font-medium">Figura ampliada</p>
                                <p className="text-xs text-muted-foreground">
                                    {modalIndex + 1} de {modalFigures.length}
                                </p>
                            </div>
                            <div className="relative rounded-lg border bg-muted/20 overflow-hidden">
                                <img
                                    src={modalFigures[modalIndex]}
                                    alt={`Figura ampliada ${modalIndex + 1}`}
                                    className="w-full max-h-[75vh] object-contain"
                                />
                                {modalFigures.length > 1 && (
                                    <>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="icon"
                                            className="absolute left-3 top-1/2 -translate-y-1/2"
                                            onClick={() => setModalIndex((prev) => (prev - 1 + modalFigures.length) % modalFigures.length)}
                                        >
                                            <ChevronLeft className="w-4 h-4" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="icon"
                                            className="absolute right-3 top-1/2 -translate-y-1/2"
                                            onClick={() => setModalIndex((prev) => (prev + 1) % modalFigures.length)}
                                        >
                                            <ChevronRight className="w-4 h-4" />
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
            <PatentDocumentModal
                open={patentModalOpen}
                onOpenChange={setPatentModalOpen}
                patent={selectedPatent}
            />
        </AppLayout>
    );
}
