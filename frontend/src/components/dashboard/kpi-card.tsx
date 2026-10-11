import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

export function KpiCard({ label, value, hint, icon: Icon }: { label: string; value: string; hint: string; icon: LucideIcon }) {
  return (
    <Card className="flex flex-col items-center gap-1 rounded-xl px-4 py-4 text-center">
      <span className="mb-1 flex h-9 w-9 items-center justify-center rounded-full bg-highlight/15 text-highlight">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="max-w-full truncate text-2xl font-bold text-primary dark:text-foreground" title={value}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </Card>
  );
}
