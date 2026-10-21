/** Trazo de una ruta por calles y carreteras: polilínea codificada de Valhalla/OSRM (precisión 6) → [lat, lng][]. */
export function decodificarPolilinea(codigo: string, precision = 6): [number, number][] {
  const out: [number, number][] = [];
  const f = 10 ** precision;
  let i = 0, lat = 0, lng = 0;
  while (i < codigo.length) {
    for (let eje = 0; eje < 2; eje++) {
      let desplazo = 0, resultado = 0, b: number;
      do {
        b = codigo.charCodeAt(i++) - 63;
        resultado |= (b & 0x1f) << desplazo;
        desplazo += 5;
      } while (b >= 0x20);
      const delta = resultado & 1 ? ~(resultado >> 1) : resultado >> 1;
      if (eje === 0) lat += delta; else lng += delta;
    }
    out.push([lat / f, lng / f]);
  }
  return out;
}

/** 307 → «5 h 07 min»; 45 → «45 min». */
export function duracionTexto(minutos: number | null | undefined): string {
  if (minutos == null) return "—";
  const m = Math.round(Number(minutos));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export const FUENTE_RUTA: Record<string, string> = {
  "valhalla-camion": "Ruta para camión",
  "osrm-auto": "Ruta por carretera (tiempo ajustado a camión)",
  osrm: "Calculada antes con auto; recalcula para camión",
};
