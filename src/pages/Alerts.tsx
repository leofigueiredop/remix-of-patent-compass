import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Bell, Search, Filter, AlertCircle, ShieldAlert, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import axios from "axios";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/+$/, "");

type AlertRow = {
    id: string;
    patent_number: string;
    rpi_number: string;
    rpi_date: string;
    despacho_code: string | null;
    title: string | null;
    complement: string | null;
    severity: string;
    deadline: string | null;
    is_read: boolean;
    updated_at: string;
};

export default function Alerts() {
    const [rows, setRows] = useState<AlertRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [severityFilter, setSeverityFilter] = useState<"all" | "critical" | "high" | "medium" | "low">("all");
    const [markingId, setMarkingId] = useState<string | null>(null);

    const loadAlerts = async () => {
        setLoading(true);
        try {
            const { data } = await axios.get(`${API_URL}/monitoring/alerts`, { params: { pageSize: 200 } });
            setRows(Array.isArray(data?.rows) ? data.rows : []);
        } catch {
            toast.error("Não foi possível carregar os alertas.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadAlerts();
    }, []);

    const filteredRows = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return rows.filter((row) => {
            const matchesText = !needle || (
                (row.patent_number || "").toLowerCase().includes(needle) ||
                (row.title || "").toLowerCase().includes(needle) ||
                (row.complement || "").toLowerCase().includes(needle) ||
                (row.despacho_code || "").toLowerCase().includes(needle)
            );
            const matchesUnread = !unreadOnly || !row.is_read;
            const matchesSeverity = severityFilter === "all" || String(row.severity || "").toLowerCase() === severityFilter;
            return matchesText && matchesUnread && matchesSeverity;
        });
    }, [rows, query, unreadOnly, severityFilter]);

    const kpis = useMemo(() => {
        const unread = rows.filter((row) => !row.is_read).length;
        const critical = rows.filter((row) => !row.is_read && (row.severity === "critical" || row.severity === "high")).length;
        const mine = rows.filter((row) => !row.is_read && (row.despacho_code === "6.1" || row.despacho_code === "7.1")).length;
        const solvedToday = rows.filter((row) => row.is_read && new Date(row.updated_at).toDateString() === new Date().toDateString()).length;
        return { unread, critical, mine, solvedToday };
    }, [rows]);

    const markAsRead = async (id: string) => {
        setMarkingId(id);
        try {
            await axios.post(`${API_URL}/monitoring/alerts/${id}/read`);
            setRows((prev) => prev.map((row) => (row.id === id ? { ...row, is_read: true } : row)));
        } catch {
            toast.error("Não foi possível marcar o alerta como lido.");
        } finally {
            setMarkingId(null);
        }
    };

    return (
        <AppLayout>
            <div className="flex flex-col gap-6 w-full mx-auto">
                <div className="flex justify-between items-end">
                    <div className="animate-in fade-in slide-in-from-left duration-700">
                        <h1 className="text-2xl font-bold flex items-center gap-3 text-slate-900 mb-2">
                            <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center">
                                <Bell className="w-5 h-5 text-rose-600" />
                            </div>
                            Central de Alertas
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            Notificações operacionais, eventos críticos e falhas de sistema.
                        </p>
                    </div>
                </div>

                {/* KPIs */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-start justify-between">
                        <div>
                            <p className="text-xs font-medium text-slate-500 mb-1">Não Lidos</p>
                            <h3 className="text-2xl font-bold text-slate-900">{kpis.unread}</h3>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                            <Bell className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-start justify-between">
                        <div>
                            <p className="text-xs font-medium text-slate-500 mb-1">Críticos</p>
                            <h3 className="text-2xl font-bold text-slate-900">{kpis.critical}</h3>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-rose-50 flex items-center justify-center text-rose-600">
                            <ShieldAlert className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-start justify-between">
                        <div>
                            <p className="text-xs font-medium text-slate-500 mb-1">Meus Alertas</p>
                            <h3 className="text-2xl font-bold text-slate-900">{kpis.mine}</h3>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center text-amber-600">
                            <AlertCircle className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-start justify-between">
                        <div>
                            <p className="text-xs font-medium text-slate-500 mb-1">Resolvidos Hoje</p>
                            <h3 className="text-2xl font-bold text-slate-900">{kpis.solvedToday}</h3>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
                            <CheckCircle2 className="w-4 h-4" />
                        </div>
                    </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input className="pl-9 bg-slate-50 border-slate-200" placeholder="Buscar alertas..." value={query} onChange={(e) => setQuery(e.target.value)} />
                    </div>
                    <select
                        value={severityFilter}
                        onChange={(e) => setSeverityFilter(e.target.value as "all" | "critical" | "high" | "medium" | "low")}
                        className="h-10 rounded-md border border-slate-200 px-3 text-sm bg-white text-slate-700"
                    >
                        <option value="all">Todas severidades</option>
                        <option value="critical">Crítica</option>
                        <option value="high">Alta</option>
                        <option value="medium">Média</option>
                        <option value="low">Baixa</option>
                    </select>
                    <label className="flex items-center gap-2 text-sm text-slate-600 px-2">
                        <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
                        Só não lidos
                    </label>
                    <Button variant="outline" className="gap-2 bg-white text-slate-600 shrink-0" onClick={() => void loadAlerts()} disabled={loading}>
                        <Filter className="w-4 h-4" /> Filtros
                    </Button>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden min-h-[300px]">
                    {loading ? (
                        <div className="p-8 text-center text-sm text-slate-500">Carregando alertas...</div>
                    ) : filteredRows.length === 0 ? (
                        <div className="min-h-[300px] flex flex-col items-center justify-center text-center p-8">
                            <Bell className="w-12 h-12 text-slate-300 mb-4" />
                            <h3 className="text-lg font-bold text-slate-800">Tudo limpo por aqui</h3>
                            <p className="text-sm text-slate-500 mt-2 max-w-md">
                                Nenhum alerta crítico ou operacional pendente no momento.
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {filteredRows.map((row) => (
                                <div key={row.id} className="px-4 py-3 flex items-start justify-between gap-4">
                                    <div className="space-y-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <Badge variant="outline" className="font-mono text-[10px]">{row.patent_number}</Badge>
                                            {row.despacho_code && <Badge variant="outline" className="text-[10px]">{row.despacho_code}</Badge>}
                                            <Badge className={row.is_read ? "bg-slate-100 text-slate-600" : "bg-rose-100 text-rose-700"}>
                                                {row.is_read ? "Lido" : "Pendente"}
                                            </Badge>
                                        </div>
                                        <p className="text-sm font-semibold text-slate-800">{row.title || "Evento sem título"}</p>
                                        {row.complement && <p className="text-xs text-slate-500 line-clamp-2">{row.complement}</p>}
                                        <p className="text-[11px] text-slate-400">RPI {row.rpi_number} • {new Date(row.rpi_date).toLocaleDateString("pt-BR")}</p>
                                    </div>
                                    {!row.is_read && (
                                        <Button size="sm" variant="outline" disabled={markingId === row.id} onClick={() => void markAsRead(row.id)}>
                                            Marcar como lido
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </AppLayout>
    );
}
