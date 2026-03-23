import { useRef, useState } from "react";
import { Search, Loader2, Hash, User, UserCheck, FileText, X, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Download, Eye, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import AppLayout from "@/components/AppLayout";
import PatentDocumentModal, { PatentDocumentData } from "@/components/PatentDocumentModal";
import axios from "axios";
import { toast } from "sonner";
import OperationalPageHeader from "@/components/operations/OperationalPageHeader";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/$/, "");

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
    status?: string;
    inpiUrl?: string;
    storage?: {
        hasStoredDocument?: boolean;
        fullDocumentPath?: string;
        drawingsPath?: string;
        firstPagePath?: string;
    };
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
    inpiUrl?: string;
    storage?: {
        hasStoredDocument?: boolean;
        fullDocumentPath?: string;
        drawingsPath?: string;
        firstPagePath?: string;
    };
}

interface QuickSearchResponse {
    inpi?: PatentResult[];
    espacenet?: PatentResult[];
    totals?: {
        inpi?: number;
        espacenet?: number;
        all?: number;
    };
    pagination?: {
        inpi?: {
            page?: number;
            pageSize?: number;
            total?: number;
            totalPages?: number;
            from?: number;
            to?: number;
            hasPrevious?: boolean;
            hasNext?: boolean;
        };
    };
    results?: PatentResult[];
}

export default function QuickSearch() {
    const INPI_PAGE_SIZE = 20;
    const [number, setNumber] = useState("");
    const [titular, setTitular] = useState("");
    const [inventor, setInventor] = useState("");
    const [keywords, setKeywords] = useState("");
    const [inpiResults, setInpiResults] = useState<PatentResult[]>([]);
    const [espacenetResults, setEspacenetResults] = useState<PatentResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [ignoreSecret, setIgnoreSecret] = useState(false);
    const [error, setError] = useState("");
    const [tab, setTab] = useState<"inpi" | "espacenet">("inpi");
    const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
    const [detailCache, setDetailCache] = useState<Record<string, PatentDetail>>({});
    const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({});
    const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
    const [modalOpen, setModalOpen] = useState(false);
    const [modalFigures, setModalFigures] = useState<string[]>([]);
    const [modalIndex, setModalIndex] = useState(0);
    const [patentModalOpen, setPatentModalOpen] = useState(false);
    const [selectedPatent, setSelectedPatent] = useState<PatentDocumentData | null>(null);
    const [totals, setTotals] = useState({ inpi: 0, espacenet: 0, all: 0 });
    const [inpiPagination, setInpiPagination] = useState({
        page: 1,
        pageSize: INPI_PAGE_SIZE,
        total: 0,
        totalPages: 1,
        from: 0,
        to: 0,
        hasPrevious: false,
        hasNext: false
    });
    const searchTokenRef = useRef(0);

    const hasInput = number || titular || inventor || keywords;
    const totalResults = totals.all;

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
        const storageRaw = raw.storage;
        const storage = (storageRaw && typeof storageRaw === "object")
            ? {
                hasStoredDocument: Boolean((storageRaw as Record<string, unknown>).hasStoredDocument),
                fullDocumentPath: readText((storageRaw as Record<string, unknown>).fullDocumentPath) || undefined,
                drawingsPath: readText((storageRaw as Record<string, unknown>).drawingsPath) || undefined,
                firstPagePath: readText((storageRaw as Record<string, unknown>).firstPagePath) || undefined
            }
            : undefined;

        return {
            applicant: readText(raw.applicant) || undefined,
            inventor: readText(raw.inventor) || undefined,
            abstract: readText(raw.abstract) || undefined,
            classification: readText(raw.classification) || undefined,
            filingDate: readText(raw.filingDate) || undefined,
            title: readText(raw.title) || undefined,
            status: readText(raw.status) || undefined,
            figures,
            inpiUrl: readText(raw.inpiUrl) || undefined,
            storage
        };
    };

    const loadInpiDetail = async (codPedido: string, publicationNumber?: string, expectedSearchToken?: number) => {
        if (!codPedido) return;
        if (typeof expectedSearchToken === "number" && expectedSearchToken !== searchTokenRef.current) return;
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
            if (typeof expectedSearchToken === "number" && expectedSearchToken !== searchTokenRef.current) return;
            const normalizedDetail = normalizePatentDetail(response.data);
            setDetailCache(prev => ({ ...prev, [codPedido]: normalizedDetail }));
        } catch (err) {
            if (typeof expectedSearchToken === "number" && expectedSearchToken !== searchTokenRef.current) return;
            console.warn("Failed to load detail:", err);
            setDetailErrors(prev => ({
                ...prev,
                [codPedido]: "Detalhes indisponíveis na base local para este registro."
            }));
        } finally {
            if (!(typeof expectedSearchToken === "number" && expectedSearchToken !== searchTokenRef.current)) {
                setLoadingDetails(prev => {
                    const next = { ...prev };
                    delete next[codPedido];
                    return next;
                });
            }
        }
    };

    const preloadInpiDetailsInBackground = (patents: PatentResult[], searchToken: number) => {
        const initial = patents
            .filter((p) => p.source === "INPI")
            .slice(0, 12);
        if (!initial.length) return;

        const queue = [...initial];
        const workers = 2;
        const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

        const runWorker = async () => {
            while (queue.length > 0) {
                if (searchTokenRef.current !== searchToken) return;
                const patent = queue.shift();
                if (!patent) return;
                const codPedido = getCodPedido(patent);
                if (!codPedido) continue;
                await loadInpiDetail(codPedido, patent.publicationNumber, searchToken);
                await pause(120);
            }
        };

        void Promise.all(Array.from({ length: workers }, () => runWorker()));
    };

    const applyQuickSearchResponse = (
        responseData: QuickSearchResponse,
        searchToken: number,
        preserveEspacenet: boolean
    ) => {
        const fetchedInpi = responseData.inpi || [];
        const fetchedEspacenet = responseData.espacenet || [];
        const inpiTotal = responseData.totals?.inpi ?? fetchedInpi.length;
        const espacenetTotal = preserveEspacenet ? totals.espacenet : (responseData.totals?.espacenet ?? fetchedEspacenet.length);
        const allTotal = responseData.totals?.all ?? (inpiTotal + espacenetTotal);

        setInpiResults(fetchedInpi);
        if (!preserveEspacenet) {
            setEspacenetResults(fetchedEspacenet);
        }
        setTotals({
            inpi: inpiTotal,
            espacenet: espacenetTotal,
            all: allTotal
        });

        const inpiPage = responseData.pagination?.inpi;
        setInpiPagination({
            page: inpiPage?.page ?? 1,
            pageSize: inpiPage?.pageSize ?? INPI_PAGE_SIZE,
            total: inpiPage?.total ?? inpiTotal,
            totalPages: inpiPage?.totalPages ?? Math.max(1, Math.ceil(inpiTotal / INPI_PAGE_SIZE)),
            from: inpiPage?.from ?? (inpiTotal > 0 ? 1 : 0),
            to: inpiPage?.to ?? fetchedInpi.length,
            hasPrevious: inpiPage?.hasPrevious ?? false,
            hasNext: inpiPage?.hasNext ?? false
        });
        preloadInpiDetailsInBackground(fetchedInpi, searchToken);
    };

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!hasInput) return;
        const currentSearchToken = Date.now();
        searchTokenRef.current = currentSearchToken;

        setLoading(true);
        setError("");
        setSearched(true);
        setExpandedIdx(null);
        setDetailCache({});
        setLoadingDetails({});
        setDetailErrors({});
        setTotals({ inpi: 0, espacenet: 0, all: 0 });
        setInpiPagination({
            page: 1,
            pageSize: INPI_PAGE_SIZE,
            total: 0,
            totalPages: 1,
            from: 0,
            to: 0,
            hasPrevious: false,
            hasNext: false
        });

        try {
            const response = await axios.post<QuickSearchResponse>(`${API_URL}/search/quick`, {
                number: number || undefined,
                titular: titular || undefined,
                inventor: inventor || undefined,
                keywords: keywords || undefined,
                page: 1,
                pageSize: INPI_PAGE_SIZE,
                includeEspacenet: true,
                ignoreSecret
            });
            applyQuickSearchResponse(response.data, currentSearchToken, false);
            setTab("inpi");
        } catch (err: unknown) {
            const message = axios.isAxiosError(err)
                ? (err.response?.data?.error as string | undefined)
                : undefined;
            setError(message || "Erro ao buscar patentes");
            setInpiResults([]);
            setEspacenetResults([]);
            setTotals({ inpi: 0, espacenet: 0, all: 0 });
        } finally {
            setLoading(false);
        }
    };

    const changeInpiPage = async (nextPage: number) => {
        if (!hasInput) return;
        if (nextPage < 1) return;
        if (nextPage === inpiPagination.page) return;
        if (nextPage > inpiPagination.totalPages) return;

        const currentSearchToken = Date.now();
        searchTokenRef.current = currentSearchToken;
        setLoading(true);
        setError("");
        setExpandedIdx(null);
        setDetailCache({});
        setLoadingDetails({});
        setDetailErrors({});
        setTab("inpi");

        try {
            const response = await axios.post<QuickSearchResponse>(`${API_URL}/search/quick`, {
                number: number || undefined,
                titular: titular || undefined,
                inventor: inventor || undefined,
                keywords: keywords || undefined,
                page: nextPage,
                pageSize: INPI_PAGE_SIZE,
                includeEspacenet: false
            });
            applyQuickSearchResponse(response.data, currentSearchToken, true);
        } catch (err: unknown) {
            const message = axios.isAxiosError(err)
                ? (err.response?.data?.error as string | undefined)
                : undefined;
            setError(message || "Erro ao mudar de página");
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
        const hasInlineDetails = Boolean(
            patent.applicant ||
            patent.inventor ||
            patent.abstract ||
            patent.status ||
            (patent.figures && patent.figures.length > 0)
        );
        if (!hasInlineDetails) {
            await loadInpiDetail(codPedido, patent.publicationNumber, searchTokenRef.current);
        }
    };

    const getDetail = (patent: PatentResult): PatentDetail | null => {
        const codPedido = getCodPedido(patent);
        if (!codPedido) return null;
        return detailCache[codPedido] || null;
    };

    const getPatentFigures = (patent: PatentResult, detail: PatentDetail | null): string[] => {
        const detailFigures = detail?.figures || [];
        const baseFigures = patent.figures || [];
        if (detailFigures.length > 0) return detailFigures;
        return baseFigures;
    };

    const resolveAssetUrl = (value?: string) => {
        if (!value) return "";
        if (/^https?:\/\//i.test(value)) return value;
        const normalized = value.startsWith("/") ? value : `/${value}`;
        return `${API_URL}${normalized}`;
    };

    const isPdfAsset = (value?: string) => {
        const url = (value || "").toLowerCase();
        return url.includes(".pdf") || url.includes("/patent/storage/");
    };

    const openPatentModal = (patent: PatentResult, detail?: PatentDetail | null) => {
        const codPedido = getCodPedido(patent) || undefined;
        setSelectedPatent({
            publicationNumber: patent.publicationNumber,
            cod_pedido: codPedido,
            title: detail?.title || patent.title,
            applicant: detail?.applicant || patent.applicant,
            inventor: detail?.inventor || patent.inventor,
            date: detail?.filingDate || patent.date,
            abstract: detail?.abstract || patent.abstract,
            classification: detail?.classification || patent.classification,
            source: patent.source,
            url: detail?.storage?.fullDocumentPath || patent.storage?.fullDocumentPath || patent.url,
            status: detail?.status || patent.status,
            figures: getPatentFigures(patent, detail).map((item) => resolveAssetUrl(item)),
            inpiUrl: detail?.inpiUrl || patent.inpiUrl || patent.url,
            storage: detail?.storage || patent.storage,
            document_status: detail?.storage?.hasStoredDocument || patent.storage?.hasStoredDocument ? "completed" : "not_queued",
            document_error: null
        });
        setPatentModalOpen(true);
    };

    const addToMonitoring = async (patent: PatentResult, monitorType: "processo" | "colidencia" | "mercado") => {
        const patentNumber = (patent.publicationNumber || "").trim();
        if (!patentNumber) return;
        try {
            await axios.post(`${API_URL}/monitoring/patents/add`, {
                patentNumber,
                patentId: getCodPedido(patent) || patentNumber,
                monitorType
            });
            toast.success(`Patente adicionada ao monitoramento de ${monitorType}.`);
        } catch {
            toast.error("Não foi possível adicionar ao monitoramento.");
        }
    };

    const documentAvailabilityBadge = (patent: PatentResult, detail?: PatentDetail | null) => {
        const stored = Boolean(detail?.storage?.hasStoredDocument || patent.storage?.hasStoredDocument);
        if (stored) return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Completo</Badge>;
        if (patent.source === "INPI") return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Parcial</Badge>;
        return <Badge variant="outline">Ausente</Badge>;
    };

    const clearAll = () => {
        setNumber("");
        setTitular("");
        setInventor("");
        setKeywords("");
        setInpiResults([]);
        setEspacenetResults([]);
        setTotals({ inpi: 0, espacenet: 0, all: 0 });
        setInpiPagination({
            page: 1,
            pageSize: INPI_PAGE_SIZE,
            total: 0,
            totalPages: 1,
            from: 0,
            to: 0,
            hasPrevious: false,
            hasNext: false
        });
        setSearched(false);
        setError("");
        setExpandedIdx(null);
        setTab("inpi");
        setModalOpen(false);
        setModalFigures([]);
        setModalIndex(0);
        setPatentModalOpen(false);
        setSelectedPatent(null);
        setIgnoreSecret(false);
    };

    const [queueingPatents, setQueueingPatents] = useState<Record<string, boolean>>({});
    const [queuedPatents, setQueuedPatents] = useState<Record<string, string>>({});

    const handleQueuePatent = async (patent: PatentResult) => {
        const codPedido = getCodPedido(patent);
        if (!codPedido) return;
        
        setQueueingPatents(prev => ({ ...prev, [codPedido]: true }));
        try {
            const cleanApiUrl = API_URL.endsWith('/') ? API_URL.slice(0, -1) : API_URL;
            const response = await axios.post(`${cleanApiUrl}/patent/queue`, { 
                codPedido,
                publicationNumber: patent.publicationNumber,
                title: patent.title
            });
            setQueuedPatents(prev => ({ ...prev, [codPedido]: response.data.status || 'pending' }));
        } catch (err) {
            console.error("Failed to queue patent:", err);
        } finally {
            setQueueingPatents(prev => ({ ...prev, [codPedido]: false }));
        }
    };

    return (
        <AppLayout>
            <div className="flex flex-col gap-6 w-full mx-auto">
                <OperationalPageHeader
                    title="Busca Rápida"
                    description="Motor híbrido para varrer base local e Espacenet com contexto técnico unificado."
                    icon={<Search className="w-5 h-5 text-slate-600" />}
                    actions={
                        <>
                            <Badge variant="secondary" className="h-10 px-3 bg-emerald-50 text-emerald-700 border-emerald-200">Tempo real</Badge>
                            <Badge variant="secondary" className="h-10 px-3 bg-cyan-50 text-cyan-700 border-cyan-200">Base local + EPO</Badge>
                            <Badge variant="secondary" className="h-10 px-3 bg-slate-100 text-slate-700 border-slate-200">Pronto para diligência</Badge>
                        </>
                    }
                />

                {/* Search Form */}
                <form onSubmit={handleSearch} className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-4">
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

                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-2">
                        <div className="flex gap-3">
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
                        <div className="flex items-center space-x-2">
                            <Checkbox id="ignoreSecret" checked={ignoreSecret} onCheckedChange={(c) => setIgnoreSecret(c === true)} />
                            <label htmlFor="ignoreSecret" className="text-sm font-medium leading-none cursor-pointer text-muted-foreground whitespace-nowrap">
                                Ignorar patentes em sigilo / não publicadas
                            </label>
                        </div>
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
                                    <TabsTrigger value="inpi">Base Local ({totals.inpi})</TabsTrigger>
                                    <TabsTrigger value="espacenet">Espacenet ({totals.espacenet})</TabsTrigger>
                                </TabsList>

                                <TabsContent value="inpi" className="space-y-3 mt-0">
                                    {inpiResults.length === 0 ? (
                                        <div className="bg-card rounded-xl border p-6 text-center text-sm text-muted-foreground">
                                            Nenhum resultado da base local para os critérios informados.
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <div className="bg-muted/40 border rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                                                <p className="text-sm text-muted-foreground">
                                                    {inpiPagination.total > 0
                                                        ? `${inpiPagination.total} registros encontrados, mostrando ${inpiPagination.from} a ${inpiPagination.to}`
                                                        : "Nenhum registro encontrado"}
                                                </p>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-muted-foreground">
                                                        Página {inpiPagination.page} de {inpiPagination.totalPages}
                                                    </span>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={loading || !inpiPagination.hasPrevious}
                                                        onClick={() => void changeInpiPage(inpiPagination.page - 1)}
                                                        className="gap-1"
                                                    >
                                                        <ChevronLeft className="w-3.5 h-3.5" />
                                                        Anterior
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={loading || !inpiPagination.hasNext}
                                                        onClick={() => void changeInpiPage(inpiPagination.page + 1)}
                                                        className="gap-1"
                                                    >
                                                        Próxima
                                                        <ChevronRight className="w-3.5 h-3.5" />
                                                    </Button>
                                                </div>
                                            </div>
                                            <div className="rounded-xl border bg-card overflow-x-auto">
                                                <Table className="min-w-[1260px]">
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead className="w-[180px]">Número</TableHead>
                                                            <TableHead className="min-w-[360px]">Resumo / Titular</TableHead>
                                                            <TableHead className="w-[150px]">Documento</TableHead>
                                                            <TableHead className="min-w-[240px]">Situação</TableHead>
                                                            <TableHead className="w-[130px]">Fonte</TableHead>
                                                            <TableHead className="text-right w-[320px]">Ações</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {inpiResults.map((patent, idx) => {
                                                            const isExpanded = expandedIdx === idx;
                                                            const detail = getDetail(patent);
                                                            const codPedido = getCodPedido(patent);
                                                            const isLoadingThis = Boolean(codPedido && loadingDetails[codPedido]);
                                                            const detailError = codPedido ? detailErrors[codPedido] : "";
                                                            const applicantText = detail?.applicant || patent.applicant;
                                                            const abstractText = detail?.abstract || patent.abstract || "";
                                                            const statusText = detail?.status || patent.status || "";
                                                            return (
                                                                <>
                                                                    <TableRow key={`${patent.publicationNumber}-${idx}`} className="align-top">
                                                                        <TableCell className="font-mono text-sm font-semibold whitespace-nowrap">{patent.publicationNumber}</TableCell>
                                                                        <TableCell>
                                                                            <div className="font-semibold text-sm line-clamp-1" title={detail?.title || patent.title}>{detail?.title || patent.title}</div>
                                                                            <div className="text-xs text-muted-foreground uppercase tracking-wide line-clamp-1" title={applicantText}>{applicantText || "-"}</div>
                                                                            <div className="text-xs text-muted-foreground line-clamp-1" title={abstractText}>{abstractText || "-"}</div>
                                                                        </TableCell>
                                                                        <TableCell>{documentAvailabilityBadge(patent, detail)}</TableCell>
                                                                        <TableCell className="text-xs text-muted-foreground">{statusText || "-"}</TableCell>
                                                                        <TableCell>
                                                                            <Badge variant="secondary">Base Local</Badge>
                                                                        </TableCell>
                                                                        <TableCell>
                                                                            <div className="flex justify-end gap-1 flex-wrap">
                                                                                {patent.source === "INPI" && codPedido && (
                                                                                    <Button
                                                                                        size="sm"
                                                                                        variant={queuedPatents[codPedido] ? "secondary" : "outline"}
                                                                                        disabled={queueingPatents[codPedido] || !!queuedPatents[codPedido]}
                                                                                        onClick={() => void handleQueuePatent(patent)}
                                                                                        className="gap-1"
                                                                                    >
                                                                                        {queueingPatents[codPedido] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                                                                                        {queuedPatents[codPedido] ? "Na fila" : "Solicitar raspagem"}
                                                                                    </Button>
                                                                                )}
                                                                                <DropdownMenu>
                                                                                    <DropdownMenuTrigger asChild>
                                                                                        <Button variant="ghost" size="sm" className="text-emerald-600 gap-1">
                                                                                            <Bell className="w-3.5 h-3.5" /> Monitorar <ChevronDown className="w-3 h-3" />
                                                                                        </Button>
                                                                                    </DropdownMenuTrigger>
                                                                                    <DropdownMenuContent align="end">
                                                                                        <DropdownMenuItem onClick={() => void addToMonitoring(patent, "processo")}>Monitorar Processo</DropdownMenuItem>
                                                                                        <DropdownMenuItem onClick={() => void addToMonitoring(patent, "colidencia")}>Monitorar Colidência</DropdownMenuItem>
                                                                                        <DropdownMenuItem onClick={() => void addToMonitoring(patent, "mercado")}>Monitorar Mercado</DropdownMenuItem>
                                                                                    </DropdownMenuContent>
                                                                                </DropdownMenu>
                                                                                <Button variant="ghost" size="sm" className="gap-1" onClick={() => openPatentModal(patent, detail)}>
                                                                                    <Eye className="w-3.5 h-3.5" /> Visualizar
                                                                                </Button>
                                                                                <Button variant="ghost" size="sm" onClick={() => void toggleDetail(idx, patent)}>
                                                                                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                                                </Button>
                                                                            </div>
                                                                        </TableCell>
                                                                    </TableRow>
                                                                    {isExpanded && (
                                                                        <TableRow key={`${patent.publicationNumber}-${idx}-expanded`}>
                                                                            <TableCell colSpan={6} className="bg-muted/30">
                                                                                {isLoadingThis ? (
                                                                                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                                                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                                                        Carregando detalhes da base local...
                                                                                    </div>
                                                                                ) : detailError ? (
                                                                                    <p className="text-sm text-destructive text-center py-2">{detailError}</p>
                                                                                ) : (
                                                                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                                                                                        <div>
                                                                                            <div className="font-semibold mb-1">Depositante / Titular</div>
                                                                                            <div className="text-muted-foreground">{applicantText || "-"}</div>
                                                                                        </div>
                                                                                        <div>
                                                                                            <div className="font-semibold mb-1">Inventor(es)</div>
                                                                                            <div className="text-muted-foreground">{detail?.inventor || patent.inventor || "-"}</div>
                                                                                        </div>
                                                                                        <div>
                                                                                            <div className="font-semibold mb-1">Classificação</div>
                                                                                            <div className="text-muted-foreground">{detail?.classification || patent.classification || "-"}</div>
                                                                                        </div>
                                                                                    </div>
                                                                                )}
                                                                            </TableCell>
                                                                        </TableRow>
                                                                    )}
                                                                </>
                                                            );
                                                        })}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        </div>
                                    )}
                                </TabsContent>

                                <TabsContent value="espacenet" className="space-y-3 mt-0">
                                    {espacenetResults.length === 0 ? (
                                        <div className="bg-card rounded-xl border p-6 text-center text-sm text-muted-foreground">
                                            Nenhum resultado do Espacenet para os critérios informados.
                                        </div>
                                    ) : (
                                        <div className="rounded-xl border bg-card overflow-x-auto">
                                            <Table className="min-w-[1080px]">
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead className="w-[180px]">Número</TableHead>
                                                        <TableHead className="min-w-[360px]">Resumo / Titular</TableHead>
                                                        <TableHead className="w-[130px]">Fonte</TableHead>
                                                        <TableHead className="w-[160px]">Data</TableHead>
                                                        <TableHead className="text-right w-[260px]">Ações</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {espacenetResults.map((patent, idx) => (
                                                        <TableRow key={`esp-${idx}`}>
                                                            <TableCell className="font-mono text-sm font-semibold whitespace-nowrap">{patent.publicationNumber}</TableCell>
                                                            <TableCell>
                                                                <div className="font-semibold text-sm line-clamp-1" title={patent.title}>{patent.title}</div>
                                                                <div className="text-xs text-muted-foreground uppercase tracking-wide line-clamp-1">{patent.applicant || "-"}</div>
                                                                <div className="text-xs text-muted-foreground line-clamp-1">{patent.abstract || "-"}</div>
                                                            </TableCell>
                                                            <TableCell><Badge variant="secondary">Espacenet</Badge></TableCell>
                                                            <TableCell className="text-xs text-muted-foreground">{patent.date || "-"}</TableCell>
                                                            <TableCell>
                                                                <div className="flex justify-end gap-1">
                                                                    <DropdownMenu>
                                                                        <DropdownMenuTrigger asChild>
                                                                            <Button variant="ghost" size="sm" className="text-emerald-600 gap-1">
                                                                                <Bell className="w-3.5 h-3.5" /> Monitorar <ChevronDown className="w-3 h-3" />
                                                                            </Button>
                                                                        </DropdownMenuTrigger>
                                                                        <DropdownMenuContent align="end">
                                                                            <DropdownMenuItem onClick={() => void addToMonitoring(patent, "processo")}>Monitorar Processo</DropdownMenuItem>
                                                                            <DropdownMenuItem onClick={() => void addToMonitoring(patent, "colidencia")}>Monitorar Colidência</DropdownMenuItem>
                                                                            <DropdownMenuItem onClick={() => void addToMonitoring(patent, "mercado")}>Monitorar Mercado</DropdownMenuItem>
                                                                        </DropdownMenuContent>
                                                                    </DropdownMenu>
                                                                    <Button variant="ghost" size="sm" className="gap-1" onClick={() => openPatentModal(patent, null)}>
                                                                        <Eye className="w-3.5 h-3.5" /> Visualizar
                                                                    </Button>
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
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
                    <DialogTitle className="sr-only">Visualização de figura da patente</DialogTitle>
                    <DialogDescription className="sr-only">Navegação entre imagens e páginas do documento da patente.</DialogDescription>
                    {modalFigures.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between pr-10">
                                <p className="text-sm font-medium">Figura ampliada</p>
                                <p className="text-xs text-muted-foreground">
                                    {modalIndex + 1} de {modalFigures.length}
                                </p>
                            </div>
                            <div className="relative rounded-lg border bg-muted/20 overflow-hidden">
                                {isPdfAsset(modalFigures[modalIndex]) ? (
                                    <iframe
                                        src={`${resolveAssetUrl(modalFigures[modalIndex])}#view=FitH`}
                                        title={`Figura ampliada ${modalIndex + 1}`}
                                        className="w-full h-[75vh]"
                                    />
                                ) : (
                                    <img
                                        src={resolveAssetUrl(modalFigures[modalIndex])}
                                        alt={`Figura ampliada ${modalIndex + 1}`}
                                        className="w-full max-h-[75vh] object-contain"
                                    />
                                )}
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
