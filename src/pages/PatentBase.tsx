import { useState, useEffect } from "react";
import AppLayout from "@/components/AppLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
    Database, 
    ListRestart, 
    CheckCircle2, 
    Loader2, 
    AlertCircle, 
    Clock, 
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

interface ScrapingJob {
    id: string;
    patent_id: string;
    status: string;
    attempts: number;
    created_at: string;
    patent: {
        numero_publicacao: string;
        title: string;
    };
}

interface InpiPatent {
    cod_pedido: string;
    numero_publicacao: string;
    title: string;
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
    const [jobs, setJobs] = useState<ScrapingJob[]>([]);
    const [patents, setPatents] = useState<InpiPatent[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState("fila");
    const [page, setPage] = useState(1);
    const [totalPatents, setTotalPatents] = useState(0);
    const [query, setQuery] = useState("");
    const [patentModalOpen, setPatentModalOpen] = useState(false);
    const [selectedPatent, setSelectedPatent] = useState<PatentDocumentData | null>(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            if (tab === "fila") {
                const res = await axios.get(`${API_URL}/patents/queue`);
                setJobs(res.data.jobs);
            } else {
                const params = new URLSearchParams({ page: String(page) });
                if (query.trim()) params.set("q", query.trim());
                const res = await axios.get(`${API_URL}/patents/processed?${params.toString()}`);
                setPatents(res.data.patents);
                setTotalPatents(res.data.total);
            }
        } catch (err) {
            console.error("Error fetching data:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(() => {
            if (tab === "fila") fetchData();
        }, 10000); // Auto refresh queue every 10s
        return () => clearInterval(interval);
    }, [tab, page, query]);

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "completed": return <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Concluído</Badge>;
            case "running": return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 flex gap-1 items-center"><Loader2 className="w-3 h-3 animate-spin"/> Processando</Badge>;
            case "failed": return <Badge variant="destructive" className="flex gap-1 items-center"><AlertCircle className="w-3 h-3"/> Falha</Badge>;
            default: return <Badge variant="secondary" className="flex gap-1 items-center"><Clock className="w-3 h-3"/> Pendente</Badge>;
        }
    };

    const openPatentModal = (patent: InpiPatent) => {
        const fallbackUrl = `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${encodeURIComponent(patent.cod_pedido)}`;
        setSelectedPatent({
            publicationNumber: patent.numero_publicacao || patent.cod_pedido,
            cod_pedido: patent.cod_pedido,
            title: patent.title || "Sem título",
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
            <div className="space-y-8 max-w-[1400px] mx-auto">
                <div className="flex justify-between items-start">
                    <div className="animate-in fade-in slide-in-from-left duration-700">
                        <h1 className="text-3xl font-extrabold tracking-tight text-foreground/90 mb-2 bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
                            Base de Patentes
                        </h1>
                        <p className="text-muted-foreground">
                            Gerencie sua base local de patentes sincronizadas e monitore a fila de processamento.
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="glass-effect"
                            onClick={() => fetchData()}
                            disabled={loading}
                        >
                            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                            Atualizar
                        </Button>
                    </div>
                </div>

                <Tabs value={tab} onValueChange={setTab} className="space-y-6">
                    <TabsList className="bg-muted/50 p-1 glass-effect border">
                        <TabsTrigger value="fila" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all">
                            <ListRestart className="w-4 h-4" />
                            Fila de Processamento
                            {jobs.length > 0 && (
                                <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-primary-foreground text-primary rounded-full font-bold">
                                    {jobs.length}
                                </span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="processadas" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all">
                            <CheckCircle2 className="w-4 h-4" />
                            Patentes Processadas
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="fila" className="animate-in fade-in zoom-in-95 duration-500">
                        <Card className="border-none shadow-2xl glass-effect-dark overflow-hidden">
                            <CardHeader className="border-b bg-muted/20">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Clock className="w-5 h-5 text-primary" />
                                    Fila de Raspagem em Tempo Real
                                </CardTitle>
                                <CardDescription>
                                    Pendente = aguardando execução, Processando = worker em andamento, Falha = tentativa com erro (pode reprocessar).
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="p-0">
                                {loading && jobs.length === 0 ? (
                                    <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-3">
                                        <Loader2 className="w-10 h-10 animate-spin text-primary/40" />
                                        Carregando fila...
                                    </div>
                                ) : jobs.length === 0 ? (
                                    <div className="p-20 text-center">
                                        <div className="w-16 h-16 bg-muted/50 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-dashed">
                                            <CheckCircle2 className="w-8 h-8 text-muted-foreground/30" />
                                        </div>
                                        <h3 className="font-semibold text-lg mb-1 italic text-muted-foreground">Tudo limpo!</h3>
                                        <p className="text-muted-foreground text-sm">Nenhum job pendente no momento.</p>
                                    </div>
                                ) : (
                                    <Table>
                                        <TableHeader className="bg-muted/30">
                                            <TableRow>
                                                <TableHead>Patente</TableHead>
                                                <TableHead>Título</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead>Tentativas</TableHead>
                                                <TableHead>Enfileirado em</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {jobs.map((job) => (
                                                <TableRow key={job.id} className="hover:bg-muted/20 transition-colors border-b-muted/20">
                                                    <TableCell className="font-mono font-medium text-primary">
                                                        {job.patent?.numero_publicacao || job.patent_id}
                                                    </TableCell>
                                                    <TableCell className="max-w-[400px]">
                                                        <div className="truncate text-sm" title={job.patent?.title}>
                                                            {job.patent?.title || "Carregando..."}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>{getStatusBadge(job.status)}</TableCell>
                                                    <TableCell className="text-sm font-medium">{job.attempts}</TableCell>
                                                    <TableCell className="text-muted-foreground text-xs font-mono">
                                                        {format(new Date(job.created_at), "HH:mm:ss 'em' dd/MM", { locale: ptBR })}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="processadas" className="animate-in fade-in zoom-in-95 duration-500">
                        <Card className="border-none shadow-2xl glass-effect-dark overflow-hidden">
                            <CardHeader className="border-b bg-muted/20">
                                <div className="flex justify-between items-center">
                                    <div>
                                        <CardTitle className="text-lg flex items-center gap-2">
                                            <Database className="w-5 h-5 text-primary" />
                                            Acervo Local de Patentes
                                        </CardTitle>
                                        <CardDescription>
                                            Patentes conhecidas na base local. Use o filtro para buscar por número, título, titular ou inventor.
                                        </CardDescription>
                                    </div>
                                    <div className="flex gap-2">
                                        <div className="relative">
                                            <Search className="absolute left-2.5 top-2.5 h-4 h-4 text-muted-foreground" />
                                            <input 
                                                type="search" 
                                                placeholder="Filtrar base..." 
                                                value={query}
                                                onChange={(event) => {
                                                    setPage(1);
                                                    setQuery(event.target.value);
                                                }}
                                                className="h-9 w-64 pl-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                                            <TableHeader className="bg-muted/30">
                                                <TableRow>
                                                    <TableHead>Número</TableHead>
                                                    <TableHead>Resumo / Titular</TableHead>
                                                    <TableHead className="text-center">Dados Capturados</TableHead>
                                                    <TableHead>Última Raspagem</TableHead>
                                                    <TableHead className="text-right">Ações</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {patents.map((patent) => (
                                                    <TableRow key={patent.cod_pedido} className="hover:bg-muted/10 transition-colors border-b-muted/20">
                                                        <TableCell className="font-mono font-medium text-xs">
                                                            {patent.numero_publicacao || patent.cod_pedido}
                                                        </TableCell>
                                                        <TableCell className="py-4">
                                                            <div className="font-semibold text-sm line-clamp-1" title={patent.title}>
                                                                {patent.title}
                                                            </div>
                                                            <div className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wider font-medium truncate max-w-[300px]">
                                                                {patent.applicant}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex gap-1.5 justify-center">
                                                                <Badge variant="outline" className="text-[9px] h-4.5 bg-background shadow-sm" title="Publicações">
                                                                    PUB: {patent._count.publications}
                                                                </Badge>
                                                                <Badge variant="outline" className="text-[9px] h-4.5 bg-background shadow-sm border-blue-200/50" title="Petições">
                                                                    PET: {patent._count.petitions}
                                                                </Badge>
                                                                <Badge variant="outline" className="text-[9px] h-4.5 bg-background shadow-sm border-amber-200/50" title="Anuidades">
                                                                    ANU: {patent._count.annuities}
                                                                </Badge>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-muted-foreground text-xs font-mono">
                                                            {format(new Date(patent.updated_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <div className="flex justify-end gap-1">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="xs"
                                                                    className="text-emerald-600 hover:bg-emerald-50"
                                                                    onClick={() => void addToMonitoring(patent)}
                                                                >
                                                                    <Bell className="w-3 h-3 mr-1" /> Monitorar
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="xs"
                                                                    className="text-primary hover:bg-primary/10"
                                                                    onClick={() => openPatentModal(patent)}
                                                                >
                                                                    <Download className="w-3 h-3 mr-1" /> Abrir
                                                                </Button>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                        
                                        <div className="p-4 border-t bg-muted/10 flex justify-between items-center bg-card">
                                            <div className="text-xs text-muted-foreground">
                                                Mostrando {patents.length} de {totalPatents} patentes no acervo
                                            </div>
                                            <div className="flex gap-2">
                                                <Button 
                                                    variant="outline" 
                                                    size="xs" 
                                                    disabled={page === 1}
                                                    onClick={() => setPage(p => p - 1)}
                                                >
                                                    Anterior
                                                </Button>
                                                <Button 
                                                    variant="outline" 
                                                    size="xs" 
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
                    </TabsContent>
                </Tabs>
            </div>
            <PatentDocumentModal
                open={patentModalOpen}
                onOpenChange={setPatentModalOpen}
                patent={selectedPatent}
            />
        </AppLayout>
    );
}
