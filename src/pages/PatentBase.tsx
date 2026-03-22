import { useState, useEffect, useCallback } from "react";
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
    Download,
    Bell
} from "lucide-react";
import axios from "axios";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import PatentDocumentModal, { PatentDocumentData } from "@/components/PatentDocumentModal";

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
    const [page, setPage] = useState(1);
    const [totalPatents, setTotalPatents] = useState(0);
    const [query, setQuery] = useState("");
    const [patentModalOpen, setPatentModalOpen] = useState(false);
    const [selectedPatent, setSelectedPatent] = useState<PatentDocumentData | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page) });
            if (query.trim()) params.set("q", query.trim());
            const res = await axios.get(`${API_URL}/patents/processed?${params.toString()}`);
            setPatents(res.data.patents);
            setTotalPatents(res.data.total);
        } catch (err) {
            console.error("Error fetching data:", err);
        } finally {
            setLoading(false);
        }
    }, [page, query]);

    useEffect(() => {
        void fetchData();
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
            status: patent.status || patent.document_status || "",
            source: "INPI",
            url: fallbackUrl,
            inpiUrl: fallbackUrl,
            storage: {
                hasStoredDocument: Boolean(patent.has_stored_document)
            }
        });
        setPatentModalOpen(true);
    };

    const addToMonitoring = async (patent: InpiPatent) => {
        const patentNumber = (patent.numero_publicacao || patent.cod_pedido || "").trim();
        if (!patentNumber) return;
        await axios.post(`${API_URL}/monitoring/patents/add`, {
            patentNumber,
            patentId: patent.cod_pedido
        });
    };

    return (
        <AppLayout>
            <div className="flex flex-col gap-6 w-full mx-auto">
                <div className="flex justify-between items-start">
                    <div className="animate-in fade-in slide-in-from-left duration-700">
                        <h1 className="text-2xl font-bold flex items-center gap-3 text-slate-900 mb-2">
                            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                                <Database className="w-5 h-5 text-emerald-600" />
                            </div>
                            Base Local de Patentes
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            Gerencie sua base local de patentes extraídas e consolidadas.
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="bg-white border-slate-200"
                            onClick={() => fetchData()}
                            disabled={loading}
                        >
                            <RefreshCw className={`w-4 h-4 mr-2 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
                            Atualizar Base
                        </Button>
                    </div>
                </div>

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
                                    <div className="flex gap-2 w-full md:w-auto">
                                        <div className="relative w-full md:w-64">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                            <input 
                                                type="search" 
                                                placeholder="Filtrar base (número, titular...)" 
                                                value={query}
                                                onChange={(event) => {
                                                    setPage(1);
                                                    setQuery(event.target.value);
                                                }}
                                                className="h-9 w-full pl-9 rounded-lg border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
                                            />
                                        </div>
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
                                        <Table>
                                            <TableHeader className="bg-slate-50 border-b border-slate-100">
                                                <TableRow className="hover:bg-transparent">
                                                    <TableHead className="font-semibold text-slate-700">Número</TableHead>
                                                    <TableHead className="font-semibold text-slate-700">Resumo / Titular</TableHead>
                                                    <TableHead className="font-semibold text-slate-700 text-center">Dados Capturados</TableHead>
                                                    <TableHead className="font-semibold text-slate-700">Última Raspagem</TableHead>
                                                    <TableHead className="font-semibold text-slate-700 text-right">Ações</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {patents.map((patent) => (
                                                    <TableRow key={patent.cod_pedido} className="hover:bg-slate-50/50 transition-colors border-b-slate-100">
                                                        <TableCell className="font-mono font-medium text-xs text-slate-700">
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
                                                        <TableCell className="text-slate-500 text-xs font-mono">
                                                            {format(new Date(patent.updated_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <div className="flex justify-end gap-1">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 text-xs h-8"
                                                                    onClick={() => void addToMonitoring(patent)}
                                                                >
                                                                    <Bell className="w-3.5 h-3.5 mr-1.5" /> Monitorar
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="text-slate-600 hover:bg-slate-100 hover:text-slate-900 text-xs h-8"
                                                                    onClick={() => openPatentModal(patent)}
                                                                >
                                                                    <Download className="w-3.5 h-3.5 mr-1.5" /> Abrir
                                                                </Button>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                        
                                        <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-between items-center">
                                            <div className="text-xs text-slate-500 font-medium">
                                                Mostrando {patents.length} de {totalPatents} patentes no acervo
                                            </div>
                                            <div className="flex gap-2">
                                                <Button 
                                                    variant="outline" 
                                                    size="sm" 
                                                    className="h-8 text-xs bg-white"
                                                    disabled={page === 1}
                                                    onClick={() => setPage(p => p - 1)}
                                                >
                                                    Anterior
                                                </Button>
                                                <Button 
                                                    variant="outline" 
                                                    size="sm" 
                                                    className="h-8 text-xs bg-white"
                                                    disabled={page >= Math.ceil(totalPatents / 20)}
                                                    onClick={() => setPage(p => p + 1)}
                                                >
                                                    Próxima
                                                </Button>
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
