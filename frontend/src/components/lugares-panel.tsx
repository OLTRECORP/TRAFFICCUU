"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, MapPin, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ApiError, postBackend } from "@/lib/api";
import type { Lugar } from "@/lib/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mapa } from "@/components/mapa-dinamico";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const TIPOS = { origen: "Origen", destino: "Destino", ambos: "Origen y destino" } as const;
const sel = "h-10 rounded-md border bg-background px-3 text-sm";

/** Catálogo de orígenes y destinos: nombre/referencia, dirección y ubicación en el mapa. */
export function LugaresPanel() {
  const [rows, setRows] = useState<Lugar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [editar, setEditar] = useState<Lugar | "nuevo" | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await createClient().from("lugares").select("*").order("nombre");
    if (err) setError(err.message); else { setError(null); setRows((data ?? []) as Lugar[]); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((r) => [r.nombre, r.direccion, r.referencia].some((v) => (v ?? "").toLowerCase().includes(t))) : rows;
  }, [rows, q]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Buscar nombre, dirección o referencia" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button className="ml-auto" onClick={() => setEditar("nuevo")}><Plus className="h-4 w-4" /> Agregar lugar</Button>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      <Card className="rounded-xl">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Nombre</TableHead><TableHead>Tipo</TableHead><TableHead>Dirección</TableHead>
              <TableHead>Referencia</TableHead><TableHead>Mapa</TableHead><TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Cargando…</TableCell></TableRow>
            ) : filtradas.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                {rows.length ? "Sin resultados." : "Aún no hay lugares. Agrega tus orígenes y destinos habituales."}
              </TableCell></TableRow>
            ) : filtradas.map((l) => (
              <TableRow key={l.id} className="border-0 even:bg-secondary/70">
                <TableCell className="font-medium">{l.nombre}{!l.activo && <Badge className="ml-2">Inactivo</Badge>}</TableCell>
                <TableCell>{TIPOS[l.tipo]}</TableCell>
                <TableCell className="max-w-xs truncate" title={l.direccion ?? undefined}>{l.direccion ?? "—"}</TableCell>
                <TableCell>{l.referencia ?? "—"}</TableCell>
                <TableCell>{l.lat != null && l.lng != null
                  ? <Badge variant="verde">Ubicado</Badge> : <Badge variant="amarillo">Sin ubicar</Badge>}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => setEditar(l)}><Pencil className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="border-t px-4 py-3 text-xs">{filtradas.length} de {rows.length} lugares</div>
      </Card>
      <Formulario editar={editar} onClose={() => setEditar(null)} onSaved={() => { setEditar(null); void load(); }} />
    </div>
  );
}

function Formulario({ editar, onClose, onSaved }: { editar: Lugar | "nuevo" | null; onClose: () => void; onSaved: () => void }) {
  const nuevo = editar === "nuevo";
  const [v, setV] = useState({ nombre: "", tipo: "ambos", direccion: "", referencia: "", lat: "", lng: "", activo: true });
  const [saving, setSaving] = useState(false);
  const [ubicando, setUbicando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editar) return;
    const l = typeof editar === "string" ? null : editar;
    setV({ nombre: l?.nombre ?? "", tipo: l?.tipo ?? "ambos", direccion: l?.direccion ?? "", referencia: l?.referencia ?? "",
      lat: l?.lat != null ? String(l.lat) : "", lng: l?.lng != null ? String(l.lng) : "", activo: l?.activo ?? true });
    setError(null);
  }, [editar]);

  const lat = v.lat === "" ? null : Number(v.lat), lng = v.lng === "" ? null : Number(v.lng);
  const puntoValido = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const puntos = useMemo(() => (puntoValido ? [{ lat: lat!, lng: lng!, etiqueta: v.nombre || "Lugar" }] : []), [puntoValido, lat, lng, v.nombre]);

  async function ubicar() {
    setUbicando(true); setError(null);
    try {
      const r = await postBackend<{ lat: number; lng: number }>("mapas/geocodificar", JSON.stringify({ direccion: v.direccion }), "application/json");
      setV((x) => ({ ...x, lat: String(r.lat), lng: String(r.lng) }));
    } catch (e) { setError((e as ApiError).message); } finally { setUbicando(false); }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editar) return;
    if ((lat != null || lng != null) && !puntoValido) return setError("Latitud y longitud no son válidas.");
    setSaving(true); setError(null);
    const sb = createClient();
    const datos = {
      nombre: v.nombre.trim(), tipo: v.tipo, direccion: v.direccion.trim() || null, referencia: v.referencia.trim() || null,
      lat: puntoValido ? lat : null, lng: puntoValido ? lng : null, activo: v.activo,
    };
    let err;
    if (typeof editar === "string") {
      const emp = await sb.from("empresa_configuracion").select("id").maybeSingle();
      if (!emp.data) { setSaving(false); return setError("Primero configura tu empresa en Empresa."); }
      ({ error: err } = await sb.from("lugares").insert({ ...datos, empresa_id: emp.data.id }));
    } else {
      ({ error: err } = await sb.from("lugares").update(datos).eq("id", editar.id));
    }
    setSaving(false);
    if (err) setError(err.code === "23505" ? "Ya existe un lugar con ese nombre." : err.message); else onSaved();
  }

  async function eliminar() {
    if (!editar || typeof editar === "string") return;
    if (!window.confirm(`¿Eliminar «${editar.nombre}»? Se borran sus distancias guardadas y los viajes quedan sin ese lugar.`)) return;
    setSaving(true);
    const { error: err } = await createClient().from("lugares").delete().eq("id", editar.id);
    setSaving(false);
    if (err) setError(err.message); else onSaved();
  }

  return (
    <Dialog open={!!editar} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <div>
          <DialogTitle className="text-lg font-semibold">{nuevo ? "Agregar lugar" : "Editar lugar"}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Escribe la dirección y pulsa «Ubicar», o haz clic en el mapa para marcar el punto exacto.
          </DialogDescription>
        </div>
        <form onSubmit={onSubmit} className="grid gap-3">
          {error && <Alert variant="error">{error}</Alert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="l-nombre">Nombre o referencia *</Label>
              <Input id="l-nombre" required value={v.nombre} onChange={(e) => setV({ ...v, nombre: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="l-tipo">Tipo</Label>
              <select id="l-tipo" className={sel} value={v.tipo} onChange={(e) => setV({ ...v, tipo: e.target.value })}>
                {Object.entries(TIPOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select></div>
            <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="l-dir">Dirección</Label>
              <div className="flex gap-2">
                <Input id="l-dir" value={v.direccion} placeholder="Calle, número, colonia, municipio, estado"
                  onChange={(e) => setV({ ...v, direccion: e.target.value })} />
                <Button type="button" variant="outline" disabled={ubicando || v.direccion.trim().length < 3} onClick={() => void ubicar()}>
                  {ubicando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Ubicar
                </Button>
              </div></div>
            <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="l-ref">Referencia</Label>
              <Input id="l-ref" value={v.referencia} placeholder="Ej. Frente a la caseta, portón 3" onChange={(e) => setV({ ...v, referencia: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="l-lat">Latitud</Label>
              <Input id="l-lat" type="number" step="any" value={v.lat} onChange={(e) => setV({ ...v, lat: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="l-lng">Longitud</Label>
              <Input id="l-lng" type="number" step="any" value={v.lng} onChange={(e) => setV({ ...v, lng: e.target.value })} /></div>
          </div>
          <Mapa puntos={puntos} onPick={(la, lo) => setV((x) => ({ ...x, lat: String(la), lng: String(lo) }))} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.activo} onChange={(e) => setV({ ...v, activo: e.target.checked })} /> Activo
          </label>
          <div className="flex flex-wrap justify-between gap-2">
            {!nuevo ? <Button type="button" variant="outline" disabled={saving} onClick={eliminar}><Trash2 className="h-4 w-4" /> Eliminar</Button> : <span />}
            <Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />} Guardar</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
