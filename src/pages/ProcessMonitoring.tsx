import { useCallback, useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Workflow, Search, Filter, AlertCircle, Clock, CheckCircle2, FilterX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import axios from "axios";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import OperationalPageHeader from "@/components/operations/OperationalPageHeader";
import OperationalKpiCard from "@/components/operations/OperationalKpiCard";

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
                <OperationalPageHeader
                    title="Monitoramento de Processo"
                    description="Acompanhe exigências, anuidades, despachos e ciclo de vida de patentes."
                    icon={<Workflow className="w-5 h-5 text-slate-600" />}
                />

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <OperationalKpiCard label="Exigências Abertas" value={overview.openExigencies} icon={<AlertCircle className="w-4 h-4" />} tone="warning" />
                    <OperationalKpiCard label="Prazos em 7 dias" value={overview.deadlines7d} icon={<Clock className="w-4 h-4" />} tone="critical" />
                    <OperationalKpiCard label="Novos Despachos" value={overview.newDispatches7d} icon={<Workflow className="w-4 h-4" />} tone="info" />
                    <OperationalKpiCard label="Processos Regulares" value={overview.regularProcesses} icon={<CheckCircle2 className="w-4 h-4" />} tone="success" />
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
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
                    <Button variant="outline" className="gap-2 h-10 text-sm bg-white text-slate-600 w-full sm:w-auto" onClick={() => void load()} disabled={loading}>
                        <Filter className="w-4 h-4" /> Filtros
                    </Button>
                    <Button
                        variant="outline"
                        className="gap-2 h-10 text-sm bg-white text-slate-600 w-full sm:w-auto"
                        onClick={() => {
                            setQuery("");
                            setUnreadOnly(false);
                            setDeadlineOnly(false);
                            setSeverityFilter("all");
                            void load();
                        }}
                    >
                        <FilterX className="w-4 h-4" /> Limpar
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
