"use client";

import { useMemo } from "react";
import { Clock, Route as RouteIcon, Truck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Mapa } from "@/components/mapa-dinamico";
import { decodificarPolilinea, duracionTexto, FUENTE_RUTA } from "@/lib/rutas";
import type { Lugar, Ruta } from "@/lib/types";
import { km } from "@/lib/utils";

/** Mapa de la ruta por calles y carreteras para camión de carga, con km y tiempo de ida y de ida y vuelta. */
export function RutaCamion({ origen, destino, ruta, alto = 300 }: {
  origen: Lugar | null | undefined; destino: Lugar | null | undefined; ruta: Pick<Ruta, "distancia_km" | "duracion_min" | "geometria" | "fuente"> | null; alto?: number;
}) {
  const puntos = useMemo(() => [origen, destino]
    .filter((l): l is Lugar => !!l && l.lat != null && l.lng != null)
    .map((l) => ({ lat: Number(l.lat), lng: Number(l.lng), etiqueta: l.nombre })), [origen, destino]);
  const trazo = useMemo(() => (ruta?.geometria ? decodificarPolilinea(ruta.geometria) : undefined), [ruta?.geometria]);
  return (
    <div className="grid gap-2">
      <Mapa puntos={puntos} linea={!trazo} trazo={trazo} alto={alto} />
      {ruta && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-1"><RouteIcon className="h-4 w-4" aria-hidden /> Ida <b>{km(Number(ruta.distancia_km))}</b></span>
          <span className="flex items-center gap-1"><Clock className="h-4 w-4" aria-hidden /> <b>{duracionTexto(ruta.duracion_min)}</b>{ruta.duracion_min != null && <> · ida y vuelta {duracionTexto(Number(ruta.duracion_min) * 2)}</>}</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><Truck className="h-3.5 w-3.5" aria-hidden /> {FUENTE_RUTA[ruta.fuente ?? "osrm"] ?? ruta.fuente}</span>
        </p>
      )}
      {ruta && !trazo && (
        <Alert variant="info">Esta ruta se calculó sin trazo: la línea punteada es solo referencia en línea recta. Pulsa «Recalcular» para trazarla por calles y carreteras para camión.</Alert>
      )}
    </div>
  );
}
