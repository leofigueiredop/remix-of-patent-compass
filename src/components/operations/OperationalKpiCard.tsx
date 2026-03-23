import { type ReactNode } from "react";

type OperationalKpiCardProps = {
  label: string;
  value: string | number;
  icon: ReactNode;
  tone?: "default" | "critical" | "warning" | "success" | "info";
  detail?: string;
};

const toneMap: Record<NonNullable<OperationalKpiCardProps["tone"]>, { box: string; icon: string }> = {
  default: { box: "bg-slate-50", icon: "bg-slate-100 text-slate-600" },
  critical: { box: "bg-rose-50", icon: "bg-rose-100 text-rose-600" },
  warning: { box: "bg-amber-50", icon: "bg-amber-100 text-amber-600" },
  success: { box: "bg-emerald-50", icon: "bg-emerald-100 text-emerald-600" },
  info: { box: "bg-blue-50", icon: "bg-blue-100 text-blue-600" }
};

export default function OperationalKpiCard({
  label,
  value,
  icon,
  tone = "default",
  detail
}: OperationalKpiCardProps) {
  const style = toneMap[tone];
  return (
    <div className={`rounded-xl border border-slate-200 p-4 shadow-sm flex items-start justify-between ${style.box}`}>
      <div>
        <p className="text-xs font-medium text-slate-500 mb-1">{label}</p>
        <h3 className="text-2xl font-bold text-slate-900">{value}</h3>
        {detail ? <p className="text-[11px] text-slate-500 mt-1">{detail}</p> : null}
      </div>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${style.icon}`}>
        {icon}
      </div>
    </div>
  );
}
