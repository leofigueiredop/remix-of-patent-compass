import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import AppLayout from "@/components/AppLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Search, Eye, Users, ShieldCheck, FileSearch, Layers, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/+$/, "");

type MonitoredPatent = {
    id: string;
    patent_number: string;
    patent_id?: string | null;
    source: string;
    matched_attorney?: string | null;
    active: boolean;
    blocked_by_user: boolean;
    updated_at?: string;
    title?: string | null;
    applicant?: string | null;
    inventors?: string | null;
    ipc_codes?: string | null;
    status?: string | null;
    last_event?: string | null;
};

type CollisionAiBrief = {
    patentNumber: string;
    resumoExecutivo: string;
    nivelRisco: "baixo" | "medio" | "alto" | "critico";
    pontosChave: string[];
    oQueEstaColidindo: string;
    acaoRecomendada: string;
    analyzedAt?: string;
    cached?: boolean;
    camadaA?: number;
    camadaB?: number;
    scoreFinal?: number;
    confianca?: number;
};

type CollisionOverview = {
    monitored: {
        total: number;
        active: number;
        blocked: number;
        aiCoverage: number;
        aiCoveragePct: number;
    };
    alerts: {
        unread: number;
        due7d: number;
    };
    risk: {
        critico: number;
        alto: number;
        medio: number;
        baixo: number;
    };
};

export default function MonitoringPatents() {
    const [selectedPatent, setSelectedPatent] = useState<MonitoredPatent | null>(null);
    const [rows, setRows] = useState<MonitoredPatent[]>([]);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [query, setQuery] = useState("");
    const [source, setSource] = useState("all");
    const [active, setActive] = useState("all");
    const [attorney, setAttorney] = useState("");
    const [aiByPatent, setAiByPatent] = useState<Record<string, CollisionAiBrief>>({});
    const [aiLoadingPatent, setAiLoadingPatent] = useState<string | null>(null);
    const [overview, setOverview] = useState<CollisionOverview | null>(null);

    const statusBadge = useMemo(() => {
        return (value: boolean) => value
            ? <Badge variant="secondary">Ativo</Badge>
            : <Badge variant="outline">Inativo</Badge>;
    }, []);

    const riskBadge = useMemo(() => {
        return (value: CollisionAiBrief["nivelRisco"]) => {
            if (value === "critico") return <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-200 border-none font-mono">Crítico</Badge>;
            if (value === "alto") return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-200 border-none font-mono">Alto</Badge>;
            if (value === "medio") return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200 border-none font-mono">Médio</Badge>;
            return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-none font-mono">Baixo</Badge>;
        };
    }, []);

    const load = useCallback(async (targetPage = page) => {
        setLoading(true);
        try {
            const { data } = await axios.get(`${API_URL}/monitoring/patents`, {
                params: {
                    page: targetPage,
                    pageSize: 20,
                    q: query || undefined,
                    source: source === "all" ? undefined : source,
                    active: active === "all" ? undefined : active,
                    attorney: attorney || undefined
                }
            });
            setRows(data?.rows || []);
            setTotalPages(data?.totalPages || 1);
            setPage(data?.page || targetPage);
        } finally {
            setLoading(false);
        }
    }, [active, attorney, page, query, source]);

    const loadOverview = useCallback(async () => {
        try {
            const { data } = await axios.get(`${API_URL}/monitoring/collision/overview`);
            setOverview(data || null);
        } catch {
            setOverview(null);
        }
    }, []);

    useEffect(() => {
        void load(1);
        void loadOverview();
    }, [load, loadOverview]);

    const searchNow = async () => {
        await load(1);
    };

    const togglePatent = async (item: MonitoredPatent, nextActive: boolean) => {
        await axios.post(`${API_URL}/monitoring/patents/${item.id}/toggle`, {
            active: nextActive,
            blockedByUser: !nextActive
        });
        await load(page);
        await loadOverview();
    };

    const runCollisionAi = async (patent: MonitoredPatent) => {
        setAiLoadingPatent(patent.patent_number);
        try {
            const { data } = await axios.post(`${API_URL}/monitoring/collision/explain`, {
                patentNumber: patent.patent_number,
                title: patent.title,
                applicant: patent.applicant,
                inventors: patent.inventors,
                ipcCodes: patent.ipc_codes,
                lastEvent: patent.last_event
            });
            setAiByPatent((prev) => ({ ...prev, [patent.patent_number]: data }));
            await loadOverview();
        } catch (error: any) {
            toast.error(error?.response?.data?.error || "Falha ao gerar explicação de colidência.");
        } finally {
            setAiLoadingPatent(null);
        }
    };

    return (
        <AppLayout>
            <div className="flex flex-col gap-6 w-full mx-auto">
                <div className="flex justify-between items-end">
                    <div className="animate-in fade-in slide-in-from-left duration-700">
                        <h1 className="text-2xl font-bold flex items-center gap-3 text-slate-900 mb-2">
                            <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center">
                                <ShieldCheck className="w-5 h-5 text-amber-600" />
                            </div>
                            Monitoramento de Colidência
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            Gerenciamento do portfólio vigiado e análise de conflitos.
                        </p>
                    </div>
                    <div className="text-xs text-muted-foreground bg-slate-100 px-3 py-1.5 rounded-full font-medium">
                        {loading ? "Atualizando..." : `${rows.length} ativos na página`}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Cobertura IA</p>
                        <p className="text-2xl font-bold text-slate-900 mt-1">{overview?.monitored?.aiCoveragePct ?? 0}%</p>
                        <p className="text-xs text-slate-500 mt-1">{overview?.monitored?.aiCoverage ?? 0}/{overview?.monitored?.total ?? 0} ativos analisados</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Risco Alto+Crítico</p>
                        <p className="text-2xl font-bold text-rose-700 mt-1">{(overview?.risk?.alto ?? 0) + (overview?.risk?.critico ?? 0)}</p>
                        <p className="text-xs text-slate-500 mt-1">{overview?.risk?.critico ?? 0} críticos • {overview?.risk?.alto ?? 0} altos</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Alertas não lidos</p>
                        <p className="text-2xl font-bold text-slate-900 mt-1">{overview?.alerts?.unread ?? 0}</p>
                        <p className="text-xs text-slate-500 mt-1">{overview?.alerts?.due7d ?? 0} com prazo em 7 dias</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Ativos monitorados</p>
                        <p className="text-2xl font-bold text-slate-900 mt-1">{overview?.monitored?.active ?? 0}</p>
                        <p className="text-xs text-slate-500 mt-1">{overview?.monitored?.blocked ?? 0} bloqueados pelo usuário</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Risco médio+baixo</p>
                        <p className="text-2xl font-bold text-amber-700 mt-1">{(overview?.risk?.medio ?? 0) + (overview?.risk?.baixo ?? 0)}</p>
                        <p className="text-xs text-slate-500 mt-1">{overview?.risk?.medio ?? 0} médios • {overview?.risk?.baixo ?? 0} baixos</p>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-5 gap-3">
                    <Input className="bg-slate-50 border-slate-200 focus-visible:ring-amber-500" placeholder="Buscar por número, pedido ou título" value={query} onChange={(e) => setQuery(e.target.value)} />
                    <Input className="bg-slate-50 border-slate-200 focus-visible:ring-amber-500" placeholder="Filtrar por procurador" value={attorney} onChange={(e) => setAttorney(e.target.value)} />
                    <select className="h-9 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500" value={source} onChange={(e) => setSource(e.target.value)}>
                        <option value="all">Fonte: Todas</option>
                        <option value="manual">Manual</option>
                        <option value="attorney_auto">Auto por procurador</option>
                    </select>
                    <select className="h-9 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500" value={active} onChange={(e) => setActive(e.target.value)}>
                        <option value="all">Status: Todos</option>
                        <option value="true">Ativos</option>
                        <option value="false">Inativos</option>
                    </select>
                    <Button className="gap-2 bg-slate-900 hover:bg-slate-800 text-white" onClick={() => void searchNow()}>
                        <Search className="w-4 h-4" /> Filtrar
                    </Button>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <Table>
                        <TableHeader className="bg-slate-50 border-b border-slate-100">
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="font-semibold text-slate-700 w-[180px]">Ativo Monitorado</TableHead>
                                <TableHead className="font-semibold text-slate-700 max-w-[300px]">Título / Classificação</TableHead>
                                <TableHead className="font-semibold text-slate-700">Titular / Inventor</TableHead>
                                <TableHead className="font-semibold text-slate-700 text-center">Score (IA)</TableHead>
                                <TableHead className="font-semibold text-slate-700 text-center">Status</TableHead>
                                <TableHead className="font-semibold text-slate-700 text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((patent) => (
                                <TableRow key={patent.id} className="hover:bg-slate-50/50">
                                    <TableCell className="font-mono font-medium text-xs">
                                        {patent.patent_number}
                                        {patent.matched_attorney && (
                                            <div className="text-[10px] mt-1 text-slate-500 truncate max-w-[150px]" title={patent.matched_attorney}>
                                                {patent.matched_attorney}
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <div className="font-semibold text-sm line-clamp-2 text-slate-800" title={patent.title || ""}>{patent.title || "Sem título"}</div>
                                        <Badge variant="outline" className="mt-1.5 text-[10px] h-5 bg-white text-slate-600">{patent.ipc_codes || "IPC N/A"}</Badge>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        <div className="flex flex-col">
                                            <span className="font-medium text-slate-700">{patent.applicant || "-"}</span>
                                            <span className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                                <Users className="w-3 h-3" /> {patent.inventors || "-"}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <div className="flex flex-col items-center gap-1">
                                            {aiLoadingPatent === patent.patent_number ? (
                                                <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-200 border-none font-mono flex items-center gap-1">
                                                    <Loader2 className="w-3 h-3 animate-spin" /> IA
                                                </Badge>
                                            ) : aiByPatent[patent.patent_number] ? (
                                                riskBadge(aiByPatent[patent.patent_number].nivelRisco)
                                            ) : (
                                                <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-200 border-none font-mono">Pendente</Badge>
                                            )}
                                            {aiByPatent[patent.patent_number]?.scoreFinal ? (
                                                <span className="text-[10px] font-mono text-slate-700">Score {aiByPatent[patent.patent_number].scoreFinal}</span>
                                            ) : null}
                                            <span className="text-[9px] text-slate-400">{aiByPatent[patent.patent_number]?.cached ? "Cache IA • A/B" : "Camada A/B"}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        {statusBadge(patent.active)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="inline-flex gap-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="gap-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                                onClick={() => setSelectedPatent(patent)}
                                            >
                                                <FileSearch className="w-4 h-4" /> Analisar
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {!loading && rows.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                                        Nenhuma patente monitorada encontrada para os filtros atuais.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                    <div className="p-3 border-t flex justify-end gap-2">
                        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => void load(page - 1)}>Anterior</Button>
                        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => void load(page + 1)}>Próxima</Button>
                    </div>
                </div>

                <Sheet open={!!selectedPatent} onOpenChange={() => setSelectedPatent(null)}>
                    <SheetContent className="sm:max-w-xl w-full flex flex-col h-full">
                        {selectedPatent && (
                            <>
                                <SheetHeader className="mb-6">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Badge className="bg-slate-900 text-white font-mono">{selectedPatent.patent_number}</Badge>
                                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                                            Aguardando Revisão
                                        </Badge>
                                    </div>
                                    <SheetTitle className="text-lg leading-snug text-slate-800">{selectedPatent.title || "Sem Título"}</SheetTitle>
                                    <SheetDescription>
                                        <div className="flex gap-4 mt-2 text-sm">
                                            <span className="flex items-center gap-1.5"><Layers className="w-4 h-4" /> {selectedPatent.ipc_codes || "-"}</span>
                                            <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> {selectedPatent.applicant || "-"}</span>
                                        </div>
                                    </SheetDescription>
                                </SheetHeader>

                                <ScrollArea className="flex-1 -mx-6 px-6">
                                    <div className="space-y-6 pb-6">
                                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                                            <div className="bg-slate-50 p-3 border-b border-slate-200 flex justify-between items-center">
                                                <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                                                    <FileSearch className="w-4 h-4 text-amber-600" />
                                                    Análise de Colidência (Camada A + B)
                                                </h3>
                                                <Badge className="bg-slate-200 text-slate-700 hover:bg-slate-300">Resumo Inteligente</Badge>
                                            </div>
                                            <div className="p-4 space-y-4">
                                                {aiLoadingPatent === selectedPatent.patent_number ? (
                                                    <div className="text-sm text-slate-600 text-center py-8">
                                                        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-slate-500" />
                                                        Gerando explicação com Groq Cloud...
                                                    </div>
                                                ) : aiByPatent[selectedPatent.patent_number] ? (
                                                    <div className="space-y-4">
                                                        <div className="flex items-center gap-2">
                                                            {riskBadge(aiByPatent[selectedPatent.patent_number].nivelRisco)}
                                                            <Badge variant="outline" className="text-[10px]">
                                                                {aiByPatent[selectedPatent.patent_number].cached ? "Resultado em cache" : "Resultado novo"}
                                                            </Badge>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2">
                                                                <div className="text-[10px] uppercase text-slate-500 font-semibold">Camada A</div>
                                                                <div className="text-lg font-bold text-slate-800">{aiByPatent[selectedPatent.patent_number].camadaA ?? 0}</div>
                                                            </div>
                                                            <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2">
                                                                <div className="text-[10px] uppercase text-slate-500 font-semibold">Camada B</div>
                                                                <div className="text-lg font-bold text-slate-800">{aiByPatent[selectedPatent.patent_number].camadaB ?? 0}</div>
                                                            </div>
                                                            <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2">
                                                                <div className="text-[10px] uppercase text-slate-500 font-semibold">Score Final</div>
                                                                <div className="text-lg font-bold text-slate-800">{aiByPatent[selectedPatent.patent_number].scoreFinal ?? 0}</div>
                                                            </div>
                                                            <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2">
                                                                <div className="text-[10px] uppercase text-slate-500 font-semibold">Confiança</div>
                                                                <div className="text-lg font-bold text-slate-800">{aiByPatent[selectedPatent.patent_number].confianca ?? 0}%</div>
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Resumo executivo</div>
                                                            <p className="text-sm text-slate-700 leading-relaxed">{aiByPatent[selectedPatent.patent_number].resumoExecutivo}</p>
                                                        </div>
                                                        <div>
                                                            <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1">O que está colidindo</div>
                                                            <p className="text-sm text-slate-700 leading-relaxed">{aiByPatent[selectedPatent.patent_number].oQueEstaColidindo || "Sem indício objetivo de colisão com os dados atuais."}</p>
                                                        </div>
                                                        <div>
                                                            <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Pontos-chave</div>
                                                            <ul className="space-y-1">
                                                                {aiByPatent[selectedPatent.patent_number].pontosChave?.length
                                                                    ? aiByPatent[selectedPatent.patent_number].pontosChave.map((item, index) => (
                                                                        <li key={`${index}-${item}`} className="text-sm text-slate-700">• {item}</li>
                                                                    ))
                                                                    : <li className="text-sm text-slate-500">• Sem pontos adicionais</li>}
                                                            </ul>
                                                        </div>
                                                        <div>
                                                            <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Ação recomendada</div>
                                                            <p className="text-sm text-slate-700 leading-relaxed">{aiByPatent[selectedPatent.patent_number].acaoRecomendada || "Revisar despacho e histórico antes de concluir risco."}</p>
                                                        </div>
                                                        <Button className="mt-2 gap-2 bg-slate-900 hover:bg-slate-800 text-white" size="sm" onClick={() => void runCollisionAi(selectedPatent)}>
                                                            <FileSearch className="w-4 h-4" /> Atualizar análise
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <div className="text-sm text-slate-600 text-center py-6">
                                                        <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-3">
                                                            <FileSearch className="w-6 h-6 text-amber-600" />
                                                        </div>
                                                        <p className="font-medium text-slate-800 mb-1">Análise de IA Pendente</p>
                                                        <p className="max-w-sm mx-auto">Gere um resumo conciso para entender rapidamente onde há potencial colidência e qual ação tomar.</p>
                                                        <Button className="mt-4 gap-2 bg-slate-900 hover:bg-slate-800 text-white" size="sm" onClick={() => void runCollisionAi(selectedPatent)}>
                                                            <FileSearch className="w-4 h-4" /> Rodar Análise Camada A
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50">
                                                <div className="text-xs text-slate-500 font-semibold uppercase mb-2">Detalhes de Ingestão</div>
                                                <div className="space-y-2 text-sm">
                                                    <div className="flex justify-between"><span className="text-slate-500">Fonte:</span> <span className="font-medium">{selectedPatent.source}</span></div>
                                                    <div className="flex justify-between"><span className="text-slate-500">Status:</span> <span className="font-medium">{selectedPatent.active ? "Ativo" : "Inativo"}</span></div>
                                                    <div className="flex justify-between"><span className="text-slate-500">Bloqueado:</span> <span className="font-medium">{selectedPatent.blocked_by_user ? "Sim" : "Não"}</span></div>
                                                </div>
                                            </div>
                                            <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50">
                                                <div className="text-xs text-slate-500 font-semibold uppercase mb-2">Último Evento RPI</div>
                                                <p className="text-sm text-slate-700 leading-relaxed line-clamp-4">
                                                    {selectedPatent.last_event || "Sem evento detalhado registrado."}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </ScrollArea>

                                <SheetFooter className="pt-4 border-t mt-auto gap-2">
                                    <Button variant="outline" onClick={() => setSelectedPatent(null)}>Fechar</Button>
                                    <Button variant="outline" className="gap-2 bg-white text-slate-700 border-slate-200">
                                        <Eye className="w-4 h-4" /> Dossiê Completo
                                    </Button>
                                    <Button
                                        className="bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 border-none"
                                        onClick={() => void togglePatent(selectedPatent, !selectedPatent.active)}
                                    >
                                        {selectedPatent.active ? "Descartar Colisão" : "Reativar monitoramento"}
                                    </Button>
                                </SheetFooter>
                            </>
                        )}
                    </SheetContent>
                </Sheet>
            </div>
        </AppLayout>
    );
}
