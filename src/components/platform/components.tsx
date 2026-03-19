import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bell, ChevronDown, Plus, Search, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type Variant = "stable" | "attention" | "critical" | "info" | "neutral";
type RiskVariant = "baixo" | "moderado" | "alto" | "critico";

const statusStyles: Record<Variant, string> = {
  stable: "bg-emerald-500/10 text-emerald-700 border-emerald-300/60",
  attention: "bg-amber-500/10 text-amber-700 border-amber-300/60",
  critical: "bg-rose-500/10 text-rose-700 border-rose-300/60",
  info: "bg-cyan-500/10 text-cyan-700 border-cyan-300/60",
  neutral: "bg-slate-500/10 text-slate-700 border-slate-300/60",
};

const riskStyles: Record<RiskVariant, string> = {
  baixo: "bg-emerald-500/10 text-emerald-700 border-emerald-300/60",
  moderado: "bg-amber-500/10 text-amber-700 border-amber-300/60",
  alto: "bg-orange-500/10 text-orange-700 border-orange-300/60",
  critico: "bg-rose-500/10 text-rose-700 border-rose-300/60",
};

export function StatusBadge({ label, variant = "neutral" }: { label: string; variant?: Variant }) {
  return <Badge className={cn("border font-medium", statusStyles[variant])}>{label}</Badge>;
}

export function RiskBadge({ value }: { value: RiskVariant }) {
  return <Badge className={cn("border font-medium capitalize", riskStyles[value])}>{value}</Badge>;
}

export function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 85 ? "stable" : score >= 70 ? "attention" : "critical";
  return <Badge className={cn("border font-semibold", statusStyles[tone])}>{score}</Badge>;
}

export function UrgencyBadge({ value }: { value: "crítico" | "alto" | "moderado" | "controlado" }) {
  const tone: Variant =
    value === "crítico" ? "critical" : value === "alto" ? "attention" : value === "moderado" ? "info" : "stable";
  return <Badge className={cn("border", statusStyles[tone])}>{value}</Badge>;
}

export function TypeBadge({ label }: { label: string }) {
  return <Badge className="border border-indigo-300/60 bg-indigo-500/10 text-indigo-700">{label}</Badge>;
}

export function SourceBadge({ label }: { label: string }) {
  return <Badge className="border border-slate-300/70 bg-slate-100 text-slate-700">{label}</Badge>;
}

export function StatCard({
  title,
  value,
  detail,
  icon,
  trend,
}: {
  title: string;
  value: string;
  detail: string;
  icon: ReactNode;
  trend?: "up" | "down" | "stable";
}) {
  const trendClass = trend === "up" ? "text-emerald-600" : trend === "down" ? "text-rose-600" : "text-slate-500";
  return (
    <Card className="border-slate-200/80 bg-white">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
            <p className={cn("mt-1 text-xs", trendClass)}>{detail}</p>
          </div>
          <div className="rounded-lg bg-slate-100 p-2 text-slate-700">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("border-slate-200/80 bg-white", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm text-slate-500">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function DetailDrawer({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[620px] overflow-y-auto sm:max-w-[620px]">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  filters,
  actions,
}: {
  title: string;
  subtitle: string;
  breadcrumbs: Array<{ label: string; href?: string }>;
  filters?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.map((item, index) => (
                <span className="inline-flex items-center gap-1.5" key={`${item.label}-${index}`}>
                  <BreadcrumbItem>
                    {item.href ? (
                      <BreadcrumbLink asChild>
                        <Link to={item.href}>{item.label}</Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{item.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                  {index < breadcrumbs.length - 1 ? <BreadcrumbSeparator /> : null}
                </span>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {filters ? <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">{filters}</div> : null}
    </section>
  );
}

export function SecondaryToolbar({
  children,
  withFilter = true,
}: {
  children: ReactNode;
  withFilter?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
      {withFilter ? (
        <Button variant="outline" size="sm" className="gap-1">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filtros
        </Button>
      ) : null}
      {children}
    </div>
  );
}

export function FilterBar({ fields }: { fields: ReactNode }) {
  return <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">{fields}</div>;
}

export function GlobalSearchBar() {
  return (
    <div className="relative hidden w-[300px] lg:block">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      <Input className="h-9 border-slate-300 bg-slate-50 pl-9" placeholder="Buscar cliente, patente, processo..." />
    </div>
  );
}

export function QuickActionMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="h-9 gap-1 bg-slate-900 hover:bg-slate-800">
          <Plus className="h-4 w-4" />
          Novo
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem>Nova pesquisa</DropdownMenuItem>
        <DropdownMenuItem>Novo monitoramento</DropdownMenuItem>
        <DropdownMenuItem>Novo cliente</DropdownMenuItem>
        <DropdownMenuItem>Nova demanda</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function NotificationPopover({ count }: { count: number }) {
  return (
    <Button variant="outline" size="icon" className="relative h-9 w-9 border-slate-300">
      <Bell className="h-4 w-4 text-slate-700" />
      <span className="absolute -right-1 -top-1 rounded-full bg-rose-600 px-1.5 text-[10px] font-semibold text-white">
        {count}
      </span>
    </Button>
  );
}
