"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { ServicioMant } from "@/lib/types";
import { fechaMx, km, mxn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  tipo: "tracto" | "gondola";
  unidadId: string;
  empresaId: string;
  kmActual?: number | null;   // sugerencia de odómetro (tractos)
}

// Tipos de servicio; aplican igual a tractos y góndolas.
export const CATEGORIAS_SERVICIO = [
  { value: "motor", label: "Motor" },
  { value: "electrico", label: "Eléctrico" },
  { value: "mecanico", label: "Mecánico" },
  { value: "soldadura", label: "Soldaduras" },
  { value: "hidraulico", label: "Hidráulico" },
  { value: "otro", label: "Otro" },
] as const;
const etiquetaCategoria = (v: string | null) => CATEGORIAS_SERVICIO.find((c) => c.value === v)?.label;

const hoy = () => new Date().toISOString().slice(0, 10);

// Bitácora de mantenimiento de una unidad. Tracto: fecha + km + servicio + costo. Góndola: fecha + servicio + costo.
export function FichaServicios({ tipo, unidadId, empresaId, kmActual }: Props) {
  const esTracto = tipo === "tracto";
  const col = esTracto ? "tracto_id" : "gondola_id";
  const [rows, setRows] = useState<ServicioMant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editar, setEditar] = useState<ServicioMant | "nuevo" | null>(null);
  const [f, setF] = useState({ fecha: hoy(), km: "", servicio: "", categoria: "", costo: "", notas: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await createClient().from("servicios_mantenimiento").select("*")
      .eq(col, unidadId).order("fecha", { ascending: false }).order("created_at", { ascending: false });
    if (err) setError(err.message); else { setError(null); setRows((data ?? []) as ServicioMant[]); }
    setLoading(false);
  }, [col, unidadId]);
  useEffect(() => { void load(); }, [load]);

  function abrir(s: ServicioMant | "nuevo") {
    setError(null);
    setF(s === "nuevo"
      ? { fecha: hoy(), km: kmActual != null ? String(Math.round(Number(kmActual))) : "", servicio: "", categoria: "", costo: "", notas: "" }
      : { fecha: s.fecha, km: s.kilometraje != null ? String(s.kilometraje) : "", servicio: s.servicio, categoria: s.categoria ?? "", costo: String(s.costo), notas: s.notas ?? "" });
    setEditar(s);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!editar) return;
    const costo = Number(f.costo || 0);
    const kilometraje = esTracto ? Number(f.km) : null;
    if (!Number.isFinite(costo) || costo < 0) return setError("Costo inválido");
    if (esTracto && (f.km === "" || !Number.isFinite(kilometraje) || (kilometraje as number) < 0)) return setError("Kilometraje inválido");
    setSaving(true); setError(null);
    const datos = { fecha: f.fecha, kilometraje, servicio: f.servicio.trim(), categoria: f.categoria || null, costo, notas: f.notas.trim() || null };
    const sb = createClient();
    const { error: err } = editar === "nuevo"
      ? await sb.from("servicios_mantenimiento").insert({ ...datos, empresa_id: empresaId, [col]: unidadId })
      : await sb.from("servicios_mantenimiento").update(datos).eq("id", editar.id);
    setSaving(false);
    if (err) return setError(err.message);
    setEditar(null); void load();
  }

  async function eliminar(s: ServicioMant) {
    if (!window.confirm("¿Eliminar este servicio de la bitácora?")) return;
    const { error: err } = await createClient().from("servicios_mantenimiento").delete().eq("id", s.id);
    if (err) setError(err.message); else void load();
  }

  const total = rows.reduce((a, r) => a + Number(r.costo), 0);

  return (
    <div className="grid gap-3">
      {error && <Alert variant="error">{error}</Alert>}
      {editar ? (
        <form onSubmit={guardar} className="grid gap-3 rounded-md border p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="sv-fecha">Fecha</Label>
              <Input id="sv-fecha" type="date" required value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
            </div>
            {esTracto && (
              <div className="grid gap-1.5">
                <Label htmlFor="sv-km">Kilometraje (odómetro)</Label>
                <Input id="sv-km" type="number" min={0} step="0.1" required value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="sv-costo">Costo (MXN, IVA incluido)</Label>
              <Input id="sv-costo" type="number" min={0} step="0.01" required value={f.costo} onChange={(e) => setF({ ...f, costo: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sv-cat">Tipo de servicio</Label>
            <select id="sv-cat" className="h-10 rounded-md border bg-background px-3 text-sm" value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })}>
              <option value="">Sin categoría</option>
              {CATEGORIAS_SERVICIO.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sv-serv">Servicio realizado</Label>
            <Input id="sv-serv" required value={f.servicio} onChange={(e) => setF({ ...f, servicio: e.target.value })} placeholder={esTracto ? "Cambio de aceite y filtros" : "Cambio de balatas"} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sv-notas">Notas</Label>
            <Input id="sv-notas" value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditar(null)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar</Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{rows.length} servicios · total {mxn(total)}</span>
          <Button size="sm" variant="outline" onClick={() => abrir("nuevo")}><Plus className="h-4 w-4" /> Agregar servicio</Button>
        </div>
      )}
      {loading ? <p className="text-sm text-muted-foreground">Cargando bitácora…</p>
        : !rows.length ? <p className="text-sm text-muted-foreground">Sin servicios registrados.</p>
        : (
          <ul className="grid gap-2">
            {rows.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-2 rounded-md border p-3 text-sm">
                <div>
                  <p className="font-medium">{s.servicio}</p>
                  <p className="text-xs text-muted-foreground">
                    {etiquetaCategoria(s.categoria) && `${etiquetaCategoria(s.categoria)} · `}{fechaMx(s.fecha)}{s.kilometraje != null && ` · ${km(s.kilometraje)}`}{s.notas && ` · ${s.notas}`}
                  </p>
                </div>
                <div className="flex items-center gap-1 whitespace-nowrap">
                  <span className="font-medium">{mxn(s.costo)}</span>
                  <Button variant="ghost" size="icon" aria-label="Editar servicio" onClick={() => abrir(s)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label="Eliminar servicio" onClick={() => eliminar(s)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
