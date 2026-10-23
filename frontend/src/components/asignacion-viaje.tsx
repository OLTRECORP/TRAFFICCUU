"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ApiError, postBackend } from "@/lib/api";
import { comisionDe, TASA_GENERAL } from "@/lib/comisiones";
import type { Viaje } from "@/lib/types";
import { fechaMx, km, mxn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const sel = "h-10 w-full rounded-md border bg-background px-3 text-sm";

interface Opcion { id: string; etiqueta: string; extra?: string | null; inactivo?: boolean }
export interface Asignado { tracto: string | null; gondola: string | null; chofer: string | null; licencia: string | null }
interface Registro { id: string; motivo: string | null; created_at: string; resumen: { antes?: Record<string, string | null>; despues?: Record<string, string | null> } }

const NOMBRE: Record<string, string> = { tracto_id: "Tracto", gondola_id: "Góndola", chofer_id: "Chofer" };

/** Cambia el tracto, la góndola o el chofer de UN viaje (p. ej. por un error de timbrado). Las métricas se recalculan solas. */
export function AsignacionViaje({ viaje, onAsignado }: { viaje: Viaje; onAsignado: (a: Asignado) => void }) {
  const [tractos, setTractos] = useState<Opcion[]>([]);
  const [gondolas, setGondolas] = useState<Opcion[]>([]);
  const [choferes, setChoferes] = useState<Opcion[]>([]);
  const [actual, setActual] = useState({ tracto: viaje.tracto?.id ?? "", gondola: viaje.gondola?.id ?? "", chofer: viaje.chofer?.id ?? "" });
  const [elegido, setElegido] = useState(actual);
  const [motivo, setMotivo] = useState("");
  const [tasa, setTasa] = useState<number>(TASA_GENERAL);
  const [historial, setHistorial] = useState<Registro[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargarHistorial = useCallback(async () => {
    const { data } = await createClient().from("auditoria_eliminaciones").select("id, motivo, created_at, resumen")
      .eq("accion", "viaje_reasignado").eq("resumen->>viaje_id", viaje.id).order("created_at", { ascending: false }).limit(10);
    setHistorial((data ?? []) as Registro[]);
  }, [viaje.id]);

  useEffect(() => {
    const inicial = { tracto: viaje.tracto?.id ?? "", gondola: viaje.gondola?.id ?? "", chofer: viaje.chofer?.id ?? "" };
    setActual(inicial); setElegido(inicial); setMotivo(""); setError(null); setAviso(null);
    void (async () => {
      const sb = createClient();
      const [t, g, c, cv] = await Promise.all([
        sb.from("tractocamiones").select("id, placa, modelo").order("placa").limit(1000),
        sb.from("gondolas").select("id, placa").order("placa").limit(1000),
        sb.from("choferes").select("id, nombre, licencia, activo").order("nombre").limit(1000),
        sb.from("comisiones_viajes").select("tasa_comision").eq("viaje_id", viaje.id).limit(1),
      ]);
      setTractos(((t.data ?? []) as { id: string; placa: string; modelo: string | null }[]).map((x) => ({ id: x.id, etiqueta: x.placa, extra: x.modelo })));
      setGondolas(((g.data ?? []) as { id: string; placa: string }[]).map((x) => ({ id: x.id, etiqueta: x.placa })));
      setChoferes(((c.data ?? []) as { id: string; nombre: string; licencia: string | null; activo: boolean }[]).map((x) => ({ id: x.id, etiqueta: x.nombre, extra: x.licencia, inactivo: x.activo === false })));
      const tc = (cv.data ?? [])[0] as { tasa_comision: number | null } | undefined;
      setTasa(tc?.tasa_comision != null ? Number(tc.tasa_comision) : TASA_GENERAL);
    })();
    void cargarHistorial();
  }, [viaje, cargarHistorial]);

  const etiqueta = (lista: Opcion[], id: string) => lista.find((o) => o.id === id)?.etiqueta ?? null;
  const cambios = useMemo(() => {
    const c: Record<string, string | null> = {};
    if (elegido.tracto !== actual.tracto) c.tracto_id = elegido.tracto || null;
    if (elegido.gondola !== actual.gondola) c.gondola_id = elegido.gondola || null;
    if (elegido.chofer !== actual.chofer) c.chofer_id = elegido.chofer || null;
    return c;
  }, [elegido, actual]);
  const hay = Object.keys(cambios).length > 0;
  const comision = comisionDe(Number(viaje.subtotal), tasa);

  async function guardar() {
    setBusy(true); setError(null); setAviso(null);
    try {
      await postBackend(`viajes/${viaje.id}/asignar`, JSON.stringify({ ...cambios, motivo: motivo.trim() || null }), "application/json");
      setActual(elegido); setMotivo("");
      onAsignado({ tracto: etiqueta(tractos, elegido.tracto), gondola: etiqueta(gondolas, elegido.gondola), chofer: etiqueta(choferes, elegido.chofer), licencia: choferes.find((c) => c.id === elegido.chofer)?.extra ?? null });
      setAviso("Asignación corregida: el odómetro, las comisiones, el rendimiento y la ganancia ya usan los nuevos datos.");
      await cargarHistorial();
    } catch (e) { setError(e as ApiError); } finally { setBusy(false); }
  }

  const select = (valor: string, onChange: (v: string) => void, lista: Opcion[], aria: string) => (
    <select aria-label={aria} className={sel} value={valor} onChange={(e) => onChange(e.target.value)} disabled={busy}>
      <option value="">Sin asignar</option>
      {lista.map((o) => <option key={o.id} value={o.id}>{o.etiqueta}{o.inactivo ? " (inactivo)" : ""}</option>)}
    </select>
  );

  return (
    <div className="grid gap-3 rounded-md border p-3">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><UserRound className="h-3.5 w-3.5" aria-hidden /> Asignación del viaje (tracto, góndola y chofer)</h4>
      <p className="text-xs text-muted-foreground">Si el timbrado trae una placa o un chofer equivocado, corrígelo aquí solo para este viaje. Las métricas se calculan con lo que quede asignado.</p>
      {error && <Alert variant="error">{error.message}</Alert>}
      {aviso && <Alert variant="success">{aviso}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-xs font-medium">Tracto{select(elegido.tracto, (v) => setElegido({ ...elegido, tracto: v }), tractos, "Tracto del viaje")}</label>
        <label className="grid gap-1 text-xs font-medium">Góndola{select(elegido.gondola, (v) => setElegido({ ...elegido, gondola: v }), gondolas, "Góndola del viaje")}</label>
        <label className="grid gap-1 text-xs font-medium">Chofer{select(elegido.chofer, (v) => setElegido({ ...elegido, chofer: v }), choferes, "Chofer del viaje")}</label>
      </div>
      {hay && (
        <ul className="grid gap-0.5 rounded-md bg-secondary/60 p-2 text-xs">
          {"tracto_id" in cambios && <li>Tracto: {etiqueta(tractos, actual.tracto) ?? "sin asignar"} → <b>{etiqueta(tractos, elegido.tracto) ?? "sin asignar"}</b>. Sus {km(Number(viaje.distancia_operativa))} operativos pasan al odómetro del nuevo tracto (se recalcula solo).</li>}
          {"gondola_id" in cambios && <li>Góndola: {etiqueta(gondolas, actual.gondola) ?? "sin asignar"} → <b>{etiqueta(gondolas, elegido.gondola) ?? "sin asignar"}</b>.</li>}
          {"chofer_id" in cambios && <li>Chofer: {etiqueta(choferes, actual.chofer) ?? "sin asignar"} → <b>{etiqueta(choferes, elegido.chofer) ?? "sin asignar"}</b>. La comisión de este viaje ({mxn(comision)} al {tasa} %) {elegido.chofer ? "pasa al nuevo chofer" : "queda sin chofer y no suma a nadie"}.</li>}
        </ul>
      )}
      <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-1"><Label htmlFor="av-motivo" className="text-xs">Motivo (opcional)</Label>
          <Input id="av-motivo" value={motivo} maxLength={300} placeholder="Error de timbrado, placa capturada mal…" onChange={(e) => setMotivo(e.target.value)} /></div>
        <Button onClick={() => void guardar()} disabled={!hay || busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Guardar asignación</Button>
      </div>
      {historial.length > 0 && (
        <div className="grid gap-1">
          <h5 className="text-xs font-semibold text-muted-foreground">Cambios anteriores de este viaje</h5>
          <ul className="divide-y rounded-md border text-xs">
            {historial.map((h) => (
              <li key={h.id} className="px-2 py-1">
                <span className="text-muted-foreground">{fechaMx(h.created_at)} · </span>
                {Object.keys(h.resumen.despues ?? {}).map((k) => `${NOMBRE[k] ?? k}: ${h.resumen.antes?.[k] ?? "sin asignar"} → ${h.resumen.despues?.[k] ?? "sin asignar"}`).join("; ")}
                {h.motivo && <span className="text-muted-foreground"> · {h.motivo}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
