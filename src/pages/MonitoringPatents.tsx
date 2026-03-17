import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import AppLayout from "@/components/AppLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Search, Eye, FileText, ScrollText, Users } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";

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

    const statusBadge = useMemo(() => {
        return (value: boolean) => value
            ? <Badge variant="secondary">Ativo</Badge>
            : <Badge variant="outline">Inativo</Badge>;
    }, []);

    const load = async (targetPage = page) => {
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
    };

    useEffect(() => {
        void load(1);
    }, [source, active]);

    const searchNow = async () => {
        await load(1);
    };

    const togglePatent = async (item: MonitoredPatent, nextActive: boolean) => {
        await axios.post(`${API_URL}/monitoring/patents/${item.id}/toggle`, {
            active: nextActive,
            blockedByUser: !nextActive
        });
        await load(page);
    };

    return (
        <AppLayout>
            <div className="space-y-6">
                <div className="flex justify-between items-end">
                    <div>
                        <h1 className="text-2xl font-bold mb-1">Patentes Monitoradas</h1>
                        <p className="text-muted-foreground text-sm">
                            Gerenciamento do portfólio vigiado (Próprias e de Terceiros)
                        </p>
                    </div>
                    <div className="text-xs text-muted-foreground">{loading ? "Atualizando..." : `${rows.length} itens na página`}</div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                    <Input placeholder="Buscar por número, pedido ou título" value={query} onChange={(e) => setQuery(e.target.value)} />
                    <Input placeholder="Filtrar por procurador" value={attorney} onChange={(e) => setAttorney(e.target.value)} />
                    <select className="h-9 rounded-md border bg-background px-2 text-sm" value={source} onChange={(e) => setSource(e.target.value)}>
                        <option value="all">Fonte: Todas</option>
                        <option value="manual">Manual</option>
                        <option value="attorney_auto">Auto por procurador</option>
                    </select>
                    <select className="h-9 rounded-md border bg-background px-2 text-sm" value={active} onChange={(e) => setActive(e.target.value)}>
                        <option value="all">Status: Todos</option>
                        <option value="true">Ativos</option>
                        <option value="false">Inativos</option>
                    </select>
                    <Button className="gap-2" onClick={() => void searchNow()}>
                        <Search className="w-4 h-4" /> Filtrar
                    </Button>
                </div>

                <div className="rounded-md border bg-card">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[180px]">Número</TableHead>
                                <TableHead className="max-w-[300px]">Título / Classificação</TableHead>
                                <TableHead>Titular / Inventor</TableHead>
                                <TableHead>Origem</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((patent) => (
                                <TableRow key={patent.id}>
                                    <TableCell className="font-mono font-medium text-xs">
                                        {patent.patent_number}
                                    </TableCell>
                                    <TableCell>
                                        <div className="font-semibold text-sm line-clamp-2" title={patent.title || ""}>{patent.title || "Sem título"}</div>
                                        <Badge variant="outline" className="mt-1 text-[10px] h-5">{patent.ipc_codes || "IPC N/A"}</Badge>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        <div className="flex flex-col">
                                            <span className="font-medium">{patent.applicant || "-"}</span>
                                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                <Users className="w-3 h-3" /> {patent.inventors || "-"}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline">{patent.source}</Badge>
                                        {patent.matched_attorney && (
                                            <div className="text-[10px] mt-1 text-muted-foreground truncate max-w-[180px]" title={patent.matched_attorney}>
                                                {patent.matched_attorney}
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-center">
                                        {statusBadge(patent.active)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="inline-flex gap-1">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="gap-2 hover:text-accent"
                                                onClick={() => setSelectedPatent(patent)}
                                            >
                                                <Eye className="w-4 h-4" /> Detalhes
                                            </Button>
                                            <Button
                                                variant={patent.active ? "outline" : "secondary"}
                                                size="sm"
                                                onClick={() => void togglePatent(patent, !patent.active)}
                                            >
                                                {patent.active ? "Remover" : "Reativar"}
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
                                    <Badge className="w-fit mb-2">{selectedPatent.patent_number}</Badge>
                                    <SheetTitle className="text-lg leading-snug">{selectedPatent.title || selectedPatent.patent_number}</SheetTitle>
                                    <SheetDescription>
                                        IPC: {selectedPatent.ipc_codes || "-"} | Status: {selectedPatent.status || "-"}
                                    </SheetDescription>
                                </SheetHeader>

                                <ScrollArea className="flex-1 -mx-6 px-6">
                                    <div className="space-y-6 pb-6">
                                        <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
                                            <div>
                                                <div className="text-xs text-muted-foreground font-semibold uppercase mb-1">Titular</div>
                                                <div className="text-sm font-medium">{selectedPatent.applicant || "-"}</div>
                                            </div>
                                            <div>
                                                <div className="text-xs text-muted-foreground font-semibold uppercase mb-1">Inventores</div>
                                                <div className="text-sm font-medium">{selectedPatent.inventors || "-"}</div>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <h3 className="text-sm font-bold flex items-center gap-2">
                                                <FileText className="w-4 h-4 text-accent" /> Último Evento
                                            </h3>
                                            <p className="text-sm text-justify text-muted-foreground leading-relaxed bg-muted/20 p-3 rounded border">
                                                {selectedPatent.last_event || "Sem evento detalhado registrado."}
                                            </p>
                                        </div>

                                        <div className="space-y-2">
                                            <h3 className="text-sm font-bold flex items-center gap-2">
                                                <ScrollText className="w-4 h-4 text-accent" /> Monitoramento
                                            </h3>
                                            <div className="text-sm font-mono text-muted-foreground bg-muted/20 p-3 rounded border whitespace-pre-wrap">
                                                {`Fonte: ${selectedPatent.source}\nAtivo: ${selectedPatent.active ? "Sim" : "Não"}\nBloqueado pelo usuário: ${selectedPatent.blocked_by_user ? "Sim" : "Não"}\nProcurador match: ${selectedPatent.matched_attorney || "-"}`}
                                            </div>
                                        </div>
                                    </div>
                                </ScrollArea>

                                <SheetFooter className="pt-4 border-t mt-auto">
                                    <Button variant="outline" onClick={() => setSelectedPatent(null)}>Fechar</Button>
                                    <Button
                                        className="bg-accent text-accent-foreground"
                                        onClick={() => void togglePatent(selectedPatent, !selectedPatent.active)}
                                    >
                                        {selectedPatent.active ? "Remover do monitoramento" : "Reativar monitoramento"}
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
