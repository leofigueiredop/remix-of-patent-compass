import { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  BookOpen,
  ChevronDown,
  FileText,
  LayoutDashboard,
  LogOut,
  Search,
  SearchCheck,
  Settings,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { authService } from "@/services/auth";

type NavItem = {
  label: string;
  icon: React.ElementType;
  path: string;
  description: string;
};

const dashboardItems: NavItem[] = [
  {
    label: "Dashboard Pesquisa",
    icon: LayoutDashboard,
    path: "/research/dashboard",
    description: "Visão do pipeline e produtividade",
  },
  {
    label: "Dashboard Monitoramento",
    icon: ShieldCheck,
    path: "/monitoring/dashboard",
    description: "Alertas, riscos e prazos críticos",
  },
];

const monitoringItems: NavItem[] = [
  {
    label: "Mercado",
    icon: SearchCheck,
    path: "/monitoring/base",
    description: "Base para análise competitiva",
  },
  {
    label: "Colisão",
    icon: ShieldCheck,
    path: "/monitoring/patents",
    description: "Patentes monitoradas e conflitos",
  },
  {
    label: "Processo",
    icon: Workflow,
    path: "/monitoring/background-workers",
    description: "Filas, reprocessos e ingestão",
  },
  {
    label: "Configurações Monitoramento",
    icon: Settings,
    path: "/monitoring/settings",
    description: "Parâmetros operacionais",
  },
];

const researchItems: NavItem[] = [
  {
    label: "Nova Pesquisa",
    icon: Search,
    path: "/research/new",
    description: "Fluxo assistido de patenteabilidade",
  },
  {
    label: "Busca Rápida",
    icon: SearchCheck,
    path: "/search",
    description: "Consulta direta por número e termo",
  },
  {
    label: "Histórico",
    icon: FileText,
    path: "/research/history",
    description: "Resultados e versões anteriores",
  },
  {
    label: "Configurações Pesquisa",
    icon: Settings,
    path: "/research/settings",
    description: "Preferências do fluxo de pesquisa",
  },
  {
    label: "Base de Conhecimento",
    icon: BookOpen,
    path: "/knowledge-base",
    description: "Conhecimento interno e guias",
  },
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
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-cyan-50 to-emerald-100/50">
      <header className="sticky top-0 z-40 border-b border-emerald-100/70 bg-white/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8">
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
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Intelligence</p>
              </div>
            </button>

            <nav className="hidden items-center gap-2 lg:flex">
              <DropdownNav label="Dashboard" items={dashboardItems} currentPath={location.pathname} onNavigate={navigate} />
              <DropdownNav label="Monitoramento" items={monitoringItems} currentPath={location.pathname} onNavigate={navigate} />
              <DropdownNav label="Pesquisa" items={researchItems} currentPath={location.pathname} onNavigate={navigate} />
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <button className="relative rounded-lg p-2 text-slate-600 transition-colors hover:bg-white hover:text-cyan-700">
              <Bell className="h-4 w-4" />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-rose-500" />
            </button>
            <button className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-white hover:text-cyan-700">
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
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <span className="inline-flex items-center gap-1.5">
                <LogOut className="h-3.5 w-3.5" />
                Sair
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="rounded-2xl border border-cyan-100/80 bg-white/78 p-4 shadow-sm backdrop-blur-sm sm:p-6 lg:p-8 animate-fade-in">
          <div className="mb-5 flex flex-wrap items-center gap-2 lg:hidden">
            {[...dashboardItems, ...monitoringItems, ...researchItems].map((item) => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${isPathActive(location.pathname, item.path) ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
