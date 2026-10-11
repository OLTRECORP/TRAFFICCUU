import type { Viaje } from "@/lib/types";
import { ubicacionLabel } from "@/lib/format";

export type Rango = "1S" | "1M" | "3M" | "1A";
export const RANGOS: { id: Rango; dias: number; label: string }[] = [
  { id: "1S", dias: 7, label: "1S" },
  { id: "1M", dias: 30, label: "1M" },
  { id: "3M", dias: 90, label: "3M" },
  { id: "1A", dias: 365, label: "1A" },
];

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export interface Kpis { viajes: number; km: number; facturacion: number; destinoTop: string }

/** Indicadores de los últimos 30 días. */
export function kpis(viajes: Viaje[], ahora = new Date()): Kpis {
  const desde = ahora.getTime() - 30 * DAY;
  const mes = viajes.filter((v) => new Date(v.fecha).getTime() >= desde);
  const cuenta = new Map<string, number>();
  for (const v of mes) {
    const k = ubicacionLabel(v.destino);
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  }
  const top = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    viajes: mes.length,
    km: mes.reduce((s, v) => s + Number(v.distancia_operativa), 0),
    facturacion: mes.reduce((s, v) => s + Number(v.total), 0),
    destinoTop: top ? top[0] : "—",
  };
}

export interface Punto { label: string; valor: number }

/** Facturación por día (1S/1M), semana (3M) o mes (1A), con huecos rellenados en cero. */
export function serieFacturacion(viajes: Viaje[], rango: Rango, ahora = new Date()): Punto[] {
  const dias = RANGOS.find((r) => r.id === rango)!.dias;
  const paso = rango === "1A" ? "mes" : rango === "3M" ? "semana" : "dia";
  const fin = startOfDay(ahora);
  const inicio = new Date(fin.getTime() - (dias - 1) * DAY);

  const llave = (d: Date) => {
    const x = startOfDay(d);
    if (paso === "mes") return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1);
    if (paso === "semana") return x.getTime() - ((x.getUTCDay() + 6) % 7) * DAY; // lunes
    return x.getTime();
  };
  const buckets = new Map<number, number>();
  for (let t = inicio.getTime(); t <= fin.getTime(); t += DAY) buckets.set(llave(new Date(t)), 0);
  for (const v of viajes) {
    const f = new Date(v.fecha);
    if (f < inicio || f.getTime() >= fin.getTime() + DAY) continue;
    const k = llave(f);
    buckets.set(k, (buckets.get(k) ?? 0) + Number(v.total));
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, valor]) => {
    const d = new Date(t);
    const label = paso === "mes"
      ? new Intl.DateTimeFormat("es-MX", { month: "short", timeZone: "UTC" }).format(d)
      : `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return { label, valor };
  });
}

export interface Rebanada { nombre: string; valor: number }

/** Cuenta viajes por clave; agrupa el resto en "Otros" después de `top`. */
export function agrupar(viajes: Viaje[], clave: (v: Viaje) => string, top = 4): Rebanada[] {
  const m = new Map<string, number>();
  for (const v of viajes) m.set(clave(v), (m.get(clave(v)) ?? 0) + 1);
  const orden = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const cabeza = orden.slice(0, top).map(([nombre, valor]) => ({ nombre, valor }));
  const resto = orden.slice(top).reduce((s, [, v]) => s + v, 0);
  return resto ? [...cabeza, { nombre: "Otros", valor: resto }] : cabeza;
}
