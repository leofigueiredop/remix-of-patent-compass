import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, FileText, Calendar, ChevronRight, ShieldCheck, Loader2, Workflow, BookOpen, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import AppLayout from "@/components/AppLayout";
import OperationalPageHeader from "@/components/operations/OperationalPageHeader";
import { aiService } from "@/services/ai";
import { api } from "@/services/auth";
import { useResearch } from "@/contexts/ResearchContext";

interface Research {
  id: string;
  title: string;
  date: string;
  status: "editing" | "analyzed" | "finalized";
}

const statusLabels: Record<string, string> = {
  editing: "Em edição",
  analyzed: "Analisada",
  finalized: "Finalizada",
};

const statusClasses: Record<string, string> = {
  editing: "status-editing",
  analyzed: "status-analyzed",
  finalized: "status-finalized",
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { getJourneyMetrics } = useResearch();
  const [researches] = useState<Research[]>([]);
  const [aiOnline, setAiOnline] = useState<boolean | null>(null);
  const [monitoredCount, setMonitoredCount] = useState<number | null>(null);
  const [collisionsCount, setCollisionsCount] = useState<number | null>(null);
  const [urgentCollisionsCount, setUrgentCollisionsCount] = useState<number>(0);
  const [demandCount, setDemandCount] = useState<number | null>(null);
  const [journeyCompletion, setJourneyCompletion] = useState<number>(0);

  useEffect(() => {
    aiService.checkHealth().then(setAiOnline);

    Promise.all([
      api.get(`/system-health`),
      api.get(`/monitoring/center/dashboard`),
      api.get(`/demands`, { params: { page: 1, pageSize: 1 } })
    ])
      .then(([healthRes, centerRes, demandsRes]) => {
        setMonitoredCount(Number(healthRes.data?.metrics?.monitoredPatents ?? 0));
        const occurrences = centerRes.data?.occurrences || {};
        const critical = Number(occurrences.critical ?? 0);
        const pending = Number(occurrences.pendingTriage ?? 0);
        setCollisionsCount(critical + pending);
        setUrgentCollisionsCount(critical);
        setDemandCount(Number(demandsRes.data?.total ?? 0));
      })
      .catch((error) => {
        console.error("Erro ao carregar métricas do dashboard:", error);
      });

    const metrics = getJourneyMetrics();
    const stepKeys = [
      "step_0_new_research",
      "step_1_transcription",
      "step_2_structured_briefing",
      "step_3_keywords",
      "step_4_results",
      "step_5_analysis",
      "step_6_report",
    ];
    const completionValues = stepKeys.map((key) => {
      const item = metrics[key];
      if (!item || item.views === 0) return 0;
      return Math.min(1, item.completes / item.views);
    });
    const avg = completionValues.length > 0
      ? completionValues.reduce((sum, value) => sum + value, 0) / completionValues.length
      : 0;
    setJourneyCompletion(Math.round(avg * 100));
  }, [getJourneyMetrics]);

  const emAnalise = researches.filter(r => r.status === "analyzed").length;
  const finalizadas = researches.filter(r => r.status === "finalized").length;

  return (
    <AppLayout>
      <div className="flex flex-col gap-8">
        
        <OperationalPageHeader
          title="Dashboard Central"
          description="Visão geral da operação, pesquisas, monitoramentos e demandas."
          icon={<ShieldCheck className="w-5 h-5 text-slate-600" />}
          actions={
            <>
              <Button variant="outline" onClick={() => navigate("/search")} className="gap-2">
                <Search className="w-4 h-4" />
                Busca Rápida
              </Button>
              <Button onClick={() => navigate("/research/new")} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
                <Plus className="w-4 h-4" />
                Nova Pesquisa
              </Button>
            </>
          }
        />

        {/* Top KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Patentes Monitoradas</p>
                <h3 className="text-2xl font-bold text-slate-900 mt-1">
                  {monitoredCount === null ? (
                    <Loader2 className="w-5 h-5 animate-spin text-slate-300 mt-1" />
                  ) : (
                    monitoredCount
                  )}
                </h3>
              </div>
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
                <ShieldCheck className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4 flex items-center text-xs text-emerald-600 font-medium">
              <span className="flex h-2 w-2 rounded-full bg-emerald-500 mr-2"></span>
              Conectado à base local
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Alertas de Colisão</p>
                <h3 className="text-2xl font-bold text-slate-900 mt-1">
                  {collisionsCount === null ? <Loader2 className="w-5 h-5 animate-spin text-slate-300 mt-1" /> : collisionsCount}
                </h3>
              </div>
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
                <AlertCircle className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4 flex items-center text-xs text-amber-600 font-medium">
              {urgentCollisionsCount} críticos requerem análise urgente
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Demandas no CRM</p>
                <h3 className="text-2xl font-bold text-slate-900 mt-1">
                  {demandCount === null ? <Loader2 className="w-5 h-5 animate-spin text-slate-300 mt-1" /> : demandCount}
                </h3>
              </div>
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                <FileText className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4 flex items-center text-xs text-slate-500 font-medium">
              {finalizadas} concluídas • {emAnalise} em análise
            </div>
          </div>

          {/* System Health */}
          <div className="bg-slate-900 text-white rounded-xl border border-slate-800 p-5 shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-3 opacity-20"><Workflow className="w-16 h-16 text-slate-500" /></div>
            <div className="relative z-10">
              <p className="text-sm font-medium text-slate-400">Saúde do Sistema</p>
              <div className="flex items-center gap-2 mt-2 mb-3">
                {aiOnline === null ? (
                  <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                ) : (
                  <div className={`w-3 h-3 rounded-full ${aiOnline ? "bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]" : "bg-red-500"}`}></div>
                )}
                <span className={`text-sm font-mono tracking-wide ${aiOnline === false ? "text-red-400" : "text-emerald-400"}`}>
                  {aiOnline === null ? "Verificando..." : aiOnline ? "OPERACIONAL" : "FALHA NA API"}
                </span>
              </div>
              <div className="mt-4 flex items-center gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1.5"><BookOpen className="w-3.5 h-3.5" /> Base INPI</span>
                <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Workers</span>
              </div>
            </div>
          </div>
        </div>

        {/* Two Columns Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Main Content - Recent Activity */}
          <div className="lg:col-span-2 space-y-6">
            
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-800">Pesquisas Recentes</h2>
                <Button variant="ghost" size="sm" className="text-xs text-emerald-600 hover:text-emerald-700" onClick={() => navigate("/research/history")}>
                  Ver todas
                </Button>
              </div>
              <div className="divide-y divide-slate-100">
                {researches.length === 0 ? (
                  <div className="text-center py-12 px-4 text-slate-500">
                    <FileText className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                    <p className="text-sm font-medium text-slate-600">Nenhuma pesquisa realizada</p>
                    <p className="text-xs mt-1 max-w-sm mx-auto">Comece sua primeira pesquisa de patenteabilidade utilizando a inteligência da plataforma.</p>
                    <Button onClick={() => navigate("/research/new")} variant="outline" className="mt-4 text-xs">
                      Criar Pesquisa
                    </Button>
                  </div>
                ) : (
                  researches.map((research) => (
                    <button
                      key={research.id}
                      onClick={() => {
                        if (research.status === 'finalized') navigate("/research/report");
                        else if (research.status === 'analyzed') navigate("/research/analysis");
                        else navigate("/research/briefing");
                      }}
                      className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{research.title}</p>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-xs text-slate-500 flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5" />
                            {new Date(research.date).toLocaleDateString("pt-BR")}
                          </span>
                          <span className={`status-badge ${statusClasses[research.status]} text-[10px] px-2 py-0.5 rounded-full`}>
                            {statusLabels[research.status]}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 ml-4" />
                    </button>
                  ))
                )}
              </div>
            </div>

          </div>

          {/* Sidebar - Quick Actions & Alerts */}
          <div className="space-y-6">
            
            {/* Quick Access */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <h2 className="text-sm font-bold text-slate-800 mb-4">Acesso Rápido</h2>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => navigate("/monitoring/collision")} className="flex flex-col items-center justify-center gap-2 p-3 rounded-lg border border-slate-100 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-200 transition-colors text-slate-700 hover:text-emerald-700">
                  <ShieldCheck className="w-5 h-5" />
                  <span className="text-xs font-medium text-center">Colidência</span>
                </button>
                <button onClick={() => navigate("/base/patents")} className="flex flex-col items-center justify-center gap-2 p-3 rounded-lg border border-slate-100 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-200 transition-colors text-slate-700 hover:text-emerald-700">
                  <BookOpen className="w-5 h-5" />
                  <span className="text-xs font-medium text-center">Base Local</span>
                </button>
                <button onClick={() => navigate("/clients")} className="flex flex-col items-center justify-center gap-2 p-3 rounded-lg border border-slate-100 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-200 transition-colors text-slate-700 hover:text-emerald-700">
                  <FileText className="w-5 h-5" />
                  <span className="text-xs font-medium text-center">Clientes</span>
                </button>
                <button onClick={() => navigate("/operations/workers")} className="flex flex-col items-center justify-center gap-2 p-3 rounded-lg border border-slate-100 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-200 transition-colors text-slate-700 hover:text-emerald-700">
                  <Workflow className="w-5 h-5" />
                  <span className="text-xs font-medium text-center">Workers</span>
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <h2 className="text-sm font-bold text-slate-800 mb-3">Jornada de Pesquisa</h2>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500">Conclusão média do funil</span>
                <span className="text-sm font-semibold text-slate-900">{journeyCompletion}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${journeyCompletion}%` }} />
              </div>
              <Button variant="outline" className="w-full mt-4 text-xs" onClick={() => navigate("/research/new")}>
                Iniciar nova pesquisa
              </Button>
            </div>

            {/* Recent Alerts (Placeholder for real data) */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-slate-800">Próximos Prazos</h2>
                <span className="text-[10px] font-medium bg-slate-100 text-slate-600 px-2 py-1 rounded-full">Exemplo</span>
              </div>
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-amber-50/50 border border-amber-100/50">
                    <div className="mt-0.5 w-2 h-2 rounded-full bg-amber-500 shrink-0"></div>
                    <div>
                      <p className="text-xs font-semibold text-slate-800">Pagamento de Anuidade (3º Ano)</p>
                      <p className="text-[11px] text-slate-600 mt-0.5">BR 10 2020 012345-6 • TechCorp S.A.</p>
                      <p className="text-[10px] text-amber-700 font-medium mt-1.5">Vence em 5 dias</p>
                    </div>
                  </div>
                ))}
              </div>
              <Button variant="ghost" className="w-full mt-4 text-xs text-slate-500" onClick={() => navigate("/monitoring/process")}>
                Ver calendário completo
              </Button>
            </div>

          </div>
        </div>

      </div>
    </AppLayout>
  );
}
