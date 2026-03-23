import { useState, useEffect, useCallback, useRef, type ChangeEvent } from "react";
import AppLayout from "@/components/AppLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
    Database, 
    Loader2, 
    Search,
    RefreshCw,
    Eye,
    Bell,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    FilterX,
    Upload
} from "lucide-react";
import axios from "axios";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import PatentDocumentModal, { PatentDocumentData } from "@/components/PatentDocumentModal";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import OperationalPageHeader from "@/components/operations/OperationalPageHeader";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/+$/, "");

interface InpiPatent {
    cod_pedido: string;
    numero_publicacao: string;
    title: string;
    abstract?: string;
    resumo_detalhado?: string;
    procurador?: string;
    applicant: string;
    inventors?: string;
    filing_date: string;
    ipc_codes?: string;
    status?: string;
    document_status?: string;
    document_error?: string | null;
    has_stored_document?: boolean;
    document_availability?: "completo" | "parcial" | "ausente";
    process_situation?: string | null;
    last_dispatch_code?: string | null;
    last_dispatch_desc?: string | null;
    last_dispatch_date?: string | null;
    updated_at: string;
    _count: {
        publications: number;
        petitions: number;
        annuities: number;
    };
}

export default function PatentBase() {
    const [patents, setPatents] = useState<InpiPatent[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [totalPages, setTotalPages] = useState(1);
    const [totalPatents, setTotalPatents] = useState(0);
    const [query, setQuery] = useState("");
    const [documentAvailability, setDocumentAvailability] = useState<"all" | "completo" | "parcial" | "ausente">("all");
    const [dispatchCode, setDispatchCode] = useState<"all" | "3.1" | "1.3" | "16.1">("all");
    const [processStatus, setProcessStatus] = useState("");
    const [patentModalOpen, setPatentModalOpen] = useState(false);
    const [selectedPatent, setSelectedPatent] = useState<PatentDocumentData | null>(null);
    const [lazyEnabled, setLazyEnabled] = useState(true);
    const [uploadingPatentId, setUploadingPatentId] = useState<string | null>(null);
    const [queueingInpiPatentId, setQueueingInpiPatentId] = useState<string | null>(null);
    const [priorityQueuedAtByPatent, setPriorityQueuedAtByPatent] = useState<Record<string, string>>({});
    const manualUploadInputRef = useRef<HTMLInputElement | null>(null);
    const [manualUploadTarget, setManualUploadTarget] = useState<InpiPatent | null>(null);

    const fetchData = useCallback(async (nextPage = 1, append = false) => {
        if (!append) setLoading(true);
        else setLoadingMore(true);
        try {
            const params = new URLSearchParams({ page: String(nextPage), pageSize: String(pageSize) });
            if (query.trim()) params.set("q", query.trim());
            if (documentAvailability !== "all") params.set("documentAvailability", documentAvailability);
            if (dispatchCode !== "all") params.set("dispatchCode", dispatchCode);
            if (processStatus.trim()) params.set("processStatus", processStatus.trim());
            const res = await axios.get(`${API_URL}/patents/processed?${params.toString()}`);
            const incoming = Array.isArray(res.data.patents) ? res.data.patents : [];
            setPatents((prev) => append ? [...prev, ...incoming] : incoming);
            setTotalPatents(res.data.total);
            setTotalPages(Math.max(1, Number(res.data.totalPages) || 1));
            setPage(nextPage);
        } catch (err) {
            console.error("Error fetching data:", err);
            toast.error("Não foi possível carregar o acervo local.");
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [dispatchCode, documentAvailability, pageSize, processStatus, query]);

    useEffect(() => {
        void fetchData(1, false);
    }, [fetchData]);

    const openPatentModal = (patent: InpiPatent) => {
        const fallbackUrl = `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${encodeURIComponent(patent.cod_pedido)}`;
        setSelectedPatent({
            publicationNumber: patent.numero_publicacao || patent.cod_pedido,
            cod_pedido: patent.cod_pedido,
            title: patent.title || "Sem título",
            abstract: patent.resumo_detalhado || patent.abstract || "",
            resumo_detalhado: patent.resumo_detalhado || patent.abstract || "",
            procurador: patent.procurador || "",
            applicant: patent.applicant || "",
            inventor: patent.inventors || "",
            date: patent.filing_date || "",
            classification: patent.ipc_codes || "",
            status: patent.process_situation || patent.status || patent.document_status || "",
            source: "INPI",
            url: fallbackUrl,
            inpiUrl: fallbackUrl,
            document_status: patent.document_status,
            document_error: patent.document_error,
            storage: {
                hasStoredDocument: Boolean(patent.has_stored_document)
            }
        });
        setPatentModalOpen(true);
    };

    const addToMonitoring = async (patent: InpiPatent, monitorType: "processo" | "colidencia" | "mercado") => {
        const patentNumber = (patent.numero_publicacao || patent.cod_pedido || "").trim();
        if (!patentNumber) return;
        if (patent.document_availability !== "completo") {
            toast.error("Somente patentes com documento completo podem entrar no monitoramento.");
            return;
        }
        try {
            await axios.post(`${API_URL}/monitoring/patents/add`, {
                patentNumber,
                patentId: patent.cod_pedido,
                monitorType
            });
            toast.success(`Patente adicionada ao monitoramento de ${monitorType}.`);
        } catch (err: any) {
            const message = err?.response?.data?.error || "Não foi possível adicionar ao monitoramento.";
            toast.error(message);
        }
    };

    const processingDocumentStatuses = new Set([
        "pending",
        "running",
        "pending_google_patents",
        "running_google_patents",
        "pending_ops",
        "running_ops",
        "waiting_inpi_text",
        "waiting_inpi"
    ]);

    const isDocumentProcessing = (patent: InpiPatent) => processingDocumentStatuses.has(String(patent.document_status || "").toLowerCase());

    const triggerManualUpload = (patent: InpiPatent) => {
        setManualUploadTarget(patent);
        manualUploadInputRef.current?.click();
    };

    const onManualUploadSelected = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        const target = manualUploadTarget;
        event.target.value = "";
        if (!file || !target) return;
        const patentNumber = (target.numero_publicacao || target.cod_pedido || "").trim();
        if (!patentNumber) return;
        setUploadingPatentId(target.cod_pedido);
        try {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("patentId", target.cod_pedido);
            formData.append("publicationNumber", patentNumber);
            await axios.post(`${API_URL}/patent/document/manual-upload`, formData, {
                headers: { "Content-Type": "multipart/form-data" }
            });
            toast.success("PDF enviado com sucesso. Documento marcado como completo.");
            await fetchData(page, false);
        } catch (err: any) {
            const message = err?.response?.data?.error || "Falha no upload manual do PDF.";
            toast.error(message);
        } finally {
            setUploadingPatentId(null);
            setManualUploadTarget(null);
        }
    };

    const enqueuePriorityInpiDoc = async (patent: InpiPatent) => {
        const patentId = (patent.cod_pedido || "").trim();
        if (!patentId) return;
        setQueueingInpiPatentId(patentId);
        try {
            await axios.post(`${API_URL}/background-workers/inpi/enqueue-document-priority`, {
                patentId,
                priority: 99
            });
            setPriorityQueuedAtByPatent((prev) => ({
                ...prev,
                [patentId]: new Date().toISOString()
            }));
            toast.success("Patente enfileirada com prioridade para busca de documento no INPI.");
            await fetchData(page, false);
        } catch (err: any) {
            const message = err?.response?.data?.error || "Falha ao enfileirar busca de documento no INPI.";
            toast.error(message);
        } finally {
            setQueueingInpiPatentId(null);
        }
    };

    const canLoadMore = lazyEnabled && page < totalPages;
    const resetFilters = () => {
        setQuery("");
        setDocumentAvailability("all");
        setDispatchCode("all");
        setProcessStatus("");
    };

    const documentAvailabilityBadge = (value?: string) => {
        if (value === "completo") return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Completo</Badge>;
        if (value === "parcial") return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Parcial</Badge>;
        return <Badge variant="outline">Ausente</Badge>;
    };

    const getOperationalReason = (patent: InpiPatent) => {
        const status = String(patent.document_status || "").toLowerCase();
        const rawError = String(patent.document_error || "").trim();
        const errorCode = rawError.toUpperCase();
        if (status === "completed") return "Documento completo disponível.";
        if (status === "not_queued") return "Documento ainda não enfileirado.";
        if (status === "pending" || status === "pending_google_patents" || status === "pending_ops") return "Na fila de processamento de documento.";
        if (status === "running" || status === "running_google_patents" || status === "running_ops") return "Coleta de documento em execução.";
        if (status === "waiting_inpi" || status === "waiting_inpi_text") return "Aguardando etapa do scraper INPI com captcha.";
        if (status === "skipped_sigilo") return "Documento não disponível por sigilo no INPI.";
        if (status === "not_found") return "Documento não encontrado nas fontes configuradas.";
        if (errorCode.includes("DOC_RECENT_DISPATCH_DIRECT_INPI")) return "Despacho recente: roteado para busca direta no INPI.";
        if (errorCode.includes("DOC_SKIPPED_SIGILO")) return "Documento marcado como sigilo.";
        if (errorCode.includes("DOC_PATENT_NOT_FOUND")) return "Patente não localizada para vincular documento.";
        if (errorCode.includes("INPI_BROWSER_LAUNCH_FAILED")) return "Falha de infraestrutura no navegador do scraper.";
        if (rawError) return rawError;
        return "Sem detalhe adicional.";
    };

    const getPrimaryAction = (patent: InpiPatent): "monitor" | "queue_inpi" | "processing" => {
        if (patent.document_availability === "completo") return "monitor";
        if (isDocumentProcessing(patent)) return "processing";
        return "queue_inpi";
    };

    return (
        <AppLayout>
            <div className="flex flex-col gap-6 w-full mx-auto">
                <input
                    ref={manualUploadInputRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(event) => void onManualUploadSelected(event)}
                />
                <OperationalPageHeader
                    title="Base Local de Patentes"
                    description="Gerencie sua base local de patentes extraídas e consolidadas."
                    icon={<Database className="w-5 h-5 text-slate-600" />}
                    actions={
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-10 text-sm bg-white border-slate-200"
                            onClick={() => fetchData(1, false)}
                            disabled={loading}
                        >
                            <RefreshCw className={`w-4 h-4 mr-2 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
                            Atualizar Base
                        </Button>
                    }
                />

                <div className="space-y-6">
                    <div className="animate-in fade-in zoom-in-95 duration-500">
                        <Card className="border-slate-200 shadow-sm bg-white overflow-hidden rounded-xl">
                            <CardHeader className="border-b border-slate-100 bg-slate-50/50 py-4">
                                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                    <div>
                                        <CardTitle className="text-sm font-bold text-slate-800">
                                            Acervo Consolidado
                                        </CardTitle>
                                        <CardDescription className="text-xs mt-0.5">
                                            Pesquise e gerencie as patentes sincronizadas do INPI e outras fontes
                                        </CardDescription>
                                    </div>
                                    <div className="flex flex-wrap gap-2 w-full md:w-auto">
                                        <div className="relative w-full md:w-72">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                            <input 
                                                type="search" 
                                                placeholder="Filtrar base (número, titular...)" 
                                                value={query}
                                                onChange={(event) => setQuery(event.target.value)}
                                                className="h-9 w-full pl-9 rounded-lg border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
                                            />
                                        </div>
                                        <Select value={documentAvailability} onValueChange={(value: "all" | "completo" | "parcial" | "ausente") => setDocumentAvailability(value)}>
                                            <SelectTrigger className="h-9 w-[170px] bg-white">
                                                <SelectValue placeholder="Documento" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">Documento: todos</SelectItem>
                                                <SelectItem value="completo">Documento: completo</SelectItem>
                                                <SelectItem value="parcial">Documento: parcial</SelectItem>
                                                <SelectItem value="ausente">Documento: ausente</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Select value={dispatchCode} onValueChange={(value: "all" | "3.1" | "1.3" | "16.1") => setDispatchCode(value)}>
                                            <SelectTrigger className="h-9 w-[150px] bg-white">
                                                <SelectValue placeholder="Despacho" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">Despacho: todos</SelectItem>
                                                <SelectItem value="3.1">Despacho 3.1</SelectItem>
                                                <SelectItem value="1.3">Despacho 1.3</SelectItem>
                                                <SelectItem value="16.1">Despacho 16.1</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <input
                                            value={processStatus}
                                            onChange={(event) => setProcessStatus(event.target.value)}
                                            placeholder="Situação"
                                            className="h-9 w-[170px] rounded-lg border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
                                        />
                                        <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={resetFilters}>
                                            <FilterX className="w-4 h-4 mr-1" />
                                            Limpar
                                        </Button>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                {loading && patents.length === 0 ? (
                                    <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-3">
                                        <Loader2 className="w-10 h-10 animate-spin text-primary/40" />
                                        Carregando acervo...
                                    </div>
                                ) : patents.length === 0 ? (
                                    <div className="p-20 text-center">
                                       <Database className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
                                       <p className="text-muted-foreground font-medium">Acervo local vazio.</p>
                                       <p className="text-xs text-muted-foreground/60 mt-2">Busque por patentes e use "Baixar Documento" para iniciar o processamento.</p>
                                    </div>
                                ) : (
                                    <>
                                        <div className="w-full overflow-x-auto">
                                        <Table className="w-full min-w-[1660px]">
                                            <TableHeader className="bg-slate-50 border-b border-slate-100">
                                                <TableRow className="hover:bg-transparent">
                                                    <TableHead className="font-semibold text-slate-700 w-[170px]">Número</TableHead>
                                                    <TableHead className="font-semibold text-slate-700 min-w-[360px]">Resumo / Titular</TableHead>
                                                    <TableHead className="font-semibold text-slate-700 text-center w-[190px]">Dados Capturados</TableHead>
                                                    <TableHead className="font-semibold text-slate-700 w-[160px]">Documento</TableHead>
                                                    <TableHead className="font-semibold text-slate-700 w-[220px]">Último Despacho INPI</TableHead>
                                                    <TableHead className="font-semibold text-slate-700 min-w-[260px]">Situação</TableHead>
                                                    <TableHead className="font-semibold text-slate-700 min-w-[280px]">Log / Motivo</TableHead>
                                                    <TableHead className="font-semibold text-slate-700 w-[150px]">Última Raspagem</TableHead>
                                                    <TableHead className="font-semibold text-slate-700 text-right">Ações</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {patents.map((patent) => {
                                                    const primaryAction = getPrimaryAction(patent);
                                                    const monitorEnabled = patent.document_availability === "completo";
                                                    const queuedAt = priorityQueuedAtByPatent[patent.cod_pedido];
                                                    return (
                                                    <TableRow key={patent.cod_pedido} className="hover:bg-slate-50/50 transition-colors border-b-slate-100">
                                                        <TableCell className="font-mono font-semibold text-sm text-slate-800 whitespace-nowrap">
                                                            {patent.numero_publicacao || patent.cod_pedido}
                                                        </TableCell>
                                                        <TableCell className="py-4">
                                                            <div className="font-semibold text-sm text-slate-800 line-clamp-1" title={patent.title}>
                                                                {patent.title}
                                                            </div>
                                                            <div className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wider font-medium truncate max-w-[300px]">
                                                                {patent.applicant}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex flex-wrap gap-1.5 justify-center items-center max-w-[150px] mx-auto">
                                                                <Badge variant="outline" className="text-[10px] whitespace-nowrap py-0.5 px-2 h-5 bg-slate-50 text-slate-600 border-slate-200 font-mono" title="Publicações">
                                                                    PUB: {patent._count?.publications || 0}
                                                                </Badge>
                                                                <Badge variant="outline" className="text-[10px] whitespace-nowrap py-0.5 px-2 h-5 bg-blue-50 text-blue-700 border-blue-200 font-mono" title="Petições">
                                                                    PET: {patent._count?.petitions || 0}
                                                                </Badge>
                                                                <Badge variant="outline" className="text-[10px] whitespace-nowrap py-0.5 px-2 h-5 bg-amber-50 text-amber-700 border-amber-200 font-mono" title="Anuidades">
                                                                    ANU: {patent._count?.annuities || 0}
                                                                </Badge>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex flex-col gap-1">
                                                                {documentAvailabilityBadge(patent.document_availability)}
                                                                <span className="text-[11px] text-slate-500">{patent.document_status || "not_queued"}</span>
                                                                {queuedAt ? (
                                                                    <span className="text-[11px] text-amber-700 font-medium">
                                                                        Prioridade INPI: {format(new Date(queuedAt), "dd/MM HH:mm", { locale: ptBR })}
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-xs text-slate-700">
                                                            <div className="font-mono font-semibold">{patent.last_dispatch_code || "-"}</div>
                                                            <div className="text-slate-500">{patent.last_dispatch_date || "-"}</div>
                                                            <div className="text-slate-500 line-clamp-1" title={patent.last_dispatch_desc || ""}>{patent.last_dispatch_desc || "-"}</div>
                                                        </TableCell>
                                                        <TableCell className="text-xs text-slate-600">
                                                            <div className="line-clamp-2" title={patent.process_situation || patent.status || "-"}>
                                                                {patent.process_situation || patent.status || "-"}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-xs text-slate-600">
                                                            <div className="line-clamp-3" title={getOperationalReason(patent)}>
                                                                {getOperationalReason(patent)}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-slate-500 text-xs font-mono">
                                                            {format(new Date(patent.updated_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <div className="flex justify-end gap-1 items-center">
                                                                {primaryAction === "monitor" ? (
                                                                <DropdownMenu>
                                                                    <DropdownMenuTrigger asChild>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 text-xs h-8"
                                                                            title="Documento completo. Pronto para monitorar."
                                                                        >
                                                                            <Bell className="w-3.5 h-3.5 mr-1.5" /> Monitorar <ChevronDown className="w-3 h-3 ml-1" />
                                                                        </Button>
                                                                    </DropdownMenuTrigger>
                                                                    <DropdownMenuContent align="end">
                                                                        <DropdownMenuItem onClick={() => void addToMonitoring(patent, "processo")} disabled={!monitorEnabled}>Monitorar Processo</DropdownMenuItem>
                                                                        <DropdownMenuItem onClick={() => void addToMonitoring(patent, "colidencia")} disabled={!monitorEnabled}>Monitorar Colidência</DropdownMenuItem>
                                                                        <DropdownMenuItem onClick={() => void addToMonitoring(patent, "mercado")} disabled={!monitorEnabled}>Monitorar Mercado</DropdownMenuItem>
                                                                    </DropdownMenuContent>
                                                                </DropdownMenu>
                                                                ) : primaryAction === "queue_inpi" ? (
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="text-amber-700 hover:bg-amber-50 hover:text-amber-800 text-xs h-8"
                                                                    onClick={() => void enqueuePriorityInpiDoc(patent)}
                                                                    disabled={queueingInpiPatentId === patent.cod_pedido}
                                                                    title="Enfileirar scraper de documento INPI com prioridade."
                                                                >
                                                                    {queueingInpiPatentId === patent.cod_pedido ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Search className="w-3.5 h-3.5 mr-1.5" />}
                                                                    Buscar doc INPI
                                                                </Button>
                                                                ) : (
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="text-slate-500 hover:bg-slate-50 hover:text-slate-600 text-xs h-8"
                                                                    disabled
                                                                    title="Documento já está sendo processado."
                                                                >
                                                                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                                                    Doc em processamento
                                                                </Button>
                                                                )}
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="text-slate-600 hover:bg-slate-100 hover:text-slate-900 text-xs h-8"
                                                                    onClick={() => openPatentModal(patent)}
                                                                >
                                                                    <Eye className="w-3.5 h-3.5 mr-1.5" /> Visualizar
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 text-xs h-8"
                                                                    onClick={() => triggerManualUpload(patent)}
                                                                    disabled={uploadingPatentId === patent.cod_pedido}
                                                                    title="Enviar PDF completo manualmente para liberar monitoramento."
                                                                >
                                                                    {uploadingPatentId === patent.cod_pedido ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1.5" />}
                                                                    Subir PDF
                                                                </Button>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                )})}
                                            </TableBody>
                                        </Table>
                                        </div>
                                        
                                        <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-between items-center">
                                            <div className="text-xs text-slate-500 font-medium">
                                                Mostrando {patents.length} de {totalPatents} patentes no acervo • Página {page} de {totalPages}
                                            </div>
                                            <div className="flex gap-2 items-center">
                                                <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
                                                    <SelectTrigger className="h-8 w-[130px] bg-white text-xs">
                                                        <SelectValue placeholder="Tamanho" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="20">20 por página</SelectItem>
                                                        <SelectItem value="50">50 por página</SelectItem>
                                                        <SelectItem value="100">100 por página</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <Button
                                                    variant={lazyEnabled ? "default" : "outline"}
                                                    size="sm"
                                                    className="h-8 text-xs"
                                                    onClick={() => setLazyEnabled((prev) => !prev)}
                                                >
                                                    {lazyEnabled ? "Lazy ON" : "Lazy OFF"}
                                                </Button>
                                                <Button 
                                                    variant="outline" 
                                                    size="sm" 
                                                    className="h-8 text-xs bg-white"
                                                    disabled={page === 1}
                                                    onClick={() => void fetchData(page - 1, false)}
                                                >
                                                    <ChevronLeft className="w-3.5 h-3.5 mr-1" />
                                                    Anterior
                                                </Button>
                                                <Button 
                                                    variant="outline" 
                                                    size="sm" 
                                                    className="h-8 text-xs bg-white"
                                                    disabled={page >= totalPages}
                                                    onClick={() => void fetchData(page + 1, false)}
                                                >
                                                    Próxima
                                                    <ChevronRight className="w-3.5 h-3.5 ml-1" />
                                                </Button>
                                                {canLoadMore && (
                                                    <Button
                                                        variant="secondary"
                                                        size="sm"
                                                        className="h-8 text-xs"
                                                        disabled={loadingMore}
                                                        onClick={() => void fetchData(page + 1, true)}
                                                    >
                                                        {loadingMore ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}
                                                        Carregar mais
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
            <PatentDocumentModal
                open={patentModalOpen}
                onOpenChange={setPatentModalOpen}
                patent={selectedPatent}
            />
        </AppLayout>
    );
}
