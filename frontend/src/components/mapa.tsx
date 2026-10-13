"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";

export interface PuntoMapa { lat: number; lng: number; etiqueta: string }

const MX: [number, number] = [23.6, -102.5];

/** Mapa OpenStreetMap (Leaflet). Muestra puntos, opcionalmente unidos por una línea, y con `onPick`
 *  permite marcar un punto con un clic. Los marcadores son círculos (sin imágenes externas). */
export default function Mapa({ puntos, linea = false, onPick, alto = 280, etiquetas = false }: {
  puntos: PuntoMapa[]; linea?: boolean; onPick?: (lat: number, lng: number) => void; alto?: number;
  /** Rotula siempre cada punto con su nombre (por defecto solo si hay 2 o menos). */
  etiquetas?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapa = useRef<LeafletMap | null>(null);
  const capa = useRef<LayerGroup | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    let vivo = true;
    void import("leaflet").then((L) => {
      if (!vivo || !el.current || mapa.current) return;
      const m = L.map(el.current).setView(MX, 5);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18, attribution: "© OpenStreetMap",
      }).addTo(m);
      capa.current = L.layerGroup().addTo(m);
      m.on("click", (e) => pick.current?.(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))));
      mapa.current = m;
      setTimeout(() => m.invalidateSize(), 250);   // el mapa puede abrirse dentro de un diálogo animado
      dibujar(L);
    });
    return () => { vivo = false; mapa.current?.remove(); mapa.current = null; capa.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dibujar(L: typeof import("leaflet")) {
    const m = mapa.current, g = capa.current;
    if (!m || !g) return;
    g.clearLayers();
    puntos.forEach((p) => L.circleMarker([p.lat, p.lng], { radius: 8, color: "#fff", weight: 2, fillColor: "#e11d48", fillOpacity: 1 })
      .bindTooltip(p.etiqueta, { permanent: etiquetas || puntos.length <= 2, direction: "top", className: "mapa-etiqueta" }).addTo(g));
    if (linea && puntos.length > 1) L.polyline(puntos.map((p) => [p.lat, p.lng] as [number, number]), { color: "#2563eb", dashArray: "6 6" }).addTo(g);
    if (puntos.length === 1) m.setView([puntos[0].lat, puntos[0].lng], Math.max(m.getZoom(), 12));
    else if (puntos.length > 1) m.fitBounds(puntos.map((p) => [p.lat, p.lng] as [number, number]), { padding: [30, 30] });
  }

  useEffect(() => { void import("leaflet").then(dibujar); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [puntos, linea, etiquetas]);

  return <div ref={el} style={{ height: alto }} className="mapa-tema z-0 w-full overflow-hidden rounded-md border" role="application" aria-label="Mapa" />;
}
