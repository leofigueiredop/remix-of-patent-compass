import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, FileText, Calendar, ChevronRight, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import AppLayout from "@/components/AppLayout";
import { aiService } from "@/services/ai";

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

  useEffect(() => {
    aiService.checkHealth().then(setAiOnline);
  }, []);

  const totalPesquisas = researches.length;
  const emAnalise = researches.filter(r => r.status === "analyzed").length;
  const finalizadas = researches.filter(r => r.status === "finalized").length;

  return (
    <AppLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Pesquisas de Patentes</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gerencie suas pesquisas e análises
          </p>
        </div>
        <Button onClick={() => navigate("/research/new")} className="gap-2">
          <Plus className="w-4 h-4" />
          Nova Pesquisa
        </Button>
      </div>

      {/* Stats & AI Health */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Total de Pesquisas", value: String(totalPesquisas), icon: FileText, color: "text-blue-500" },
          { label: "Em Análise", value: String(emAnalise), icon: Calendar, color: "text-amber-500" },
          { label: "Finalizadas", value: String(finalizadas), icon: FileText, color: "text-green-500" },
        ].map((stat) => (
          <div key={stat.label} className="bg-card rounded-lg border p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg bg-muted flex items-center justify-center ${stat.color}`}>
                <stat.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}

        {/* AI Infrastructure Health Card */}
        <div className="bg-slate-950 text-white rounded-lg border border-slate-800 p-4 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-2 opacity-50"><ShieldCheck className="w-12 h-12 text-slate-800" /></div>
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              {aiOnline === null ? (
                <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
              ) : (
                <div className={`w-2 h-2 rounded-full ${aiOnline ? "bg-green-500 animate-pulse" : "bg-red-500"}`}></div>
              )}
              <span className={`text-xs font-mono uppercase tracking-widest ${aiOnline === false ? "text-red-400" : "text-green-400"}`}>
                {aiOnline === null ? "Verificando..." : aiOnline ? "System Operational" : "Offline"}
              </span>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Backend API</span>
                <span>{aiOnline ? "Online" : "—"}</span>
              </div>
              <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                <div className={`h-full ${aiOnline ? "bg-green-500 w-full" : "bg-red-500 w-0"} transition-all`}></div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-400">
              <ShieldCheck className="w-3 h-3 text-green-500" />
              <span>Local Encryption: <strong className="text-white">Active (AES-256)</strong></span>
            </div>
          </div>
        </div>
      </div>

      {/* Research list */}
      <div className="bg-card rounded-lg border">
        <div className="px-5 py-3 border-b">
          <h2 className="text-sm font-semibold">Pesquisas Recentes</h2>
        </div>
        <div className="divide-y">
          {researches.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <FileText className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm">Nenhuma pesquisa realizada ainda.</p>
              <p className="text-xs mt-1">Clique em "Nova Pesquisa" para começar.</p>
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
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/50 transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{research.title}</p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(research.date).toLocaleDateString("pt-BR")}
                    </span>
                    <span className={`status-badge ${statusClasses[research.status]}`}>
                      {statusLabels[research.status]}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 ml-4" />
              </button>
            ))
          )}
        </div>
      </div>
    </AppLayout>
  );
}
