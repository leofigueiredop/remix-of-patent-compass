import { useCallback, useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Workflow, Search, Plus, Filter, KanbanSquare, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { api } from "@/services/auth";

const DEFAULT_COLUMNS: Array<{ id: DemandStatus; title: string; color: string }> = [
    { id: "nova", title: "Novas Demandas", color: "bg-blue-50 border-blue-200 text-blue-700" },
    { id: "triagem", title: "Triagem", color: "bg-purple-50 border-purple-200 text-purple-700" },
    { id: "andamento", title: "Em Andamento", color: "bg-amber-50 border-amber-200 text-amber-700" },
    { id: "cliente", title: "Aguardando Cliente", color: "bg-orange-50 border-orange-200 text-orange-700" },
    { id: "concluida", title: "Concluídas", color: "bg-emerald-50 border-emerald-200 text-emerald-700" }
];

type DemandStatus = "nova" | "triagem" | "andamento" | "cliente" | "concluida";
type DemandPriority = "baixa" | "media" | "alta" | "critica";

type Demand = {
    id: string;
    title: string;
    description?: string | null;
    status: DemandStatus;
    priority: DemandPriority;
    client_name?: string | null;
    owner_name?: string | null;
    patent_number?: string | null;
    contact_name?: string | null;
    contact_email?: string | null;
    comments_count?: number;
    emails_count?: number;
    sla_due_at?: string | null;
    ai_summary?: string | null;
    due_date?: string | null;
    updated_at: string;
};

export default function Demands() {
    const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
    const [query, setQuery] = useState("");
    const [rows, setRows] = useState<Demand[]>([]);
    const [loading, setLoading] = useState(true);
    const [savingDemandId, setSavingDemandId] = useState<string | null>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [newDescription, setNewDescription] = useState("");
    const [newOwner, setNewOwner] = useState("");
    const [newPatentNumber, setNewPatentNumber] = useState("");
    const [newPriority, setNewPriority] = useState<DemandPriority>("media");
    const [creating, setCreating] = useState(false);
    const [columns, setColumns] = useState(DEFAULT_COLUMNS);
    const [selectedDemandId, setSelectedDemandId] = useState<string | null>(null);
    const [selectedDemandData, setSelectedDemandData] = useState<any | null>(null);
    const [newComment, setNewComment] = useState("");
    const [savingComment, setSavingComment] = useState(false);
    const [statusFilter, setStatusFilter] = useState<"all" | DemandStatus>("all");
    const [priorityFilter, setPriorityFilter] = useState<"all" | DemandPriority>("all");
    const [slaRiskOnly, setSlaRiskOnly] = useState(false);

    const loadDemands = useCallback(async () => {
        setLoading(true);
        try {
            const [{ data }, settingsRes] = await Promise.all([
                api.get(`/demands`, { params: { q: query || undefined } }),
                api.get(`/settings/system`).catch(() => ({ data: {} }))
            ]);
            setRows(Array.isArray(data?.rows) ? data.rows : []);
            const statuses = Array.isArray(settingsRes?.data?.workflows?.statuses) ? settingsRes.data.workflows.statuses : [];
            if (statuses.length > 0) {
                const palette = DEFAULT_COLUMNS;
                const mapped = statuses.map((status: string, index: number) => ({
                    id: status as DemandStatus,
                    title: status.charAt(0).toUpperCase() + status.slice(1),
                    color: palette[index % palette.length]?.color || "bg-slate-50 border-slate-200 text-slate-700"
                }));
                setColumns(mapped);
            } else {
                setColumns(DEFAULT_COLUMNS);
            }
        } catch (error) {
            toast.error("Não foi possível carregar as demandas.");
        } finally {
            setLoading(false);
        }
    }, [query]);

    useEffect(() => {
        const timer = setTimeout(() => {
            void loadDemands();
        }, 250);
        return () => clearTimeout(timer);
    }, [loadDemands]);

    const filteredRows = useMemo(() => {
        return rows.filter((row) => {
            const matchesStatus = statusFilter === "all" || row.status === statusFilter;
            const matchesPriority = priorityFilter === "all" || row.priority === priorityFilter;
            const isSlaRisk = row.sla_due_at ? new Date(row.sla_due_at).getTime() <= (Date.now() + 1000 * 60 * 60 * 24 * 2) : false;
            const matchesSlaRisk = !slaRiskOnly || isSlaRisk;
            return matchesStatus && matchesPriority && matchesSlaRisk;
        });
    }, [rows, statusFilter, priorityFilter, slaRiskOnly]);

    const rowsByStatus = useMemo(() => {
        return columns.reduce((acc, col) => {
            acc[col.id] = filteredRows.filter((row) => row.status === col.id);
            return acc;
        }, {} as Record<DemandStatus, Demand[]>);
    }, [filteredRows, columns]);

    const crmMetrics = useMemo(() => {
        const total = rows.length;
        const critical = rows.filter((row) => row.priority === "critica").length;
        const slaRisk = rows.filter((row) => row.sla_due_at && new Date(row.sla_due_at).getTime() <= (Date.now() + 1000 * 60 * 60 * 24 * 2)).length;
        const waitingClient = rows.filter((row) => row.status === "cliente").length;
        return { total, critical, slaRisk, waitingClient };
    }, [rows]);

    const handleStatusChange = async (id: string, status: DemandStatus) => {
        setSavingDemandId(id);
        try {
            await api.patch(`/demands/${id}`, { status });
            setRows((prev) => prev.map((row) => (row.id === id ? { ...row, status } : row)));
        } catch {
            toast.error("Não foi possível mover a demanda.");
        } finally {
            setSavingDemandId(null);
        }
    };

    const handleCreateDemand = async () => {
        if (!newTitle.trim()) {
            toast.error("Informe um título para a demanda.");
            return;
        }
        setCreating(true);
        try {
            await api.post(`/demands`, {
                title: newTitle,
                description: newDescription,
                ownerName: newOwner,
                patentNumber: newPatentNumber,
                priority: newPriority
            });
            toast.success("Demanda criada com sucesso.");
            setCreateOpen(false);
            setNewTitle("");
            setNewDescription("");
            setNewOwner("");
            setNewPatentNumber("");
            setNewPriority("media");
            await loadDemands();
        } catch (error: any) {
            toast.error(error?.response?.data?.error || "Não foi possível criar a demanda.");
        } finally {
            setCreating(false);
        }
    };

    return (
        <AppLayout>
            <div className="flex flex-col gap-6 w-full mx-auto">
                <div className="flex flex-col gap-3 md:flex-row md:justify-between md:items-end">
                    <div className="animate-in fade-in slide-in-from-left duration-700">
                        <h1 className="text-2xl font-bold flex items-center gap-3 text-slate-900 mb-2">
                            <div className="w-10 h-10 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center">
                                <Workflow className="w-5 h-5 text-violet-600" />
                            </div>
                            CRM de Demandas de PI
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            Gerencie carteira, prazos críticos e tratativas com clientes em propriedade intelectual.
                        </p>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center md:w-auto">
                        <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 w-full sm:w-auto">
                            <button 
                                onClick={() => setViewMode("kanban")}
                                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-colors ${viewMode === "kanban" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                            >
                                <KanbanSquare className="w-4 h-4" /> Kanban
                            </button>
                            <button 
                                onClick={() => setViewMode("list")}
                                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-colors ${viewMode === "list" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                            >
                                <List className="w-4 h-4" /> Lista
                            </button>
                        </div>
                        <Button onClick={() => setCreateOpen(true)} className="gap-2 bg-violet-600 hover:bg-violet-700 text-white shadow-sm w-full sm:w-auto h-10">
                            <Plus className="w-4 h-4" /> Nova Demanda
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">Carteira ativa</p>
                        <p className="text-2xl font-semibold text-slate-900">{crmMetrics.total}</p>
                    </div>
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                        <p className="text-xs text-rose-600">Prioridade crítica</p>
                        <p className="text-2xl font-semibold text-rose-700">{crmMetrics.critical}</p>
                    </div>
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <p className="text-xs text-amber-700">SLA em risco (48h)</p>
                        <p className="text-2xl font-semibold text-amber-700">{crmMetrics.slaRisk}</p>
                    </div>
                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                        <p className="text-xs text-blue-700">Aguardando cliente</p>
                        <p className="text-2xl font-semibold text-blue-700">{crmMetrics.waitingClient}</p>
                    </div>
                </div>

                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input className="pl-9 bg-slate-50 border-slate-200 h-9 text-sm" placeholder="Buscar por título, código ou cliente..." value={query} onChange={(e) => setQuery(e.target.value)} />
                    </div>
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as any)}
                        className="h-10 rounded-md border border-slate-200 px-3 text-sm bg-white w-full sm:w-auto"
                    >
                        <option value="all">Todos status</option>
                        {columns.map((col) => (
                            <option key={col.id} value={col.id}>{col.title}</option>
                        ))}
                    </select>
                    <select
                        value={priorityFilter}
                        onChange={(e) => setPriorityFilter(e.target.value as any)}
                        className="h-10 rounded-md border border-slate-200 px-3 text-sm bg-white w-full sm:w-auto"
                    >
                        <option value="all">Todas prioridades</option>
                        <option value="baixa">Baixa</option>
                        <option value="media">Média</option>
                        <option value="alta">Alta</option>
                        <option value="critica">Crítica</option>
                    </select>
                    <label className="flex items-center gap-2 px-2 text-xs text-slate-600">
                        <input type="checkbox" checked={slaRiskOnly} onChange={(e) => setSlaRiskOnly(e.target.checked)} />
                        Somente SLA em risco
                    </label>
                    <Button variant="outline" className="gap-2 bg-white text-slate-600 h-10 text-sm w-full sm:w-auto">
                        <Filter className="w-4 h-4" /> Filtros
                    </Button>
                </div>

                {viewMode === "kanban" ? (
                    <div className="flex gap-4 overflow-x-auto pb-4 min-h-[600px]">
                        {columns.map(col => (
                            <div key={col.id} className="min-w-[85vw] sm:min-w-[300px] w-[85vw] sm:w-[300px] flex flex-col bg-slate-50/50 border border-slate-200 rounded-xl">
                                <div className={`p-3 border-b flex justify-between items-center ${col.color} rounded-t-xl bg-opacity-50`}>
                                    <h3 className="font-semibold text-sm">{col.title}</h3>
                                    <span className="bg-white/50 px-2 py-0.5 rounded-full text-xs font-bold">{rowsByStatus[col.id]?.length || 0}</span>
                                </div>
                                <div className="p-3 flex-1 flex flex-col gap-3">
                                    {loading ? (
                                        <p className="text-xs text-slate-500">Carregando...</p>
                                    ) : (rowsByStatus[col.id]?.length || 0) === 0 ? (
                                        <div className="flex-1 flex items-center justify-center text-center opacity-50">
                                            <p className="text-xs text-slate-500">Sem demandas nesta etapa</p>
                                        </div>
                                    ) : rowsByStatus[col.id].map((demand) => (
                                        <div key={demand.id} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 shadow-sm">
                                            <div className="flex items-start justify-between gap-2">
                                                <p className="text-sm font-semibold text-slate-800 line-clamp-2">{demand.title}</p>
                                                <Badge variant="outline" className="text-[10px] uppercase">{demand.priority}</Badge>
                                            </div>
                                            {demand.client_name && <p className="text-xs text-slate-500">{demand.client_name}</p>}
                                            {demand.contact_email && <p className="text-[11px] text-slate-500">{demand.contact_email}</p>}
                                            {demand.owner_name && <p className="text-xs text-slate-500">Responsável: {demand.owner_name}</p>}
                                            {demand.sla_due_at && <p className="text-[11px] text-rose-600">SLA: {new Date(demand.sla_due_at).toLocaleDateString("pt-BR")}</p>}
                                            <div className="flex items-center justify-between text-[11px] text-slate-500">
                                                <span>Comentários: {demand.comments_count || 0}</span>
                                                <span>Emails: {demand.emails_count || 0}</span>
                                            </div>
                                            <select
                                                value={demand.status}
                                                disabled={savingDemandId === demand.id}
                                                onChange={(e) => void handleStatusChange(demand.id, e.target.value as DemandStatus)}
                                                className="w-full h-10 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700"
                                            >
                                                {columns.map((option) => (
                                                    <option key={option.id} value={option.id}>{option.title}</option>
                                                ))}
                                            </select>
                                            <Button size="sm" variant="outline" className="w-full h-9" onClick={async () => {
                                                const { data } = await api.get(`/demands/${demand.id}`).catch(() => ({ data: null }));
                                                setSelectedDemandId(demand.id);
                                                setSelectedDemandData(data);
                                            }}>
                                                Detalhes
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                        <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr] bg-slate-50 border-b border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 uppercase tracking-wide">
                            <span>Título</span>
                            <span>Cliente</span>
                            <span>Prioridade</span>
                            <span>Status</span>
                            <span>Atualização</span>
                        </div>
                        {loading ? (
                            <div className="p-6 text-sm text-slate-500">Carregando demandas...</div>
                        ) : rows.length === 0 ? (
                            <div className="p-8 text-center text-sm text-slate-500">Nenhuma demanda cadastrada.</div>
                        ) : filteredRows.map((row) => (
                            <div key={row.id}>
                                <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center px-4 py-3 border-b border-slate-100 text-sm">
                                    <div>
                                        <p className="font-medium text-slate-800">{row.title}</p>
                                        {row.patent_number && <p className="text-xs text-slate-500 font-mono">{row.patent_number}</p>}
                                    </div>
                                    <span className="text-slate-600">{row.client_name || "-"}</span>
                                    <Badge variant="outline" className="w-fit uppercase">{row.priority}</Badge>
                                    <span className="text-slate-600">{columns.find((col) => col.id === row.status)?.title || row.status}</span>
                                    <span className="text-xs text-slate-500">{new Date(row.updated_at).toLocaleString("pt-BR")}</span>
                                </div>
                                <div className="md:hidden border-b border-slate-100 p-3 space-y-2">
                                    <p className="font-medium text-slate-800">{row.title}</p>
                                    <div className="flex flex-wrap gap-1">
                                        <Badge variant="outline" className="uppercase">{row.priority}</Badge>
                                        <Badge variant="secondary">{columns.find((col) => col.id === row.status)?.title || row.status}</Badge>
                                    </div>
                                    <p className="text-xs text-slate-500">{row.client_name || "Sem cliente"}</p>
                                    <p className="text-[11px] text-slate-500">{new Date(row.updated_at).toLocaleString("pt-BR")}</p>
                                    <Button size="sm" variant="outline" className="w-full h-9 mt-1" onClick={async () => {
                                        const { data } = await api.get(`/demands/${row.id}`).catch(() => ({ data: null }));
                                        setSelectedDemandId(row.id);
                                        setSelectedDemandData(data);
                                    }}>
                                        Detalhes
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="sm:max-w-[560px]">
                    <DialogHeader>
                        <DialogTitle>Nova Demanda</DialogTitle>
                        <DialogDescription>
                            Cadastre uma nova demanda para acompanhamento no funil operacional.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                        <div className="grid gap-2">
                            <Label htmlFor="demand-title">Título</Label>
                            <Input id="demand-title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Ex: Resposta à exigência BR102024..." />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="demand-description">Descrição</Label>
                            <Textarea id="demand-description" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Contexto da demanda, próximos passos e riscos." />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="demand-owner">Responsável</Label>
                                <Input id="demand-owner" value={newOwner} onChange={(e) => setNewOwner(e.target.value)} placeholder="Nome do analista" />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="demand-patent">Patente</Label>
                                <Input id="demand-patent" value={newPatentNumber} onChange={(e) => setNewPatentNumber(e.target.value)} placeholder="BR102024..." />
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="demand-priority">Prioridade</Label>
                            <select
                                id="demand-priority"
                                value={newPriority}
                                onChange={(e) => setNewPriority(e.target.value as DemandPriority)}
                                className="h-10 rounded-md border border-slate-200 px-3 text-sm bg-white"
                            >
                                <option value="baixa">Baixa</option>
                                <option value="media">Média</option>
                                <option value="alta">Alta</option>
                                <option value="critica">Crítica</option>
                            </select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
                        <Button onClick={handleCreateDemand} disabled={creating || !newTitle.trim()} className="bg-violet-600 hover:bg-violet-700 text-white">
                            {creating ? "Criando..." : "Criar Demanda"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(selectedDemandId)} onOpenChange={(open) => { if (!open) { setSelectedDemandId(null); setSelectedDemandData(null); } }}>
                <DialogContent className="sm:max-w-[820px] max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Detalhe da Demanda</DialogTitle>
                        <DialogDescription>Histórico, comentários, anexos e emails relacionados.</DialogDescription>
                    </DialogHeader>
                    {!selectedDemandData ? (
                        <p className="text-sm text-slate-500">Carregando...</p>
                    ) : (
                        <div className="space-y-4">
                            <div className="rounded-lg border p-3 text-sm">
                                <p className="font-semibold">{selectedDemandData.demand?.title}</p>
                                <p className="text-slate-600 mt-1">{selectedDemandData.demand?.description || "-"}</p>
                                {selectedDemandData.demand?.ai_summary && <p className="text-xs mt-2 text-violet-700">Resumo IA: {selectedDemandData.demand.ai_summary}</p>}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                <div className="rounded-lg border p-3">
                                    <p className="font-medium mb-2">Comentários</p>
                                    <div className="space-y-2 max-h-44 overflow-y-auto">
                                        {(selectedDemandData.comments || []).map((comment: any) => (
                                            <div key={comment.id} className="rounded border p-2">
                                                <p className="text-xs text-slate-700">{comment.body}</p>
                                                <p className="text-[10px] text-slate-500 mt-1">{new Date(comment.created_at).toLocaleString("pt-BR")}</p>
                                            </div>
                                        ))}
                                        {(selectedDemandData.comments || []).length === 0 && <p className="text-xs text-slate-500">Sem comentários.</p>}
                                    </div>
                                    <div className="flex flex-col sm:flex-row gap-2 mt-2">
                                        <Input value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Adicionar comentário" />
                                        <Button size="sm" className="h-9 w-full sm:w-auto" disabled={savingComment || !newComment.trim()} onClick={async () => {
                                            if (!selectedDemandId) return;
                                            setSavingComment(true);
                                            try {
                                                await api.post(`/demands/${selectedDemandId}/comments`, { body: newComment });
                                                const { data } = await api.get(`/demands/${selectedDemandId}`);
                                                setSelectedDemandData(data);
                                                setNewComment("");
                                            } finally {
                                                setSavingComment(false);
                                            }
                                        }}>Salvar</Button>
                                    </div>
                                </div>
                                <div className="rounded-lg border p-3">
                                    <p className="font-medium mb-2">Histórico / Emails</p>
                                    <div className="space-y-2 max-h-44 overflow-y-auto">
                                        {(selectedDemandData.history || []).map((item: any) => (
                                            <div key={item.id} className="text-xs rounded border p-2">
                                                <p>{item.action}: {item.old_value || "-"} → {item.new_value || "-"}</p>
                                                <p className="text-[10px] text-slate-500 mt-1">{new Date(item.created_at).toLocaleString("pt-BR")}</p>
                                            </div>
                                        ))}
                                        {(selectedDemandData.emails || []).map((email: any) => (
                                            <div key={email.id} className="text-xs rounded border p-2">
                                                <p>Email: {email.recipient_email} • {email.status}</p>
                                                <p className="text-[10px] text-slate-500 mt-1">{new Date(email.created_at).toLocaleString("pt-BR")}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
