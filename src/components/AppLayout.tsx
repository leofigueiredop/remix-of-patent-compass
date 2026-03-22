import { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  BookOpen,
  ChevronDown,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Search,
  SearchCheck,
  Settings,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { authService } from "@/services/auth";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type NavItem = {
  label: string;
  icon: React.ElementType;
  path: string;
  description: string;
};

const dashboardItems: NavItem[] = [
  {
    label: "Dashboard Central",
    icon: LayoutDashboard,
    path: "/dashboard",
    description: "Visão gerencial da inteligência",
  }
];

const researchItems: NavItem[] = [
  {
    label: "Nova Pesquisa",
    icon: Search,
    path: "/research/new",
    description: "Fluxo assistido de patenteabilidade",
  },
  {
    label: "Pesquisas Salvas",
    icon: FileText,
    path: "/research/history",
    description: "Resultados e versões anteriores",
  }
];

const monitoringItems: NavItem[] = [
  {
    label: "Hub Operacional",
    icon: LayoutDashboard,
    path: "/monitoring/dashboard",
    description: "Triagem, score, IA e fila operacional",
  },
  {
    label: "Colidência",
    icon: ShieldCheck,
    path: "/monitoring/collision",
    description: "Conflitos entre ativos monitorados e RPI",
  },
  {
    label: "Processo",
    icon: Workflow,
    path: "/monitoring/process",
    description: "Acompanhamento de exigências e anuidades",
  },
  {
    label: "Mercado",
    icon: SearchCheck,
    path: "/monitoring/market",
    description: "Tendências por titular e tecnologias",
  },
  {
    label: "Meus Ativos",
    icon: FileText,
    path: "/monitoring/assets",
    description: "Patentes monitoradas do portfólio",
  }
];

const baseItems: NavItem[] = [
  {
    label: "Base Local",
    icon: BookOpen,
    path: "/base/patents",
    description: "Patentes extraídas e consolidadas",
  },
  {
    label: "Busca Rápida",
    icon: Search,
    path: "/search",
    description: "Consulta direta por número e termo",
  }
];

const crmItems: NavItem[] = [
  {
    label: "Clientes",
    icon: FileText,
    path: "/clients",
    description: "Gestão do portfólio de clientes",
  },
  {
    label: "Demandas",
    icon: Workflow,
    path: "/demands",
    description: "Pipeline de tarefas e orçamentos",
  }
];

const opsItems: NavItem[] = [
  {
    label: "Alertas",
    icon: Bell,
    path: "/alerts",
    description: "Central unificada de notificações",
  },
  {
    label: "Background Workers",
    icon: Settings,
    path: "/operations/workers",
    description: "Filas, reprocessos e ingestão",
  },
  {
    label: "Saúde do Sistema",
    icon: ShieldCheck,
    path: "/operations/system-health",
    description: "Monitoramento de integrações",
  }
];

const mobileNavGroups: Array<{ label: string; items: NavItem[] }> = [
  { label: "Dashboard", items: dashboardItems },
  { label: "Pesquisas", items: researchItems },
  { label: "Monitoramentos", items: monitoringItems },
  { label: "Base", items: baseItems },
  { label: "CRM", items: crmItems },
  { label: "Operações", items: opsItems },
];

function isPathActive(currentPath: string, itemPath: string) {
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
}

function navButtonClass(active: boolean) {
  return active
    ? "text-emerald-950 bg-emerald-100/90 border-emerald-300"
    : "text-slate-700 hover:text-emerald-950 hover:bg-white/80 border-transparent";
}

function DropdownNav({
  label,
  items,
  currentPath,
  onNavigate,
}: {
  label: string;
  items: NavItem[];
  currentPath: string;
  onNavigate: (path: string) => void;
}) {
  const active = items.some((item) => isPathActive(currentPath, item.path));
  return (
    <div className="group relative">
      <button className={`flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${navButtonClass(active)}`}>
        {label}
        <ChevronDown className="h-4 w-4" />
      </button>
      <div className="pointer-events-none invisible absolute left-0 top-full w-96 pt-2 opacity-0 transition-all group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100">
        <div className="rounded-xl border border-emerald-100 bg-white/95 p-2 shadow-xl backdrop-blur-sm">
          {items.map((item) => (
            <button
              key={item.path}
              onClick={() => onNavigate(item.path)}
              className={`flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors ${isPathActive(currentPath, item.path) ? "bg-emerald-100/80 text-emerald-900" : "hover:bg-emerald-50/70 text-slate-700"}`}
            >
              <item.icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="block text-sm font-semibold">{item.label}</span>
                <span className="block text-xs text-slate-500">{item.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = authService.getUser();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-emerald-100/70 bg-white/78 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1680px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8">
            <button
              onClick={() => navigate("/research/dashboard")}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-slate-100"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-cyan-600 to-emerald-500">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div className="text-left">
                <p className="text-sm font-bold tracking-tight text-slate-900">AURA</p>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">PI Operating System</p>
              </div>
            </button>

            <Sheet>
              <SheetTrigger asChild>
                <button className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 lg:hidden">
                  <Menu className="h-4 w-4" />
                  Menu
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[92vw] max-w-sm p-0">
                <SheetHeader className="border-b border-slate-100 px-4 py-3">
                  <SheetTitle className="text-left text-sm">Navegação</SheetTitle>
                </SheetHeader>
                <div className="h-full overflow-y-auto px-4 py-4">
                  <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold text-slate-800">{user?.name || "Usuário"}</p>
                    <p className="text-[11px] text-slate-500">{user?.email || "Sem e-mail"}</p>
                  </div>
                  <div className="space-y-4">
                    {mobileNavGroups.map((group) => (
                      <div key={group.label}>
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{group.label}</p>
                        <div className="space-y-1">
                          {group.items.map((item) => (
                            <button
                              key={item.path}
                              onClick={() => navigate(item.path)}
                              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${isPathActive(location.pathname, item.path) ? "bg-emerald-100 text-emerald-900" : "text-slate-700 hover:bg-slate-100"}`}
                            >
                              <item.icon className="h-4 w-4 shrink-0" />
                              <span className="font-medium">{item.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </SheetContent>
            </Sheet>

            <nav className="hidden items-center gap-2 lg:flex">
              <DropdownNav label="Dashboard" items={dashboardItems} currentPath={location.pathname} onNavigate={navigate} />
              <DropdownNav label="Pesquisas" items={researchItems} currentPath={location.pathname} onNavigate={navigate} />
              <DropdownNav label="Monitoramentos" items={monitoringItems} currentPath={location.pathname} onNavigate={navigate} />
              <DropdownNav label="Base" items={baseItems} currentPath={location.pathname} onNavigate={navigate} />
              <DropdownNav label="CRM" items={crmItems} currentPath={location.pathname} onNavigate={navigate} />
              <DropdownNav label="Operações" items={opsItems} currentPath={location.pathname} onNavigate={navigate} />
            </nav>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => navigate("/monitoring/dashboard?new=1")}
              className="hidden rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 lg:inline-flex items-center gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Novo Monitoramento
            </button>
            <button onClick={() => navigate("/alerts")} className="relative rounded-lg p-2 text-slate-600 transition-colors hover:bg-white hover:text-cyan-700">
              <Bell className="h-4 w-4" />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-rose-500" />
            </button>
            <button onClick={() => navigate("/settings")} className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-white hover:text-cyan-700">
              <Settings className="h-4 w-4" />
            </button>
            <div className="mx-1 h-6 w-px bg-slate-200" />
            {user && (
              <div className="hidden text-right sm:block">
                <p className="text-xs font-semibold text-slate-800">{user.name}</p>
                <p className="text-[11px] text-slate-500">{user.email}</p>
              </div>
            )}
            <button
              onClick={() => authService.logout()}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 sm:px-3"
            >
              <span className="inline-flex items-center gap-1.5">
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Sair</span>
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1680px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="page-shell p-4 sm:p-6 lg:p-8 animate-fade-in">
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600 lg:hidden">
            <Menu className="h-3.5 w-3.5" />
            Use o menu para navegar entre os módulos
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
