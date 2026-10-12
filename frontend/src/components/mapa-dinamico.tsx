"use client";

import dynamic from "next/dynamic";

// Leaflet usa `window`: solo se carga en el navegador.
export const Mapa = dynamic(() => import("./mapa"), {
  ssr: false,
  loading: () => <div className="flex h-[280px] items-center justify-center rounded-md border text-sm text-muted-foreground">Cargando mapa…</div>,
});
export type { PuntoMapa } from "./mapa";
