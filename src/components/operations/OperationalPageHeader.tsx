import { type ReactNode } from "react";

type OperationalPageHeaderProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  metrics?: ReactNode;
};

export default function OperationalPageHeader({
  title,
  description,
  icon,
  actions,
  metrics
}: OperationalPageHeaderProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="animate-in fade-in slide-in-from-left duration-500">
          <h1 className="text-2xl font-bold flex items-center gap-3 text-slate-900 mb-1">
            {icon ? (
              <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
                {icon}
              </div>
            ) : null}
            {title}
          </h1>
          {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {metrics ? <div className="mt-4">{metrics}</div> : null}
    </div>
  );
}
