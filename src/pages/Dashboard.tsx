import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, FileText, Calendar, ChevronRight, ShieldCheck, Loader2, Workflow, BookOpen, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import AppLayout from "@/components/AppLayout";
import { aiService } from "@/services/ai";
import axios from "axios";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/+$/, "");

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
  const [researches] = useState<Research[]>([]);
  const [aiOnline, setAiOnline] = useState<boolean | null>(null);
  const [monitoredCount, setMonitoredCount] = useState<number | null>(null);
  const [collisionsCount, setCollisionsCount] = useState<number>(12); // Exemplo fixo por enquanto

  useEffect(() => {
    aiService.checkHealth().then(setAiOnline);
    
    // Buscar contagem real de patentes monitoradas
    axios.get(`${API_URL}/monitoring/patents?page=1&pageSize=1`)
      .then(res => {
        if (res.data && typeof res.data.total === 'number') {
          setMonitoredCount(res.data.total);
        } else if (res.data && res.data.rows) {
            // Fallback se a API não retornar total direto
            setMonitoredCount(res.data.total || 0);
        }
      })
      .catch(err => console.error("Erro ao buscar total de monitoradas:", err));
  }, []);

  const totalPesquisas = researches.length;
  const emAnalise = researches.filter(r => r.status === "analyzed").length;
  const finalizadas = researches.filter(r => r.status === "finalized").length;

  return (
    <AppLayout>
      <div className="flex flex-col gap-8">
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Dashboard Central</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Visão geral da operação, pesquisas e monitoramentos.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => navigate("/search")} className="gap-2">
              <Search className="w-4 h-4" />
              Busca Rápida
            </Button>
            <Button onClick={() => navigate("/research/new")} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-4 h-4" />
              Nova Pesquisa
            </Button>
          </div>
        </div>

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
                <h3 className="text-2xl font-bold text-slate-900 mt-1">{collisionsCount}</h3>
              </div>
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
                <AlertCircle className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4 flex items-center text-xs text-amber-600 font-medium">
              3 requerem análise urgente
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Pesquisas Ativas</p>
                <h3 className="text-2xl font-bold text-slate-900 mt-1">{totalPesquisas || 0}</h3>
              </div>
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                <FileText className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4 flex items-center text-xs text-slate-500 font-medium">
              {emAnalise} aguardando revisão
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

