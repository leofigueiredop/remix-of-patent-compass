import { useNavigate } from "react-router-dom";
import { Plus, FileText, Calendar, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import AppLayout from "@/components/AppLayout";
import { mockResearches } from "@/data/mockData";

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

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Total de Pesquisas", value: "4", icon: FileText },
          { label: "Em Análise", value: "1", icon: Calendar },
          { label: "Finalizadas", value: "2", icon: FileText },
        ].map((stat) => (
          <div key={stat.label} className="bg-card rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                <stat.icon className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Research list */}
      <div className="bg-card rounded-lg border">
        <div className="px-5 py-3 border-b">
          <h2 className="text-sm font-semibold">Pesquisas Recentes</h2>
        </div>
        <div className="divide-y">
          {mockResearches.map((research) => (
            <button
              key={research.id}
              onClick={() => navigate("/research/briefing")}
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
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
