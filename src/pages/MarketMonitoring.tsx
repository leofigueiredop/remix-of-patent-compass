import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { SearchCheck, Search, Plus, Filter, TrendingUp, BarChart3, LineChart, FilterX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import axios from "axios";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import OperationalPageHeader from "@/components/operations/OperationalPageHeader";
import OperationalKpiCard from "@/components/operations/OperationalKpiCard";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/+$/, "");

type Watchlist = {
    id: string;
    name: string;
    query: string;
    scope: string;
    active: boolean;
};

export default function MarketMonitoring() {
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    const [activeFilter, setActiveFilter] = useState<"all" | "active" | "paused">("all");
    const [newOpen, setNewOpen] = useState(false);
    const [newName, setNewName] = useState("");
    const [newQuery, setNewQuery] = useState("");
    const [creating, setCreating] = useState(false);
    const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
    const [overview, setOverview] = useState<{ topHolders: Array<{ label: string; total: number }>; topClasses: Array<{ label: string; total: number }>; filingsLast30d: number; }>({
        topHolders: [],
        topClasses: [],
        filingsLast30d: 0
    });

    const load = async () => {
        setLoading(true);
        try {
            const [overviewRes, watchlistsRes] = await Promise.all([
                axios.get(`${API_URL}/monitoring/market/overview`),
                axios.get(`${API_URL}/monitoring/market/watchlists`)
            ]);
            setOverview({
                topHolders: overviewRes.data?.topHolders || [],
                topClasses: overviewRes.data?.topClasses || [],
                filingsLast30d: Number(overviewRes.data?.filingsLast30d || 0)
            });
            setWatchlists(Array.isArray(watchlistsRes.data?.rows) ? watchlistsRes.data.rows : []);
        } catch {
            toast.error("Falha ao carregar monitoramento de mercado.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const filteredWatchlists = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return watchlists.filter((item) => {
            const matchesText = !needle || item.name.toLowerCase().includes(needle) || item.query.toLowerCase().includes(needle);
            const matchesStatus = activeFilter === "all" || (activeFilter === "active" ? item.active : !item.active);
            return matchesText && matchesStatus;
        });
    }, [watchlists, query, activeFilter]);

    const handleCreate = async () => {
        if (!newName.trim() || !newQuery.trim()) {
            toast.error("Informe nome e query da vigília.");
            return;
        }
        setCreating(true);
        try {
            await axios.post(`${API_URL}/monitoring/market/watchlists`, { name: newName, query: newQuery, scope: "all" });
            toast.success("Vigília criada.");
            setNewOpen(false);
            setNewName("");
            setNewQuery("");
            await load();
        } catch (error: any) {
            toast.error(error?.response?.data?.error || "Não foi possível criar vigília.");
        } finally {
            setCreating(false);
        }
    };

    const handleToggle = async (item: Watchlist) => {
        try {
            await axios.patch(`${API_URL}/monitoring/market/watchlists/${item.id}`, { active: !item.active });
            setWatchlists((prev) => prev.map((row) => row.id === item.id ? { ...row, active: !row.active } : row));
        } catch {
            toast.error("Falha ao atualizar vigília.");
        }
    };

    return (
        <AppLayout>
            <div className="flex flex-col gap-6 w-full mx-auto">
                <OperationalPageHeader
                    title="Monitoramento de Mercado"
                    description="Análise estratégica de concorrentes, tecnologias e inventores."
                    icon={<SearchCheck className="w-5 h-5 text-slate-600" />}
                    actions={
                        <Button onClick={() => setNewOpen(true)} className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">
                            <Plus className="w-4 h-4" /> Nova Vigília
                        </Button>
                    }
                />

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-2">
                    <OperationalKpiCard
                        label="Top Titulares"
                        value={overview.topHolders[0]?.label || "-"}
                        icon={<TrendingUp className="w-4 h-4" />}
                        tone="info"
                        detail={overview.topHolders[0] ? `${overview.topHolders[0].total} documentos` : "Aguardando dados"}
                    />
                    <OperationalKpiCard
                        label="Classes IPC/CPC"
                        value={overview.topClasses[0]?.label || "-"}
                        icon={<BarChart3 className="w-4 h-4" />}
                        tone="info"
                        detail={overview.topClasses[0] ? `${overview.topClasses[0].total} documentos` : "Aguardando dados"}
                    />
                    <OperationalKpiCard
                        label="Novos Depósitos"
                        value={overview.filingsLast30d}
                        icon={<LineChart className="w-4 h-4" />}
                        tone="success"
                        detail="Depósitos nos últimos 30 dias"
                    />
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input className="pl-9 bg-slate-50 border-slate-200" placeholder="Buscar vigílias..." value={query} onChange={(e) => setQuery(e.target.value)} />
                    </div>
                    <select
                        value={activeFilter}
                        onChange={(e) => setActiveFilter(e.target.value as "all" | "active" | "paused")}
                        className="h-10 rounded-md border border-slate-200 px-3 text-sm bg-white text-slate-700"
                    >
                        <option value="all">Todas</option>
                        <option value="active">Ativas</option>
                        <option value="paused">Pausadas</option>
                    </select>
                    <Button variant="outline" className="gap-2 h-10 text-sm bg-white text-slate-600 w-full sm:w-auto" onClick={() => void load()} disabled={loading}>
                        <Filter className="w-4 h-4" /> Filtros
                    </Button>
                    <Button
                        variant="outline"
                        className="gap-2 h-10 text-sm bg-white text-slate-600 w-full sm:w-auto"
                        onClick={() => {
                            setQuery("");
                            setActiveFilter("all");
                            void load();
                        }}
                    >
                        <FilterX className="w-4 h-4" /> Limpar
                    </Button>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden min-h-[300px]">
                    {loading ? (
                        <div className="p-8 text-center text-sm text-slate-500">Carregando vigílias...</div>
                    ) : filteredWatchlists.length === 0 ? (
                        <div className="min-h-[300px] flex flex-col items-center justify-center text-center p-8">
                            <SearchCheck className="w-12 h-12 text-slate-300 mb-4" />
                            <h3 className="text-lg font-bold text-slate-800">Nenhuma vigília tecnológica ativa</h3>
                            <p className="text-sm text-slate-500 mt-2 max-w-sm">
                                Configure o rastreamento por titular, classe de patente ou termos-chave.
                            </p>
                            <Button onClick={() => setNewOpen(true)} className="mt-6 gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">
                                <Plus className="w-4 h-4" /> Configurar Monitoramento
                            </Button>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {filteredWatchlists.map((item) => (
                                <div key={item.id} className="px-4 py-3 flex items-center justify-between gap-4">
                                    <div className="space-y-1 min-w-0">
                                        <p className="text-sm font-semibold text-slate-800">{item.name}</p>
                                        <p className="text-xs text-slate-500 line-clamp-1">{item.query}</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Badge className={item.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}>
                                            {item.active ? "Ativa" : "Pausada"}
                                        </Badge>
                                        <Button size="sm" variant="outline" onClick={() => void handleToggle(item)}>
                                            {item.active ? "Pausar" : "Ativar"}
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <Dialog open={newOpen} onOpenChange={setNewOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Nova Vigília de Mercado</DialogTitle>
                        <DialogDescription>
                            Defina os critérios para rastrear concorrentes, classes e tendências de depósitos.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="grid gap-2">
                            <Label htmlFor="watchlist-name">Nome</Label>
                            <Input id="watchlist-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex: Concorrentes em bioplásticos" />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="watchlist-query">Query</Label>
                            <Input id="watchlist-query" value={newQuery} onChange={(e) => setNewQuery(e.target.value)} placeholder="titular:Empresa X OR ipc:C08L" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setNewOpen(false)}>Cancelar</Button>
                        <Button onClick={handleCreate} disabled={creating || !newName.trim() || !newQuery.trim()} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                            {creating ? "Criando..." : "Criar Vigília"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
