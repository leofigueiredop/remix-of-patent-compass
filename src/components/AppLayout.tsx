import { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogOut, Sparkles } from "lucide-react";
import { authService } from "@/services/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GlobalSearchBar, NotificationPopover, QuickActionMenu } from "@/components/platform/components";

type NavItem = {
  label: string;
  path: string;
};

const topNav = [
  { label: "Dashboard", path: "/dashboard" },
  {
    label: "Pesquisas",
    path: "/searches",
    children: [
      { label: "Pipeline", path: "/searches" },
      { label: "Nova Pesquisa", path: "/searches/new" },
      { label: "Histórico", path: "/research/history" },
    ],
  },
  {
    label: "Monitoramentos",
    path: "/monitoring/collision",
    children: [
      { label: "Colidência", path: "/monitoring/collision" },
      { label: "Processo", path: "/monitoring/process" },
      { label: "Mercado", path: "/monitoring/market" },
    ],
  },
  {
    label: "Base",
    path: "/base/patents",
    children: [
      { label: "Base Local", path: "/base/patents" },
      { label: "Histórico RPI", path: "/base/rpi-history" },
      { label: "Fontes / Integrações", path: "/base/sources" },
    ],
  },
  { label: "Clientes", path: "/clients" },
  {
    label: "Operações",
    path: "/operations/workers",
    children: [
      { label: "Alertas", path: "/alerts" },
      { label: "Demandas", path: "/demands" },
      { label: "Background Workers", path: "/operations/workers" },
      { label: "Saúde do Sistema", path: "/operations/system-health" },
    ],
  },
  { label: "Configurações", path: "/settings" },
] as const;

function isPathActive(currentPath: string, itemPath: string) {
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
}

function NavGroup({
  label,
  path,
  items,
  currentPath,
}: {
  label: string;
  path: string;
  items?: NavItem[];
  currentPath: string;
}) {
  const active = items ? items.some((item) => isPathActive(currentPath, item.path)) : isPathActive(currentPath, path);
  if (!items) {
    return (
      <Link
        to={path}
        className={cn(
          "rounded-md px-3 py-2 text-sm font-medium transition-colors",
          active ? "bg-cyan-100 text-cyan-900" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
        )}
      >
        {label}
      </Link>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "rounded-md px-3 py-2 text-sm font-medium transition-colors",
          active ? "bg-cyan-100 text-cyan-900" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
        )}
      >
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {items.map((item) => (
          <DropdownMenuItem key={item.path} asChild>
            <Link to={item.path}>{item.label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const user = authService.getUser();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-100/70">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1720px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
          <button onClick={() => navigate("/dashboard")} className="flex items-center gap-2 rounded-md px-1.5 py-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-slate-900 to-cyan-700">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div className="text-left">
              <p className="text-sm font-bold tracking-tight text-slate-900">PatentScope</p>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Operations Intelligence</p>
            </div>
          </button>
          <nav className="hidden items-center gap-1 lg:flex">
            {topNav.map((item) => (
              <NavGroup
                key={item.label}
                label={item.label}
                path={item.path}
                items={item.children as NavItem[] | undefined}
                currentPath={location.pathname}
              />
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <GlobalSearchBar />
            <QuickActionMenu />
            <NotificationPopover count={6} />
            <Button onClick={() => authService.logout()} variant="outline" size="sm" className="gap-1 border-slate-300">
              <LogOut className="h-3.5 w-3.5" />
              Sair
            </Button>
            {user ? (
              <div className="hidden text-right xl:block">
                <p className="text-xs font-semibold text-slate-800">{user.name}</p>
                <p className="text-[11px] text-slate-500">{user.email}</p>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1720px] px-4 pb-8 pt-24 sm:px-6 lg:px-10">
        <div className="space-y-5">{children}</div>
      </main>
    </div>
  );
}
