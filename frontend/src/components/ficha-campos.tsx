"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type Valores = Record<string, string>;

export interface Campo { key: string; label: string; type?: "text" | "date" | "number"; required?: boolean; upper?: boolean; wide?: boolean }

export function Campos({ campos, valores, onChange }: { campos: Campo[]; valores: Valores; onChange: (v: Valores) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {campos.map((c) => (
        <div key={c.key} className={c.wide ? "grid gap-1.5 sm:col-span-2" : "grid gap-1.5"}>
          <Label htmlFor={`f-${c.key}`}>{c.label}{c.required && " *"}</Label>
          <Input
            id={`f-${c.key}`} type={c.type ?? "text"} required={c.required}
            value={valores[c.key] ?? ""}
            onChange={(e) => onChange({ ...valores, [c.key]: c.upper ? e.target.value.toUpperCase() : e.target.value })}
          />
        </div>
      ))}
    </div>
  );
}

// "" -> null; números y fechas con su tipo para Supabase.
export function aPayload(campos: Campo[], valores: Valores) {
  const out: Record<string, string | number | null> = {};
  for (const c of campos) {
    const v = (valores[c.key] ?? "").trim();
    out[c.key] = v === "" ? null : c.type === "number" ? Number(v) : v;
  }
  return out;
}

export const aValores = (campos: Campo[], fila: object | null): Valores =>
  Object.fromEntries(campos.map((c) => [c.key, String((fila as Record<string, unknown> | null)?.[c.key] ?? "")]));

// Vigencia: rojo vencida, amarillo en 30 días, verde vigente.
export function nivelVigencia(fecha: string | null): "rojo" | "amarillo" | "verde" | null {
  if (!fecha) return null;
  const dias = (new Date(fecha).getTime() - Date.now()) / 86_400_000;
  return dias < 0 ? "rojo" : dias <= 30 ? "amarillo" : "verde";
}
