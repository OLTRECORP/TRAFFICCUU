"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ApiError, postBackend } from "@/lib/api";
import type { Cliente } from "@/lib/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ErrorAlert } from "@/components/error-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const sel = "h-10 w-full rounded-md border bg-background px-3 text-sm";
const campo = "grid gap-1";
const hoy = () => new Date().toISOString().slice(0, 10);
const VACIO = { fecha: hoy(), remision: "", material: "", cantidad: "", unidad: "", precio: "", subtotal: "", origen: "", destino: "", chofer: "", tracto: "", gondola: "" };

interface Opciones { lugares: { id: string; nombre: string }[]; choferes: { id: string; nombre: string }[]; tractos: { id: string; placa: string }[]; gondolas: { id: string; placa: string }[] }

/**
 * Captura un viaje a mano (empresas nuevas o con viajes distintos, sin Excel ni XML). Cuenta en las comisiones del chofer y queda
 * sin factura: se liga después desde Facturas (en un cliente de factura semanal entra solo en su semana).
 */
export function AgregarViajeManual({ cliente, onCreado }: { cliente: Cliente; onCreado: (msg: string) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [opc, setOpc] = useState<Opciones>({ lugares: [], choferes: [], tractos: [], gondolas: [] });
  const [f, setF] = useState(VACIO);
  const [subtotalManual, setSubtotalManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!abierto) return;
    setF({ ...VACIO, fecha: hoy() }); setSubtotalManual(false); setError(null);
    void (async () => {
      const sb = createClient();
      const [l, c, t, g] = await Promise.all([
        sb.from("lugares").select("id, nombre").eq("activo", true).order("nombre").limit(2000),
        sb.from("choferes").select("id, nombre").order("nombre").limit(1000),
        sb.from("tractocamiones").select("id, placa").order("placa").limit(1000),
        sb.from("gondolas").select("id, placa").order("placa").limit(1000),
      ]);
      setOpc({ lugares: (l.data ?? []) as Opciones["lugares"], choferes: (c.data ?? []) as Opciones["choferes"],
        tractos: (t.data ?? []) as Opciones["tractos"], gondolas: (g.data ?? []) as Opciones["gondolas"] });
    })();
  }, [abierto]);

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
    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    if (!f.fecha) return setError(new ApiError("Captura la fecha"));
    if (!(Number(f.subtotal) > 0)) return setError(new ApiError("El subtotal es obligatorio y debe ser mayor a cero"));
    for (const [k, nombre] of [["cantidad", "La cantidad"], ["precio", "El precio"]] as const) if (f[k].trim() !== "" && !(Number(f[k]) >= 0)) return setError(new ApiError(`${nombre} no puede ser negativa`));
    setBusy(true); setError(null);
    try {
      const r = await postBackend<{ id: string; distancia_mapa_km: number | null }>(`clientes/${cliente.id}/viajes-manual`, JSON.stringify({
        fecha: f.fecha, remision: f.remision.trim() || null, material: f.material.trim() || null, cantidad: num(f.cantidad), unidad: f.unidad.trim() || null,
        precio_unitario: num(f.precio), subtotal: Number(f.subtotal), lugar_origen_id: f.origen || null, lugar_destino_id: f.destino || null,
        chofer_id: f.chofer || null, tracto_id: f.tracto || null, gondola_id: f.gondola || null }), "application/json");
      const avisos = [
        !f.chofer && "Sin chofer: no cuenta en comisiones hasta asignarlo (lápiz).",
        f.origen && f.destino && r.distancia_mapa_km == null && "Esa ruta aún no tiene km: calcúlala en Orígenes y destinos.",
      ].filter(Boolean).join(" ");
      setAbierto(false);
      onCreado(`Viaje agregado a ${cliente.nombre}. Queda sin factura: ligarlo desde Facturas. ${avisos}`.trim());
    } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  }

  return (
    <>
      <Button size="sm" onClick={() => setAbierto(true)}><Plus className="h-4 w-4" /> Agregar viaje</Button>
      <Dialog open={abierto} onOpenChange={(o) => !o && setAbierto(false)}>
        <DialogContent className="max-w-2xl">
          <div className="pr-6">
            <DialogTitle className="text-lg font-semibold">Agregar viaje · {cliente.nombre}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Viaje capturado a mano. Cuenta en las comisiones del chofer con la tasa del cliente ({Number(cliente.comision_pct)} %) o la de su ruta.
            </DialogDescription>
          </div>
          <Alert variant="info">Queda sin factura hasta que lo ligues a una desde Facturas{cliente.factura_semanal ? "; al ser factura semanal, entra solo en su semana" : ""}.</Alert>
          <form onSubmit={guardar} className="grid gap-3">
            {error && <ErrorAlert where="viaje-manual" message={error.message} status={error.status} path={error.path} />}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className={campo}><Label htmlFor="vm-fecha">Fecha</Label><Input id="vm-fecha" type="date" required value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></div>
              <div className={campo}><Label htmlFor="vm-rem">Remisión (opcional)</Label><Input id="vm-rem" value={f.remision} onChange={(e) => setF({ ...f, remision: e.target.value })} /></div>
              <div className={campo}><Label htmlFor="vm-mat">Material</Label><Input id="vm-mat" value={f.material} onChange={(e) => setF({ ...f, material: e.target.value })} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className={campo}><Label htmlFor="vm-cant">Cantidad</Label><Input id="vm-cant" type="number" min={0} step="0.001" value={f.cantidad} onChange={(e) => cambiar("cantidad", e.target.value)} /></div>
              <div className={campo}><Label htmlFor="vm-uni">Unidad</Label><Input id="vm-uni" placeholder="M3, TON" value={f.unidad} onChange={(e) => setF({ ...f, unidad: e.target.value })} /></div>
              <div className={campo}><Label htmlFor="vm-precio">Precio unitario</Label><Input id="vm-precio" type="number" min={0} step="0.01" value={f.precio} onChange={(e) => cambiar("precio", e.target.value)} /></div>
              <div className={campo}><Label htmlFor="vm-sub">Subtotal</Label><Input id="vm-sub" type="number" min={0} step="0.01" required value={f.subtotal} onChange={(e) => { setSubtotalManual(true); setF({ ...f, subtotal: e.target.value }); }} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className={campo}><Label htmlFor="vm-o">Origen</Label>
                <select id="vm-o" className={sel} value={f.origen} onChange={(e) => setF({ ...f, origen: e.target.value })}><option value="">Sin asignar</option>{opc.lugares.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</select></div>
              <div className={campo}><Label htmlFor="vm-d">Destino</Label>
                <select id="vm-d" className={sel} value={f.destino} onChange={(e) => setF({ ...f, destino: e.target.value })}><option value="">Sin asignar</option>{opc.lugares.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</select></div>
              <div className={campo}><Label htmlFor="vm-c">Chofer</Label>
                <select id="vm-c" className={sel} value={f.chofer} onChange={(e) => setF({ ...f, chofer: e.target.value })}><option value="">Sin asignar</option>{opc.choferes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
              <div className={campo}><Label htmlFor="vm-t">Tracto</Label>
                <select id="vm-t" className={sel} value={f.tracto} onChange={(e) => setF({ ...f, tracto: e.target.value })}><option value="">Sin asignar</option>{opc.tractos.map((t) => <option key={t.id} value={t.id}>{t.placa}</option>)}</select></div>
              <div className={campo}><Label htmlFor="vm-g">Góndola</Label>
                <select id="vm-g" className={sel} value={f.gondola} onChange={(e) => setF({ ...f, gondola: e.target.value })}><option value="">Sin asignar</option>{opc.gondolas.map((g) => <option key={g.id} value={g.id}>{g.placa}</option>)}</select></div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAbierto(false)}>Cancelar</Button>
              <Button type="submit" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Agregar viaje</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
