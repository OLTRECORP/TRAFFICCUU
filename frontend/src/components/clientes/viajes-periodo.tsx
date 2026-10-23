"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ApiError, postBackend } from "@/lib/api";
import { claveRemision, gruposDuplicados, type ViajeDup } from "@/lib/duplicados";
import type { Cliente, SemanaCliente } from "@/lib/types";
import { fechaMx, km, mxn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ErrorAlert } from "@/components/error-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const corta = (d: string) => new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const sel = "h-10 w-full rounded-md border bg-background px-3 text-sm";

interface Fila {
  id: string; created_at: string; fecha: string; remision: string | null; material: string | null; cantidad: number | null; unidad: string | null;
  precio_unitario: number | null; subtotal: number; distancia_operativa: number; folio_factura: string | null; origen_registro: string;
  lugar_origen_id: string | null; lugar_destino_id: string | null; chofer_id: string | null; tracto_id: string | null;
  lugar_origen: { nombre: string } | null; lugar_destino: { nombre: string } | null; chofer: { nombre: string } | null; tracto: { placa: string } | null;
}
interface Quitado { id: string; remision: string | null; fecha: string | null; subtotal: number | null; motivo: string | null; created_at: string }
interface Opciones { lugares: { id: string; nombre: string }[]; choferes: { id: string; nombre: string }[]; tractos: { id: string; placa: string }[] }

const aDup = (v: Fila): ViajeDup => ({ id: v.id, created_at: v.created_at, fecha: v.fecha, remision: v.remision, material: v.material, cantidad: v.cantidad, subtotal: Number(v.subtotal),
  origen: v.lugar_origen?.nombre ?? null, destino: v.lugar_destino?.nombre ?? null, chofer: v.chofer?.nombre ?? null, tracto: v.tracto?.placa ?? null });

/** Viajes de una semana del cliente: detectar duplicados, quitar los repetidos o erróneos (con respaldo, se pueden restaurar) y corregirlos. */
export function ViajesPeriodo({ cliente, semana, onClose, onCambio }: { cliente: Cliente; semana: SemanaCliente | null; onClose: () => void; onCambio: () => void }) {
  const [viajes, setViajes] = useState<Fila[]>([]);
  const [quitados, setQuitados] = useState<Quitado[]>([]);
  const [otrasSemanas, setOtrasSemanas] = useState<Map<string, string[]>>(new Map());   // remisión → fechas fuera del periodo
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [confirmando, setConfirmando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [editar, setEditar] = useState<Fila | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!semana) return;
    const sb = createClient();
    const desde = `${semana.semana}T00:00:00+00:00`, hasta = `${semana.fin}T23:59:59+00:00`;
    const [v, q] = await Promise.all([
      sb.from("viajes")
        .select("id, created_at, fecha, remision, material, cantidad, unidad, precio_unitario, subtotal, distancia_operativa, folio_factura, origen_registro, lugar_origen_id, lugar_destino_id, chofer_id, tracto_id, lugar_origen:lugares!lugar_origen_id(nombre), lugar_destino:lugares!lugar_destino_id(nombre), chofer:choferes(nombre), tracto:tractocamiones(placa)")
        .eq("cliente_id", cliente.id).gte("fecha", desde).lte("fecha", hasta).order("fecha").order("remision"),
      sb.from("viajes_descartados").select("id, remision, fecha, subtotal, motivo, created_at").eq("cliente_id", cliente.id)
        .gte("fecha", semana.semana).lte("fecha", semana.fin).order("created_at", { ascending: false }),
    ]);
    const filas = (v.data ?? []) as unknown as Fila[];
    setViajes(filas); setQuitados(q.error ? [] : ((q.data ?? []) as Quitado[]));
    // la misma remisión en otra semana también cuenta como posible duplicado
    const rems = [...new Set(filas.map((f) => f.remision).filter((r): r is string => !!r))];
    const mapa = new Map<string, string[]>();
    if (rems.length) {
      const o = await sb.from("viajes").select("id, remision, fecha").eq("cliente_id", cliente.id).in("remision", rems).or(`fecha.lt.${desde},fecha.gt.${hasta}`).limit(500);
      for (const x of (o.data ?? []) as { remision: string; fecha: string }[]) {
        const k = claveRemision(x.remision);
        mapa.set(k, [...(mapa.get(k) ?? []), x.fecha.slice(0, 10)]);
      }
    }
    setOtrasSemanas(mapa);
  }, [semana, cliente.id]);

  useEffect(() => {
    setViajes([]); setQuitados([]); setElegidos(new Set()); setConfirmando(false); setError(null); setAviso(null); setMotivo("");
    void cargar();
  }, [cargar]);

  const grupos = useMemo(() => gruposDuplicados(viajes.map(aDup)), [viajes]);
  const dupDe = useMemo(() => new Map(grupos.flatMap((g) => g.viajes.map((x) => [x.id, g] as const))), [grupos]);
  const sobran = useMemo(() => new Set(grupos.flatMap((g) => g.sobran)), [grupos]);
  const total = viajes.reduce((s, v) => s + Number(v.subtotal), 0);
  const marcados = viajes.filter((v) => elegidos.has(v.id));
  const subtotalMarcado = marcados.reduce((s, v) => s + Number(v.subtotal), 0);
  const conFactura = marcados.filter((v) => v.folio_factura);

  const alternar = (id: string) => setElegidos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function llamar<T>(path: string, body: object): Promise<T | null> {
    setBusy(true); setError(null); setAviso(null);
    try { return await postBackend<T>(path, JSON.stringify(body), "application/json"); }
    catch (e) { setError(e as ApiError); return null; }
    finally { setBusy(false); }
  }

  async function quitar() {
    const r = await llamar<{ viajes: number; subtotal: number }>(`clientes/${cliente.id}/quitar-viajes`, { ids: [...elegidos], motivo: motivo.trim() || null });
    if (!r) return;
    setAviso(`Se quitaron ${r.viajes} viaje(s) por ${mxn(r.subtotal)}. Reimportar el Excel no los vuelve a crear; puedes restaurarlos abajo.`);
    setElegidos(new Set()); setConfirmando(false); setMotivo("");
    await cargar(); onCambio();
  }

  async function restaurar(ids: string[]) {
    const r = await llamar<{ viajes: number }>(`clientes/${cliente.id}/restaurar-viajes`, { ids });
    if (!r) return;
    setAviso(`Se restauraron ${r.viajes} viaje(s).`);
    await cargar(); onCambio();
  }

  return (
    <>
      <Dialog open={!!semana} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-6xl">
          {semana && (
            <>
              <div className="pr-6">
                <DialogTitle className="text-lg font-semibold">Viajes de {cliente.nombre}</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Semana del {corta(semana.semana)} al {corta(semana.fin)} {semana.fin.slice(0, 4)} · {viajes.length} viajes · {mxn(total)}. Quita los duplicados o erróneos, o corrige sus datos.
                </DialogDescription>
              </div>
              {error && <ErrorAlert where="viajes-periodo" message={error.message} status={error.status} path={error.path} />}
              {aviso && <Alert variant="success">{aviso}</Alert>}
              {grupos.length > 0 && (
                <Alert variant="info" className="flex flex-wrap items-center justify-between gap-2">
                  <span><b>{sobran.size}</b> posible(s) duplicado(s) en {grupos.length} grupo(s): misma remisión, o mismos datos sin remisión. Se conserva el primero que se capturó.</span>
                  <Button size="sm" variant="outline" onClick={() => { setElegidos(new Set(sobran)); setConfirmando(false); }}>Seleccionar los repetidos</Button>
                </Alert>
              )}
              <div className="max-h-[52vh] overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-8" />
                      <TableHead>Fecha</TableHead><TableHead>Remisión</TableHead><TableHead>Origen → destino</TableHead><TableHead>Material</TableHead>
                      <TableHead>Chofer / tracto</TableHead><TableHead className="text-right">Cantidad</TableHead><TableHead className="text-right">Km</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead><TableHead>Factura</TableHead><TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viajes.map((v) => {
                      const g = dupDe.get(v.id), excel = v.origen_registro === "excel";
                      const fuera = v.remision ? otrasSemanas.get(claveRemision(v.remision)) : undefined;
                      return (
                        <TableRow key={v.id} className={elegidos.has(v.id) ? "bg-red-50 dark:bg-red-950/30" : g ? "bg-amber-50 dark:bg-amber-950/20" : undefined}>
                          <TableCell>
                            <input type="checkbox" aria-label={`Seleccionar la remisión ${v.remision ?? v.id}`} disabled={!excel} title={excel ? undefined : "Los viajes de un XML se quitan con su factura"}
                              checked={elegidos.has(v.id)} onChange={() => alternar(v.id)} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{fechaMx(v.fecha)}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {v.remision ?? "—"}
                            {g && <Badge variant="amarillo" className="ml-1">{sobran.has(v.id) ? "repetido" : "original"}</Badge>}
                            {fuera && <span className="block text-xs text-amber-700 dark:text-amber-400">también el {fuera.map((f) => corta(f)).join(", ")}</span>}
                          </TableCell>
                          <TableCell>{v.lugar_origen?.nombre ?? "—"} → {v.lugar_destino?.nombre ?? "—"}</TableCell>
                          <TableCell>{v.material ?? "—"}</TableCell>
                          <TableCell>{v.chofer?.nombre ?? "—"}<span className="block text-xs text-muted-foreground">{v.tracto?.placa ?? ""}</span></TableCell>
                          <TableCell className="whitespace-nowrap text-right">{v.cantidad ?? "—"} {v.unidad ?? ""}{v.precio_unitario != null && <span className="block text-xs text-muted-foreground">× {mxn(v.precio_unitario)}</span>}</TableCell>
                          <TableCell className="whitespace-nowrap text-right">{Number(v.distancia_operativa) ? km(v.distancia_operativa) : <span className="text-xs text-muted-foreground">sin mapa</span>}</TableCell>
                          <TableCell className="whitespace-nowrap text-right">{mxn(v.subtotal)}</TableCell>
                          <TableCell>{v.folio_factura ?? "—"}</TableCell>
                          <TableCell><Button variant="ghost" size="icon" aria-label="Corregir viaje" title={excel ? "Corregir" : "Los viajes de un XML salen de su Carta Porte"} disabled={!excel} onClick={() => setEditar(v)}><Pencil className="h-4 w-4" /></Button></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <tfoot className="border-t bg-secondary/50">
                    <TableRow><TableCell colSpan={8} className="font-semibold">Total · {viajes.length} viajes</TableCell>
                      <TableCell className="text-right font-semibold">{mxn(total)}</TableCell><TableCell colSpan={2} /></TableRow>
                  </tfoot>
                </Table>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="destructive" disabled={!marcados.length || busy} onClick={() => setConfirmando(true)}>
                  <Trash2 className="h-4 w-4" /> Quitar seleccionados ({marcados.length})
                </Button>
                {marcados.length > 0 && <Button variant="ghost" onClick={() => { setElegidos(new Set()); setConfirmando(false); }}>Limpiar selección</Button>}
                {marcados.length > 0 && <span className="text-sm text-muted-foreground">{mxn(subtotalMarcado)} · el periodo quedaría en {mxn(total - subtotalMarcado)}</span>}
              </div>

              {confirmando && marcados.length > 0 && (
                <div className="grid gap-3 rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
                  <p className="text-sm">
                    Vas a quitar <b>{marcados.length}</b> viaje(s) por <b>{mxn(subtotalMarcado)}</b>. Se respaldan: reimportar el Excel no los vuelve a crear y puedes restaurarlos.
                    {conFactura.length > 0 && <> <b>{conFactura.length}</b> están ligados a una factura ({[...new Set(conFactura.map((v) => v.folio_factura))].join(", ")}): la semana puede dejar de cuadrar con ella.</>}
                  </p>
                  <div className="grid gap-1"><Label htmlFor="vp-motivo" className="text-xs">Motivo (opcional)</Label>
                    <Input id="vp-motivo" value={motivo} maxLength={300} placeholder="Duplicado, captura errónea…" onChange={(e) => setMotivo(e.target.value)} /></div>
                  <div className="flex gap-2">
                    <Button variant="destructive" disabled={busy} onClick={() => void quitar()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Sí, quitar</Button>
                    <Button variant="outline" disabled={busy} onClick={() => setConfirmando(false)}>Cancelar</Button>
                  </div>
                </div>
              )}

              {quitados.length > 0 && (
                <div className="grid gap-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quitados en este periodo ({quitados.length})</h3>
                  <ul className="divide-y rounded-md border text-sm">
                    {quitados.map((q) => (
                      <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                        <span>{q.fecha ? fechaMx(q.fecha) : "—"} · Rem. {q.remision ?? "—"} · {q.subtotal != null ? mxn(q.subtotal) : "—"}{q.motivo && <span className="text-muted-foreground"> · {q.motivo}</span>}</span>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void restaurar([q.id])}><RotateCcw className="h-3.5 w-3.5" /> Restaurar</Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <CorregirViaje viaje={editar} onClose={() => setEditar(null)} onGuardado={(msg) => { setEditar(null); setAviso(msg); void cargar(); onCambio(); }} />
    </>
  );
}

function CorregirViaje({ viaje, onClose, onGuardado }: { viaje: Fila | null; onClose: () => void; onGuardado: (msg: string) => void }) {
  const [opc, setOpc] = useState<Opciones>({ lugares: [], choferes: [], tractos: [] });
  const [f, setF] = useState({ fecha: "", remision: "", material: "", cantidad: "", unidad: "", precio: "", subtotal: "", origen: "", destino: "", chofer: "", tracto: "" });
  const [subtotalManual, setSubtotalManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    void (async () => {
      const sb = createClient();
      const [l, c, t] = await Promise.all([
        sb.from("lugares").select("id, nombre").eq("activo", true).order("nombre").limit(2000),
        sb.from("choferes").select("id, nombre").order("nombre").limit(1000),
        sb.from("tractocamiones").select("id, placa").order("placa").limit(1000),
      ]);
      setOpc({ lugares: (l.data ?? []) as Opciones["lugares"], choferes: (c.data ?? []) as Opciones["choferes"], tractos: (t.data ?? []) as Opciones["tractos"] });
    })();
  }, []);

  useEffect(() => {
    if (!viaje) return;
    setError(null); setSubtotalManual(false);
    setF({ fecha: viaje.fecha.slice(0, 10), remision: viaje.remision ?? "", material: viaje.material ?? "", cantidad: viaje.cantidad != null ? String(viaje.cantidad) : "",
      unidad: viaje.unidad ?? "", precio: viaje.precio_unitario != null ? String(viaje.precio_unitario) : "", subtotal: String(viaje.subtotal),
      origen: viaje.lugar_origen_id ?? "", destino: viaje.lugar_destino_id ?? "", chofer: viaje.chofer_id ?? "", tracto: viaje.tracto_id ?? "" });
  }, [viaje]);

  // el subtotal sigue a cantidad × precio mientras no se capture a mano
  function cambiar(k: "cantidad" | "precio", v: string) {
    setF((x) => {
      const n = { ...x, [k]: v };
      const c = Number(n.cantidad), p = Number(n.precio);
      if (!subtotalManual && n.cantidad !== "" && n.precio !== "" && Number.isFinite(c) && Number.isFinite(p)) n.subtotal = String(Math.round(c * p * 100) / 100);
      return n;
    });
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!viaje) return;
    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    if (!f.fecha) return setError(new ApiError("Captura la fecha"));
    if (f.subtotal.trim() === "" || !(Number(f.subtotal) >= 0)) return setError(new ApiError("El subtotal es obligatorio y no puede ser negativo"));
    for (const [k, nombre] of [["cantidad", "La cantidad"], ["precio", "El precio"]] as const) if (f[k].trim() !== "" && !(Number(f[k]) >= 0)) return setError(new ApiError(`${nombre} no puede ser negativa`));
    // solo se envía lo que cambió
    const nuevo = { fecha: f.fecha, remision: f.remision.trim() || null, material: f.material.trim() || null, cantidad: num(f.cantidad), unidad: f.unidad.trim() || null,
      precio_unitario: num(f.precio), subtotal: Number(f.subtotal), lugar_origen_id: f.origen || null, lugar_destino_id: f.destino || null, chofer_id: f.chofer || null, tracto_id: f.tracto || null };
    const antes: Record<string, unknown> = { fecha: viaje.fecha.slice(0, 10), remision: viaje.remision, material: viaje.material, cantidad: viaje.cantidad, unidad: viaje.unidad,
      precio_unitario: viaje.precio_unitario, subtotal: Number(viaje.subtotal), lugar_origen_id: viaje.lugar_origen_id, lugar_destino_id: viaje.lugar_destino_id, chofer_id: viaje.chofer_id, tracto_id: viaje.tracto_id };
    const cambios = Object.fromEntries(Object.entries(nuevo).filter(([k, v]) => (antes[k] ?? null) !== v));
    if (!Object.keys(cambios).length) return onClose();
    setBusy(true); setError(null);
    try {
      const r = await postBackend<{ cambios: Record<string, unknown>; distancia_mapa_km: number | null }>(`viajes/${viaje.id}/corregir`, JSON.stringify(cambios), "application/json");
      const km = "distancia_mapa_km" in r.cambios && r.distancia_mapa_km == null ? " Origen y destino cambiaron: calcula la ruta en Orígenes y destinos para los km." : "";
      onGuardado(`Viaje corregido (${Object.keys(r.cambios).filter((k) => !["total", "fecha_salida", "mercancia", "distancia_mapa_km"].includes(k)).length} campo(s)).${km}${viaje.folio_factura && "subtotal" in cambios ? ` Cambió el subtotal: revisa que la semana cuadre con la factura ${viaje.folio_factura}.` : ""}`);
    } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  }

  const campo = "grid gap-1";
  return (
    <Dialog open={!!viaje} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <div className="pr-6">
          <DialogTitle className="text-lg font-semibold">Corregir viaje {viaje?.remision ? `· Rem. ${viaje.remision}` : ""}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">Los cambios quedan en la bitácora de depuración con los valores anteriores.</DialogDescription>
        </div>
        {viaje?.folio_factura && <Alert variant="info">Este viaje está ligado a la factura {viaje.folio_factura}: si cambias el subtotal o la fecha, la semana puede dejar de cuadrar con ella.</Alert>}
        <form onSubmit={guardar} className="grid gap-3">
          {error && <ErrorAlert where="corregir-viaje" message={error.message} status={error.status} path={error.path} />}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={campo}><Label htmlFor="cv-fecha">Fecha</Label><Input id="cv-fecha" type="date" required value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></div>
            <div className={campo}><Label htmlFor="cv-rem">Remisión</Label><Input id="cv-rem" value={f.remision} onChange={(e) => setF({ ...f, remision: e.target.value })} /></div>
            <div className={campo}><Label htmlFor="cv-mat">Material</Label><Input id="cv-mat" value={f.material} onChange={(e) => setF({ ...f, material: e.target.value })} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className={campo}><Label htmlFor="cv-cant">Cantidad</Label><Input id="cv-cant" type="number" min={0} step="0.001" value={f.cantidad} onChange={(e) => cambiar("cantidad", e.target.value)} /></div>
            <div className={campo}><Label htmlFor="cv-uni">Unidad</Label><Input id="cv-uni" placeholder="M3, TON" value={f.unidad} onChange={(e) => setF({ ...f, unidad: e.target.value })} /></div>
            <div className={campo}><Label htmlFor="cv-precio">Precio unitario</Label><Input id="cv-precio" type="number" min={0} step="0.01" value={f.precio} onChange={(e) => cambiar("precio", e.target.value)} /></div>
            <div className={campo}><Label htmlFor="cv-sub">Subtotal</Label><Input id="cv-sub" type="number" min={0} step="0.01" required value={f.subtotal} onChange={(e) => { setSubtotalManual(true); setF({ ...f, subtotal: e.target.value }); }} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={campo}><Label htmlFor="cv-o">Origen</Label>
              <select id="cv-o" className={sel} value={f.origen} onChange={(e) => setF({ ...f, origen: e.target.value })}><option value="">Sin asignar</option>{opc.lugares.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</select></div>
            <div className={campo}><Label htmlFor="cv-d">Destino</Label>
              <select id="cv-d" className={sel} value={f.destino} onChange={(e) => setF({ ...f, destino: e.target.value })}><option value="">Sin asignar</option>{opc.lugares.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</select></div>
            <div className={campo}><Label htmlFor="cv-c">Chofer</Label>
              <select id="cv-c" className={sel} value={f.chofer} onChange={(e) => setF({ ...f, chofer: e.target.value })}><option value="">Sin asignar</option>{opc.choferes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
            <div className={campo}><Label htmlFor="cv-t">Tracto</Label>
              <select id="cv-t" className={sel} value={f.tracto} onChange={(e) => setF({ ...f, tracto: e.target.value })}><option value="">Sin asignar</option>{opc.tractos.map((t) => <option key={t.id} value={t.id}>{t.placa}</option>)}</select></div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Guardar corrección</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
