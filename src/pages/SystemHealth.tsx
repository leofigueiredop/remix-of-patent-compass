import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Activity, Server, Database, Globe, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import axios from "axios";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import OperationalPageHeader from "@/components/operations/OperationalPageHeader";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/+$/, "");

type HealthData = {
    services: {
        inpiWeb: { status: "online" | "offline" | "degraded" };
        epoOps: { status: "online" | "offline" | "degraded" };
        database: { status: "online" | "offline" | "degraded" };
        groq: { status: "online" | "offline" | "degraded" };
    };
    metrics: {
        monitoredPatents: number;
        unreadAlerts: number;
    };
    syncs: Array<{
        name: string;
        status: string;
        reference: string | null;
        at: string | null;
    }>;
};

export default function SystemHealth() {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<HealthData | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const response = await axios.get(`${API_URL}/system-health`);
            setData(response.data || null);
        } catch {
            toast.error("Falha ao carregar saúde do sistema.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const statusLabel = (status?: string) => {
        if (status === "online") return { text: "Online", className: "text-emerald-600" };
        if (status === "degraded") return { text: "Degradado", className: "text-amber-600" };
        if (status === "offline") return { text: "Offline", className: "text-rose-600" };
        return { text: "Desconhecido", className: "text-slate-500" };
    };
    const serviceStatuses = [
        data?.services?.inpiWeb?.status,
        data?.services?.epoOps?.status,
        data?.services?.database?.status,
        data?.services?.groq?.status
    ];
    const criticalCount = serviceStatuses.filter((item) => item === "offline").length;
    const degradedCount = serviceStatuses.filter((item) => item === "degraded").length;
    const operationalCount = serviceStatuses.filter((item) => item === "online").length;
    const syncAttention = (data?.syncs || []).filter((sync) => sync.status !== "completed").length;

    return (
        <AppLayout>
            <div className="flex flex-col gap-6 w-full mx-auto">
                <OperationalPageHeader
                    title="Saúde do Sistema"
                    description="Visão operacional das integrações, banco de dados e sincronizações críticas."
                    icon={<Activity className="w-5 h-5 text-slate-600" />}
                    actions={
                        <Button variant="outline" className="gap-2 bg-white" onClick={() => void load()} disabled={loading}>
                            <RefreshCw className="w-4 h-4 text-slate-500" /> Atualizar
                        </Button>
                    }
                    metrics={
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                                <p className="text-xs text-rose-700">Crítico</p>
                                <p className="text-2xl font-semibold text-rose-700">{criticalCount}</p>
                            </div>
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                                <p className="text-xs text-amber-700">Atenção</p>
                                <p className="text-2xl font-semibold text-amber-700">{degradedCount}</p>
                            </div>
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                                <p className="text-xs text-emerald-700">Operacional</p>
                                <p className="text-2xl font-semibold text-emerald-700">{operationalCount}</p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <p className="text-xs text-slate-500">Sincronizações com atenção</p>
                                <p className="text-2xl font-semibold text-slate-900">{syncAttention}</p>
                            </div>
                        </div>
                    }
                />

                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                    <h3 className="text-sm font-semibold text-slate-800 mb-3">Ações necessárias agora</h3>
                    <div className="space-y-2">
                        {criticalCount === 0 && degradedCount === 0 && syncAttention === 0 ? (
                            <p className="text-xs text-emerald-700">Nenhuma ação urgente. Operação estável neste momento.</p>
                        ) : (
                            <>
                                {criticalCount > 0 && <p className="text-xs text-rose-700">Existem integrações offline. Priorize recuperação de conectividade.</p>}
                                {degradedCount > 0 && <p className="text-xs text-amber-700">Há integrações degradadas. Validar latência, autenticação e limites de API.</p>}
                                {syncAttention > 0 && <p className="text-xs text-slate-600">Sincronizações com status diferente de completed. Revisar fila e reprocessamento.</p>}
                            </>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Status INPI */}
                    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <Globe className="w-4 h-4 text-slate-400" />
                                <h3 className="font-semibold text-slate-700">INPI Web</h3>
                            </div>
                            {statusLabel(data?.services?.inpiWeb?.status).text === "Online" ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <AlertTriangle className="w-5 h-5 text-amber-500" />}
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">Status</span>
                                <span className={`font-medium ${statusLabel(data?.services?.inpiWeb?.status).className}`}>{statusLabel(data?.services?.inpiWeb?.status).text}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">Patentes Monitoradas</span>
                                <span className="font-medium text-slate-700">{data?.metrics?.monitoredPatents ?? "-"}</span>
                            </div>
                        </div>
                    </div>

                    {/* Status EPO OPS */}
                    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <Server className="w-4 h-4 text-slate-400" />
                                <h3 className="font-semibold text-slate-700">EPO OPS API</h3>
                            </div>
                            {statusLabel(data?.services?.epoOps?.status).text === "Online" ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <AlertTriangle className="w-5 h-5 text-amber-500" />}
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">Status</span>
                                <span className={`font-medium ${statusLabel(data?.services?.epoOps?.status).className}`}>{statusLabel(data?.services?.epoOps?.status).text}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">Alertas Não Lidos</span>
                                <span className="font-medium text-slate-700">{data?.metrics?.unreadAlerts ?? "-"}</span>
                            </div>
                        </div>
                    </div>

                    {/* Status Banco de Dados */}
                    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <Database className="w-4 h-4 text-slate-400" />
                                <h3 className="font-semibold text-slate-700">PostgreSQL</h3>
                            </div>
                            {statusLabel(data?.services?.database?.status).text === "Online" ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <AlertTriangle className="w-5 h-5 text-amber-500" />}
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">Status</span>
                                <span className={`font-medium ${statusLabel(data?.services?.database?.status).className}`}>{statusLabel(data?.services?.database?.status).text}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">Leitura</span>
                                <span className="font-medium text-slate-700">{loading ? "Atualizando..." : "OK"}</span>
                            </div>
                        </div>
                    </div>

                    {/* Status Groq AI */}
                    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <Activity className="w-4 h-4 text-slate-400" />
                                <h3 className="font-semibold text-slate-700">Groq AI Cloud</h3>
                            </div>
                            {statusLabel(data?.services?.groq?.status).text === "Online" ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <AlertTriangle className="w-5 h-5 text-amber-500" />}
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">Status</span>
                                <span className={`font-medium ${statusLabel(data?.services?.groq?.status).className}`}>{statusLabel(data?.services?.groq?.status).text}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">Integração</span>
                                <span className="font-medium text-slate-700">IA</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mt-4">
                    <h3 className="text-lg font-bold text-slate-800 mb-4">Últimas Sincronizações</h3>
                    {data?.syncs?.length ? (
                        <div className="space-y-4">
                            {data.syncs.map((sync) => (
                                <div key={sync.name} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-2 h-2 rounded-full ${sync.status === "completed" ? "bg-emerald-500" : sync.status === "failed" ? "bg-rose-500" : "bg-amber-500"}`}></div>
                                        <div>
                                            <p className="text-sm font-semibold text-slate-700">{sync.name}</p>
                                            <p className="text-xs text-slate-500">
                                                {sync.at ? `Última execução: ${new Date(sync.at).toLocaleString("pt-BR")}` : "Sem histórico"}
                                                {sync.reference ? ` • ${sync.reference}` : ""}
                                            </p>
                                        </div>
                                    </div>
                                    <Badge className={sync.status === "completed" ? "bg-emerald-100 text-emerald-700" : sync.status === "failed" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}>
                                        {sync.status}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-slate-500">Nenhuma sincronização registrada.</p>
                    )}
                </div>
            </div>
        </AppLayout>
    );
}
