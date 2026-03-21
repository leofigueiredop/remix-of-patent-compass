import { useCallback, useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Workflow, Search, Filter, AlertCircle, Clock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import axios from "axios";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/+$/, "");

type Overview = {
    kpis: {
        openExigencies: number;
        deadlines7d: number;
        newDispatches7d: number;
        regularProcesses: number;
    };
};

type ProcessEvent = {
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
};

export default function ProcessMonitoring() {
    const [query, setQuery] = useState("");
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [deadlineOnly, setDeadlineOnly] = useState(false);
    const [severityFilter, setSeverityFilter] = useState<"all" | "critical" | "high" | "medium" | "low">("all");
    const [loading, setLoading] = useState(true);
    const [overview, setOverview] = useState<Overview["kpis"]>({
        openExigencies: 0,
        deadlines7d: 0,
        newDispatches7d: 0,
        regularProcesses: 0
    });
    const [events, setEvents] = useState<ProcessEvent[]>([]);
    const filteredEvents = events.filter((event) => {
        const matchesUnread = !unreadOnly || !event.is_read;
        const matchesDeadline = !deadlineOnly || Boolean(event.deadline);
        const matchesSeverity = severityFilter === "all" || String(event.severity || "").toLowerCase() === severityFilter;
        return matchesUnread && matchesDeadline && matchesSeverity;
    });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [overviewRes, eventsRes] = await Promise.all([
                axios.get(`${API_URL}/monitoring/process/overview`),
                axios.get(`${API_URL}/monitoring/process/events`, { params: { q: query || undefined } })
            ]);
            setOverview(overviewRes.data?.kpis || {
                openExigencies: 0,
                deadlines7d: 0,
                newDispatches7d: 0,
                regularProcesses: 0
            });
            setEvents(Array.isArray(eventsRes.data?.rows) ? eventsRes.data.rows : []);
        } catch {
            toast.error("Falha ao carregar monitoramento de processo.");
        } finally {
            setLoading(false);
        }
    }, [query]);

    useEffect(() => {
        const timer = setTimeout(() => {
            void load();
        }, 250);
        return () => clearTimeout(timer);
    }, [load]);

    return (
        <AppLayout>
            <div className="flex flex-col gap-6 w-full mx-auto">
                <div className="flex justify-between items-end">
                    <div className="animate-in fade-in slide-in-from-left duration-700">
                        <h1 className="text-2xl font-bold flex items-center gap-3 text-slate-900 mb-2">
                            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center">
                                <Workflow className="w-5 h-5 text-blue-600" />
                            </div>
                            Monitoramento de Processo
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            Acompanhe exigências, anuidades, despachos e ciclo de vida de patentes.
                        </p>
                    </div>
                </div>

                {/* KPIs */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-start justify-between">
                        <div>
                            <p className="text-xs font-medium text-slate-500 mb-1">Exigências Abertas</p>
                            <h3 className="text-2xl font-bold text-slate-900">{overview.openExigencies}</h3>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center text-amber-600">
                            <AlertCircle className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-start justify-between">
                        <div>
                            <p className="text-xs font-medium text-slate-500 mb-1">Prazos em 7 dias</p>
                            <h3 className="text-2xl font-bold text-slate-900">{overview.deadlines7d}</h3>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center text-red-600">
                            <Clock className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-start justify-between">
                        <div>
                            <p className="text-xs font-medium text-slate-500 mb-1">Novos Despachos</p>
                            <h3 className="text-2xl font-bold text-slate-900">{overview.newDispatches7d}</h3>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                            <Workflow className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-start justify-between">
                        <div>
                            <p className="text-xs font-medium text-slate-500 mb-1">Processos Regulares</p>
                            <h3 className="text-2xl font-bold text-slate-900">{overview.regularProcesses}</h3>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
                            <CheckCircle2 className="w-4 h-4" />
                        </div>
                    </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input className="pl-9 bg-slate-50 border-slate-200" placeholder="Buscar processo, cliente ou código..." value={query} onChange={(e) => setQuery(e.target.value)} />
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
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                        <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
                        Não lidos
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                        <input type="checkbox" checked={deadlineOnly} onChange={(e) => setDeadlineOnly(e.target.checked)} />
                        Com prazo
                    </label>
                    <Button variant="outline" className="gap-2 bg-white text-slate-600" onClick={() => void load()} disabled={loading}>
                        <Filter className="w-4 h-4" /> Filtros
                    </Button>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden min-h-[300px]">
                    {loading ? (
                        <div className="p-8 text-sm text-slate-500 text-center">Carregando eventos...</div>
                    ) : filteredEvents.length === 0 ? (
                        <div className="min-h-[300px] flex flex-col items-center justify-center text-center p-8">
                            <Workflow className="w-12 h-12 text-slate-300 mb-4" />
                            <h3 className="text-lg font-bold text-slate-800">Nenhum evento de processo detectado</h3>
                            <p className="text-sm text-slate-500 mt-2 max-w-md">
                                Esta área será preenchida com os andamentos, anuidades e despachos associados aos ativos monitorados.
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {filteredEvents.map((event) => (
                                <div key={event.id} className="px-4 py-3 flex items-start justify-between gap-4">
                                    <div className="space-y-1 min-w-0">
                                        <div className="flex flex-wrap gap-2 items-center">
                                            <Badge variant="outline" className="font-mono text-[10px]">{event.patent_number}</Badge>
                                            {event.despacho_code && <Badge variant="outline" className="text-[10px]">{event.despacho_code}</Badge>}
                                            {!event.is_read && <Badge className="bg-amber-100 text-amber-700">Novo</Badge>}
                                        </div>
                                        <p className="text-sm font-semibold text-slate-800">{event.title || "Sem título"}</p>
                                        {event.complement && <p className="text-xs text-slate-500 line-clamp-2">{event.complement}</p>}
                                    </div>
                                    <div className="text-right text-xs text-slate-500">
                                        <p>RPI {event.rpi_number}</p>
                                        <p>{new Date(event.rpi_date).toLocaleDateString("pt-BR")}</p>
                                        {event.deadline && <p className="text-rose-600">Prazo: {new Date(event.deadline).toLocaleDateString("pt-BR")}</p>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </AppLayout>
    );
}
