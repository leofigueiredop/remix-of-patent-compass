import { useCallback, useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Workflow, Search, Plus, Filter, KanbanSquare, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import axios from "axios";
import { toast } from "sonner";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/+$/, "");

const COLUMNS: Array<{ id: DemandStatus; title: string; color: string }> = [
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

    const loadDemands = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await axios.get(`${API_URL}/demands`, { params: { q: query || undefined } });
            setRows(Array.isArray(data?.rows) ? data.rows : []);
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

    const rowsByStatus = useMemo(() => {
        return COLUMNS.reduce((acc, col) => {
            acc[col.id] = rows.filter((row) => row.status === col.id);
            return acc;
        }, {} as Record<DemandStatus, Demand[]>);
    }, [rows]);

    const handleStatusChange = async (id: string, status: DemandStatus) => {
        setSavingDemandId(id);
        try {
            await axios.patch(`${API_URL}/demands/${id}`, { status });
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
            await axios.post(`${API_URL}/demands`, {
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
                <div className="flex justify-between items-end">
                    <div className="animate-in fade-in slide-in-from-left duration-700">
                        <h1 className="text-2xl font-bold flex items-center gap-3 text-slate-900 mb-2">
                            <div className="w-10 h-10 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center">
                                <Workflow className="w-5 h-5 text-violet-600" />
                            </div>
                            Demandas e Entregas
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            Acompanhe orçamentos, tarefas e processos por cliente em kanban ou lista.
                        </p>
                    </div>
                    <div className="flex gap-3 items-center">
                        <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                            <button 
                                onClick={() => setViewMode("kanban")}
                                className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${viewMode === "kanban" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                            >
                                <KanbanSquare className="w-4 h-4" /> Kanban
                            </button>
                            <button 
                                onClick={() => setViewMode("list")}
                                className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${viewMode === "list" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                            >
                                <List className="w-4 h-4" /> Lista
                            </button>
                        </div>
                        <Button onClick={() => setCreateOpen(true)} className="gap-2 bg-violet-600 hover:bg-violet-700 text-white shadow-sm">
                            <Plus className="w-4 h-4" /> Nova Demanda
                        </Button>
                    </div>
                </div>

                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input className="pl-9 bg-slate-50 border-slate-200 h-9 text-sm" placeholder="Buscar por título, código ou cliente..." value={query} onChange={(e) => setQuery(e.target.value)} />
                    </div>
                    <Button variant="outline" className="gap-2 bg-white text-slate-600 h-9 text-sm">
                        <Filter className="w-4 h-4" /> Filtros
                    </Button>
                </div>

                {viewMode === "kanban" ? (
                    <div className="flex gap-4 overflow-x-auto pb-4 min-h-[600px]">
                        {COLUMNS.map(col => (
                            <div key={col.id} className="min-w-[300px] w-[300px] flex flex-col bg-slate-50/50 border border-slate-200 rounded-xl">
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
                                            {demand.owner_name && <p className="text-xs text-slate-500">Responsável: {demand.owner_name}</p>}
                                            <select
                                                value={demand.status}
                                                disabled={savingDemandId === demand.id}
                                                onChange={(e) => void handleStatusChange(demand.id, e.target.value as DemandStatus)}
                                                className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700"
                                            >
                                                {COLUMNS.map((option) => (
                                                    <option key={option.id} value={option.id}>{option.title}</option>
                                                ))}
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] bg-slate-50 border-b border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 uppercase tracking-wide">
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
                        ) : rows.map((row) => (
                            <div key={row.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center px-4 py-3 border-b border-slate-100 text-sm">
                                <div>
                                    <p className="font-medium text-slate-800">{row.title}</p>
                                    {row.patent_number && <p className="text-xs text-slate-500 font-mono">{row.patent_number}</p>}
                                </div>
                                <span className="text-slate-600">{row.client_name || "-"}</span>
                                <Badge variant="outline" className="w-fit uppercase">{row.priority}</Badge>
                                <span className="text-slate-600">{COLUMNS.find((col) => col.id === row.status)?.title || row.status}</span>
                                <span className="text-xs text-slate-500">{new Date(row.updated_at).toLocaleString("pt-BR")}</span>
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
                        <div className="grid grid-cols-2 gap-4">
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
        </AppLayout>
    );
}
