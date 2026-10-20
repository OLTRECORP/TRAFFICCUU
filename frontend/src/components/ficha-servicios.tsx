"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Regla, ServicioMant } from "@/lib/types";
import { fechaMx, km, mxn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { instalarLlantasDeServicio, SelectorLlantas, totalSeleccion, type SeleccionLlantas, type UnidadSel } from "@/components/mantenimiento/llantas";
import { listaLlantas } from "@/lib/llantas";
import { Label } from "@/components/ui/label";

interface Props {
  tipo: "tracto" | "gondola";
  unidadId: string;
  empresaId: string;
  kmActual?: number | null;   // sugerencia de odómetro (tractos)
  onChange?: () => void;      // se llama al agregar, editar o eliminar (para refrescar totales fuera de la bitácora)
  reglas?: Regla[];           // servicios programados: el registro reinicia su conteo de km y días
}

// Tipos de servicio; aplican igual a tractos y góndolas.
export const CATEGORIAS_SERVICIO = [
  { value: "motor", label: "Motor" },
  { value: "electrico", label: "Eléctrico" },
  { value: "mecanico", label: "Mecánico" },
  { value: "soldadura", label: "Soldaduras" },
  { value: "hidraulico", label: "Hidráulico" },
  { value: "carroceria", label: "Carrocería" },
  { value: "suspension", label: "Suspensión" },
  { value: "llantas", label: "Llantas" },
  { value: "frenos", label: "Frenos" },
  { value: "transmision", label: "Transmisión" },
  { value: "otro", label: "Otro" },
] as const;
const etiquetaCategoria = (v: string | null) => CATEGORIAS_SERVICIO.find((c) => c.value === v)?.label;

const hoy = () => new Date().toISOString().slice(0, 10);

// Bitácora de mantenimiento de una unidad. Tracto: fecha + km + servicio + costo. Góndola: fecha + servicio + costo.
export function FichaServicios({ tipo, unidadId, empresaId, kmActual, onChange, reglas = [] }: Props) {
  const esTracto = tipo === "tracto";
  const col = esTracto ? "tracto_id" : "gondola_id";
  const [rows, setRows] = useState<ServicioMant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editar, setEditar] = useState<ServicioMant | "nuevo" | null>(null);
  const [f, setF] = useState({ fecha: hoy(), km: "", servicio: "", categoria: "", costo: "", notas: "", regla: "" });
  const [saving, setSaving] = useState(false);
  const [unidad, setUnidad] = useState<UnidadSel | null>(null);
  const [sel, setSel] = useState<SeleccionLlantas>({});
  const [ll, setLl] = useState({ marca: "", medida: "", vida: "" });
  const [ligadas, setLigadas] = useState<Map<string, string[]>>(new Map());   // servicio → posiciones instaladas

  const load = useCallback(async () => {
    const { data, error: err } = await createClient().from("servicios_mantenimiento").select("*")
      .eq(col, unidadId).order("fecha", { ascending: false }).order("created_at", { ascending: false });
    if (err) setError(err.message); else { setError(null); setRows((data ?? []) as ServicioMant[]); }
    setLoading(false);
    // Llantas instaladas por cada servicio (migración 028); sin ella no se muestran
    const sb = createClient();
    const [u, l] = await Promise.all([
      sb.from(esTracto ? "tractocamiones" : "gondolas").select("id, placa, ejes").eq("id", unidadId).maybeSingle(),
      sb.from("llantas").select("servicio_id, posicion").eq(col, unidadId).not("servicio_id", "is", null),
    ]);
    if (u.data) setUnidad({ tipo, id: unidadId, placa: u.data.placa, ejes: u.data.ejes ?? (esTracto ? 3 : 2) });
    const m = new Map<string, string[]>();
    for (const x of (l.error ? [] : l.data ?? []) as { servicio_id: string; posicion: string }[]) m.set(x.servicio_id, [...(m.get(x.servicio_id) ?? []), x.posicion]);
    setLigadas(m);
  }, [col, unidadId, tipo, esTracto]);
  useEffect(() => { void load(); }, [load]);

  function abrir(s: ServicioMant | "nuevo") {
    setError(null); setSel({});
    setLl({ marca: "", medida: "", vida: String(reglas.find((r) => r.categoria === "llantas" && r.intervalo_km)?.intervalo_km ?? 120000) });
    setF(s === "nuevo"
      ? { fecha: hoy(), km: kmActual != null ? String(Math.round(Number(kmActual))) : "", servicio: "", categoria: "", costo: "", notas: "", regla: "" }
      : { fecha: s.fecha, km: s.kilometraje != null ? String(s.kilometraje) : "", servicio: s.servicio, categoria: s.categoria ?? "", costo: String(s.costo), notas: s.notas ?? "", regla: s.regla_id ?? "" });
    setEditar(s);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!editar) return;
    const costo = Number(f.costo || 0);
    const kilometraje = esTracto ? Number(f.km) : null;
    if (!Number.isFinite(costo) || costo < 0) return setError("Costo inválido");
    if (esTracto && (f.km === "" || !Number.isFinite(kilometraje) || (kilometraje as number) < 0)) return setError("Kilometraje inválido");
    const conLlantas = editar === "nuevo" && f.categoria === "llantas" && !!unidad, vida = Math.round(Number(ll.vida));
    if (conLlantas && !totalSeleccion(sel)) return setError("Toca en el diagrama las llantas que se cambiaron");
    if (conLlantas && !(vida > 0)) return setError("Vida esperada inválida");
    setSaving(true); setError(null);
    const datos = { fecha: f.fecha, kilometraje, servicio: f.servicio.trim(), categoria: f.categoria || null, costo, notas: f.notas.trim() || null,
      ...(esTracto && reglas.length ? { regla_id: f.regla || null } : {}) };
    const sb = createClient();
    // al editar, la fecha y el km se copian solos a las llantas ligadas (trigger de la 028)
    const { data: nuevo, error: err } = editar === "nuevo"
      ? await sb.from("servicios_mantenimiento").insert({ ...datos, empresa_id: empresaId, [col]: unidadId }).select("id").single()
      : await sb.from("servicios_mantenimiento").update(datos).eq("id", editar.id).select("id").single();
    if (err) { setSaving(false); return setError(err.message); }
    if (conLlantas && unidad) {
      const e2 = await instalarLlantasDeServicio(sb, {
        empresaId, unidades: [unidad], seleccion: sel, servicios: { [unidadId]: (nuevo as { id: string }).id },
        fecha: f.fecha, kmTracto: kilometraje, vidaKm: vida, marca: ll.marca.trim() || null, medida: ll.medida.trim() || null, costoTotal: costo,
      });
      if (e2) { setSaving(false); void load(); return setError(`El servicio se guardó, pero las llantas no: ${e2}`); }
    }
    setSaving(false);
    setEditar(null); void load(); onChange?.();
  }

  async function eliminar(s: ServicioMant) {
    if (!window.confirm("¿Eliminar este servicio de la bitácora?")) return;
    const { error: err } = await createClient().from("servicios_mantenimiento").delete().eq("id", s.id);
    if (err) setError(err.message); else { void load(); onChange?.(); }
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
          {esTracto && reglas.length > 0 && (
            <div className="grid gap-1.5">
              <Label htmlFor="sv-regla">Servicio programado (opcional)</Label>
              <select id="sv-regla" className="h-10 rounded-md border bg-background px-3 text-sm" value={f.regla}
                onChange={(e) => {
                  const r = reglas.find((x) => x.id === e.target.value);
                  setF({ ...f, regla: e.target.value, servicio: f.servicio || r?.tipo_servicio || "", categoria: r?.categoria ?? f.categoria });
                }}>
                <option value="">Ninguno</option>
                {reglas.map((r) => <option key={r.id} value={r.id}>{r.tipo_servicio}</option>)}
              </select>
              <span className="text-xs text-muted-foreground">Si cumple un servicio programado, su conteo de km y días vuelve a empezar desde esta fecha y kilometraje.</span>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="sv-cat">Tipo de servicio</Label>
            <select id="sv-cat" className="h-10 rounded-md border bg-background px-3 text-sm" value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })}>
              <option value="">Sin categoría</option>
              {CATEGORIAS_SERVICIO.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          {f.categoria === "llantas" && unidad && (editar === "nuevo" ? (
            <div className="grid gap-2">
              <Label>Llantas que se cambiaron</Label>
              <SelectorLlantas unidades={[unidad]} value={sel} onChange={setSel} />
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5"><Label htmlFor="sv-marca">Marca</Label><Input id="sv-marca" value={ll.marca} onChange={(e) => setLl({ ...ll, marca: e.target.value })} /></div>
                <div className="grid gap-1.5"><Label htmlFor="sv-medida">Medida</Label><Input id="sv-medida" placeholder="11R22.5" value={ll.medida} onChange={(e) => setLl({ ...ll, medida: e.target.value })} /></div>
                <div className="grid gap-1.5"><Label htmlFor="sv-vida">Vida esperada (km)</Label><Input id="sv-vida" type="number" min={1} value={ll.vida} onChange={(e) => setLl({ ...ll, vida: e.target.value })} /></div>
              </div>
              <span className="text-xs text-muted-foreground">
                Las llantas elegidas quedan instaladas con la fecha{esTracto ? " y el kilometraje" : ""} de este servicio y el costo se reparte entre ellas.
              </span>
            </div>
          ) : ligadas.get(editar.id)?.length ? (
            <p className="text-xs text-muted-foreground">
              Instaladas en este servicio: {listaLlantas(tipo, ligadas.get(editar.id)!)}.
              Si cambias la fecha{esTracto ? " o el kilometraje" : ""}, también se corrigen en ellas.
            </p>
          ) : null)}
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
                    {ligadas.get(s.id)?.length ? ` · ${listaLlantas(tipo, ligadas.get(s.id)!)}` : ""}
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
