import { ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Search,
  FileText,
  Settings,
  LogOut,
  ShieldCheck,
  BookOpen,
} from "lucide-react";
import { authService } from "@/services/auth";

const navigation = [
  {
    group: "Pesquisa de Patenteabilidade",
    items: [
      { label: "Dashboard", icon: LayoutDashboard, path: "/research/dashboard" },
      { label: "Nova Pesquisa", icon: Search, path: "/research/new" },
      { label: "Histórico", icon: FileText, path: "/research/history" },
      { label: "Configurações", icon: Settings, path: "/research/settings" },
    ],
  },
  {
    group: "Monitoramento de Colidência",
    items: [
      { label: "Dashboard", icon: LayoutDashboard, path: "/monitoring/dashboard" },
      { label: "Patentes", icon: ShieldCheck, path: "/monitoring/patents" },
      { label: "Base de Conhecimento", icon: BookOpen, path: "/knowledge-base" },
      { label: "Configurações", icon: Settings, path: "/monitoring/settings" },
    ],
  },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = authService.getUser();

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 sidebar-gradient flex flex-col shrink-0 fixed top-0 bottom-0 left-0 z-40">
        <div className="p-6 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-accent-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-sidebar-foreground tracking-tight">
                PatentScope
              </h1>
              <p className="text-xs text-sidebar-foreground/60">
                Análise de Patentes
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-6">
          {navigation.map((group) => (
            <div key={group.group}>
              <h2 className="px-3 text-xs font-semibold text-sidebar-foreground/40 uppercase tracking-wider mb-2">
                {group.group}
              </h2>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <button
                      key={item.label}
                      onClick={() => navigate(item.path)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${isActive
                        ? "bg-sidebar-accent text-sidebar-primary font-medium"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        }`}
                    >
                      <item.icon className="w-4 h-4" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-sidebar-border space-y-1">
          {user && (
            <div className="px-3 py-2">
              <p className="text-xs font-medium text-sidebar-foreground truncate">{user.name}</p>
              <p className="text-[10px] text-sidebar-foreground/50 truncate">{user.email}</p>
            </div>
          )}
          <button
            onClick={() => authService.logout()}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 ml-64 p-8">
        <div className="max-w-6xl mx-auto animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
