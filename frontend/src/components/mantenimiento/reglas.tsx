"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Regla } from "@/lib/types";
import { CATEGORIAS_SERVICIO } from "@/components/ficha-servicios";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";
type Borrador = { id: string | null; tipo_servicio: string; categoria: string; km: string; dias: string };
const aBorrador = (r: Regla): Borrador => ({ id: r.id, tipo_servicio: r.tipo_servicio, categoria: r.categoria ?? "", km: r.intervalo_km ? String(r.intervalo_km) : "", dias: r.intervalo_dias ? String(r.intervalo_dias) : "" });

/** Servicios programados de la flota: rubro y cada cuántos km y/o días. Aplican a todos los tractos. */
export function ReglasMantenimiento({ reglas, empresaId, onChange }: { reglas: Regla[]; empresaId: string | null; onChange: () => void }) {
  const [filas, setFilas] = useState<Borrador[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setFilas(reglas.map(aBorrador)); }, [reglas]);

  const set = (i: number, k: keyof Borrador, v: string) => setFilas((f) => f.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  async function guardar(b: Borrador) {
    const kmN = b.km.trim() ? Number(b.km) : null, diasN = b.dias.trim() ? Math.round(Number(b.dias)) : null;
    if (!b.tipo_servicio.trim()) return setError("Escribe el nombre del servicio");
    if (kmN == null && diasN == null) return setError("Indica cada cuántos km y/o cada cuántos días");
    if ((kmN != null && !(kmN > 0)) || (diasN != null && !(diasN > 0))) return setError("Los intervalos deben ser mayores a cero");
    setBusy(b.id ?? "nuevo"); setError(null);
    const datos = { tipo_servicio: b.tipo_servicio.trim(), categoria: b.categoria || null, intervalo_km: kmN, intervalo_dias: diasN };
    const sb = createClient();
    const { error: e } = b.id ? await sb.from("reglas_mantenimiento").update(datos).eq("id", b.id)
      : await sb.from("reglas_mantenimiento").insert({ ...datos, empresa_id: empresaId });
    setBusy(null);
    if (e) setError(e.message.includes("duplicate") ? "Ya existe un servicio con ese nombre" : e.message); else onChange();
  }

  async function borrar(b: Borrador) {
    if (!b.id) { setFilas((f) => f.filter((x) => x !== b)); return; }
    setBusy(b.id); setError(null);
    const { error: e } = await createClient().from("reglas_mantenimiento").delete().eq("id", b.id);
    setBusy(null);
    if (e) setError(e.message.includes("foreign key") ? "Este servicio ya tiene registros en la bitácora de alertas; no se puede borrar (cámbiale el intervalo)." : e.message);
    else onChange();
  }

  const cambio = (b: Borrador) => { const r = reglas.find((x) => x.id === b.id); return !r || JSON.stringify(aBorrador(r)) !== JSON.stringify(b); };

  return (
    <Card className="rounded-xl">
      <CardHeader>
        <CardTitle className="text-base">Servicios programados por rubro</CardTitle>
        <p className="text-sm text-muted-foreground">Aplican a todos los tractos. Un servicio vence por km o por días, lo que llegue primero; deja vacío el que no use.</p>
      </CardHeader>
      <CardContent className="grid gap-2">
        {error && <ErrorAlert where="reglas-mantenimiento" message={error} />}
        <div className="hidden grid-cols-[1.4fr_1fr_0.8fr_0.8fr_auto] gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid">
          <span>Servicio</span><span>Rubro</span><span>Cada km</span><span>Cada días</span><span />
        </div>
        {filas.map((b, i) => (
          <div key={b.id ?? `n${i}`} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[1.4fr_1fr_0.8fr_0.8fr_auto] sm:border-0 sm:p-0">
            <Input aria-label="Servicio" value={b.tipo_servicio} onChange={(e) => set(i, "tipo_servicio", e.target.value)} placeholder="Ej. Cambio de aceite" />
            <select aria-label="Rubro" className={sel} value={b.categoria} onChange={(e) => set(i, "categoria", e.target.value)}>
              <option value="">Sin rubro</option>
              {CATEGORIAS_SERVICIO.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <Input aria-label="Cada km" type="number" min={1} value={b.km} onChange={(e) => set(i, "km", e.target.value)} placeholder="—" />
            <Input aria-label="Cada días" type="number" min={1} value={b.dias} onChange={(e) => set(i, "dias", e.target.value)} placeholder="—" />
            <div className="flex gap-1">
              <Button size="sm" disabled={busy !== null || !cambio(b)} onClick={() => void guardar(b)}>
                {busy === (b.id ?? "nuevo") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Guardar"}
              </Button>
              <Button size="icon" variant="ghost" aria-label={`Borrar ${b.tipo_servicio}`} disabled={busy !== null} onClick={() => void borrar(b)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
        ))}
        <div>
          <Button variant="outline" size="sm" onClick={() => setFilas((f) => [...f, { id: null, tipo_servicio: "", categoria: "", km: "", dias: "" }])}>
            <Plus className="h-4 w-4" /> Agregar servicio programado
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
