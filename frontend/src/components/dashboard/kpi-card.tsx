import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

/** Barritas decorativas: la última (más reciente) lleva el color de acento de la empresa. */
function Mini({ serie }: { serie: number[] }) {
  const max = Math.max(...serie, 0);
  if (!serie.length || max === 0) return null;
  return (
    <div className="flex h-9 items-end gap-[3px]" aria-hidden>
      {serie.map((v, i) => (
        <span key={i} className={i === serie.length - 1 ? "w-1.5 rounded-full bg-highlight" : "w-1.5 rounded-full bg-primary/25 dark:bg-primary/40"}
          style={{ height: `${Math.max(12, (v / max) * 100)}%` }} />
      ))}
    </div>
  );
}

export function KpiCard({ label, value, hint, icon: Icon, serie }: { label: string; value: string; hint: string; icon: LucideIcon; serie?: number[] }) {
  return (
    <Card className="flex flex-col gap-3 px-5 py-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-highlight/15 text-highlight">
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <p className="min-w-0 truncate text-3xl font-bold tracking-tight text-primary dark:text-foreground" title={value}>{value}</p>
        {serie && <Mini serie={serie} />}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}
