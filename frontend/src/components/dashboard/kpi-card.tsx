import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

/** Barritas decorativas: la última (más reciente) lleva el color de acento de la empresa. Ocupan una fila propia y se ajustan al ancho. */
function Mini({ serie }: { serie: number[] }) {
  const max = Math.max(...serie, 0);
  if (!serie.length || max === 0) return null;
  return (
    <div className="flex h-8 w-full items-end gap-[2px] overflow-hidden" aria-hidden>
      {serie.map((v, i) => (
        <span key={i} className={cn("min-w-[2px] max-w-[8px] flex-1 rounded-full", i === serie.length - 1 ? "bg-highlight" : "bg-primary/25 dark:bg-primary/40")}
          style={{ height: `${Math.max(12, (v / max) * 100)}%` }} />
      ))}
    </div>
  );
}

/** El tamaño de la cifra baja según su longitud para que nunca se corte ni quede bajo la minigráfica. */
const tamano = (valor: string) =>
  valor.length <= 9 ? "text-3xl" : valor.length <= 12 ? "text-2xl" : valor.length <= 15 ? "text-xl" : "text-lg";

export function KpiCard({ label, value, hint, icon: Icon, serie }: { label: string; value: string; hint: string; icon: LucideIcon; serie?: number[] }) {
  return (
    <Card className="flex min-w-0 flex-col gap-2 overflow-hidden px-5 py-5">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-sm font-medium text-muted-foreground">{label}</p>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-highlight/15 text-highlight">
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      {/* Cifra y nota usan todo el ancho; la minigráfica va en su propia fila, nunca encima de la cifra. */}
      <p className={cn("break-words font-bold leading-tight tracking-tight text-primary dark:text-foreground", tamano(value))} title={value}>{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {serie && <Mini serie={serie} />}
    </Card>
  );
}
