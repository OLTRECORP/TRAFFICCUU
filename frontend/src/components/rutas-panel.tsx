"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, Loader2, RefreshCw, Route } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ApiError, postBackend } from "@/lib/api";
import type { Lugar, Ruta } from "@/lib/types";
import { fechaMx, km } from "@/lib/utils";
import { ErrorAlert } from "@/components/error-alert";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Mapa } from "@/components/mapa-dinamico";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const sel = "h-10 min-w-[12rem] rounded-md border bg-background px-3 text-sm";

interface ResultadoKm { asignados: number; calculados: number; sin_coincidencia: number; sin_mapa: number; pendientes: number }

/** Distancias entre lugares (calculadas con el mapa) y cálculo de los km operativos de los viajes. */
export function RutasPanel() {
  const [rutas, setRutas] = useState<Ruta[]>([]);
  const [lugares, setLugares] = useState<Lugar[]>([]);
  const [origen, setOrigen] = useState("");
  const [destino, setDestino] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; status?: number; path?: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ver, setVer] = useState<Ruta | null>(null);

  const load = useCallback(async () => {
    const sb = createClient();
    const [r, l] = await Promise.all([
      sb.from("rutas").select("*, origen:lugares!origen_id(nombre), destino:lugares!destino_id(nombre)").order("calculada_en", { ascending: false }),
      sb.from("lugares").select("*").eq("activo", true).order("nombre"),
    ]);
    if (r.error || l.error) { setError({ message: (r.error ?? l.error)!.message }); return; }
    setRutas((r.data ?? []) as unknown as Ruta[]);
    setLugares((l.data ?? []) as Lugar[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function llamar<T>(clave: string, path: string, body: object): Promise<T | null> {
    setBusy(clave); setError(null); setAviso(null);
    try { return await postBackend<T>(path, JSON.stringify(body), "application/json"); }
    catch (e) { const a = e as ApiError; setError({ message: a.message, status: a.status, path: a.path }); return null; }
    finally { setBusy(null); }
  }

  async function calcular(o: string, d: string, forzar: boolean) {
    const r = await llamar<{ distancia_km: number }>(`${o}-${d}`, "rutas/calcular", { origen_id: o, destino_id: d, forzar });
    if (r) { setAviso(`Distancia de ida: ${km(r.distancia_km)} · km operativos (redondo): ${km(r.distancia_km * 2)}`); await load(); }
  }

  async function calcularViajes() {
    const r = await llamar<ResultadoKm>("viajes", "viajes/calcular-km", {});
    if (!r) return;
    setAviso(`Viajes: ${r.asignados} con origen/destino asignado por nombre, ${r.calculados} con km calculados`
      + (r.sin_coincidencia ? `, ${r.sin_coincidencia} sin lugar que coincida` : "")
      + (r.sin_mapa ? `, ${r.sin_mapa} sin ubicación en el mapa` : "")
      + (r.pendientes ? `. Quedan ${r.pendientes} por calcular: vuelve a pulsar el botón.` : "."));
    await load();
  }

  const puntos = useMemo(() => {
    if (!ver) return [];
    const por = new Map(lugares.map((l) => [l.id, l]));
    return [por.get(ver.origen_id), por.get(ver.destino_id)]
      .filter((l): l is Lugar => !!l && l.lat != null && l.lng != null)
      .map((l) => ({ lat: Number(l.lat), lng: Number(l.lng), etiqueta: l.nombre }));
  }, [ver, lugares]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1 text-xs font-medium">Origen
          <select className={sel} value={origen} onChange={(e) => setOrigen(e.target.value)}>
            <option value="">Selecciona…</option>{lugares.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select></div>
        <div className="grid gap-1 text-xs font-medium">Destino
          <select className={sel} value={destino} onChange={(e) => setDestino(e.target.value)}>
            <option value="">Selecciona…</option>{lugares.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select></div>
        <Button disabled={!origen || !destino || origen === destino || !!busy} onClick={() => void calcular(origen, destino, false)}>
          {busy === `${origen}-${destino}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />} Calcular distancia
        </Button>
        <Button className="ml-auto" variant="outline" disabled={!!busy} onClick={() => void calcularViajes()}
          title="Asigna origen y destino a los viajes por nombre y calcula sus km operativos">
          {busy === "viajes" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />} Calcular km de los viajes
        </Button>
      </div>
      {aviso && <Alert variant="success">{aviso}</Alert>}
      {error && <ErrorAlert where="rutas" message={error.message} status={error.status} path={error.path} />}

      <Card className="rounded-xl">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Origen</TableHead><TableHead>Destino</TableHead><TableHead className="text-right">Distancia (ida)</TableHead>
              <TableHead className="text-right">Km operativos (redondo)</TableHead><TableHead>Calculada</TableHead><TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rutas.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                Aún no hay distancias. Elige un origen y un destino ubicados en el mapa y pulsa «Calcular distancia».
              </TableCell></TableRow>
            ) : rutas.map((r) => (
              <TableRow key={r.id} className="cursor-pointer border-0 even:bg-secondary/70" onClick={() => setVer(r)}>
                <TableCell className="font-medium">{r.origen?.nombre ?? "—"}</TableCell>
                <TableCell className="font-medium">{r.destino?.nombre ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{km(Number(r.distancia_km))}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{km(Number(r.distancia_km) * 2)}</TableCell>
                <TableCell className="whitespace-nowrap">{fechaMx(r.calculada_en)}</TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" aria-label="Recalcular" title="Volver a consultar el mapa" disabled={!!busy}
                    onClick={() => void calcular(r.origen_id, r.destino_id, true)}><RefreshCw className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {ver && <Mapa puntos={puntos} linea />}
    </div>
  );
}
