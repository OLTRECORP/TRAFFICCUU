/**
 * Métricas por tracto entre dos fechas (inclusive; vacío = sin límite). Reutiliza gananciaPorTracto para viajes, facturación,
 * costo de combustible y costo de mantenimiento (misma fórmula que la pestaña Ganancia); aquí solo se agregan litros, km y facturas.
 */
import type { Carga, ViajeRend } from "./combustible.ts";
import { enPeriodo, gananciaPorTracto, type Periodo, type ServicioGan, type ViajeGan } from "./ganancia.ts";

/** Viaje con su factura (las canceladas ya vienen excluidas). */
export interface ViajeFactura { viaje_id: string; tracto_id: string | null; fecha_viaje: string; factura_id: string | null; factura_total: number | null }

export interface MetricasTracto {
  id: string | null;            // tracto_id; null = viajes sin tracto
  litros: number;               // combustible cargado
  costoCombustible: number;
  cargasSinCosto: number;
  costoMantenimiento: number;
  facturas: number;             // facturas distintas ligadas a sus viajes
  montoFacturas: number;        // total (con IVA) de esas facturas; una factura semanal se cuenta completa en cada tracto que la comparte
  viajes: number;
  km: number;                   // km redondos (del mapa) de sus viajes
  facturacion: number;          // subtotal antes de IVA de sus viajes
}

export interface MetricasResultado { filas: MetricasTracto[]; total: MetricasTracto }

const r2 = (n: number) => Math.round(n * 100) / 100;
const vacia = (id: string | null): MetricasTracto => ({ id, litros: 0, costoCombustible: 0, cargasSinCosto: 0, costoMantenimiento: 0, facturas: 0, montoFacturas: 0, viajes: 0, km: 0, facturacion: 0 });

export function metricasPorTracto(
  desde: string, hasta: string,
  viajes: ViajeGan[], cargas: Carga[], servicios: ServicioGan[], viajesKm: ViajeRend[], viajesFact: ViajeFactura[],
): MetricasResultado {
  const p: Periodo = { desde, hasta };
  const m = new Map<string | null, MetricasTracto>();
  const get = (id: string | null) => { let f = m.get(id); if (!f) { f = vacia(id); m.set(id, f); } return f; };

  for (const g of gananciaPorTracto(viajes, cargas, servicios, p)) {
    const f = get(g.id);
    f.viajes = g.viajes; f.facturacion = g.facturacion; f.costoCombustible = g.combustible;
    f.costoMantenimiento = g.mantenimiento; f.cargasSinCosto = g.cargasSinCosto;
  }
  for (const c of cargas) if (enPeriodo(c.fecha, p)) get(c.tracto_id).litros += Number(c.litros ?? 0);
  for (const v of viajesKm) if (enPeriodo(v.fecha_viaje, p)) get(v.tracto_id).km += Number(v.km);

  const porTracto = new Map<string | null, Map<string, number>>();
  const todas = new Map<string, number>();
  for (const v of viajesFact) {
    if (!v.factura_id || !enPeriodo(v.fecha_viaje, p)) continue;
    const total = Number(v.factura_total ?? 0);
    const set = porTracto.get(v.tracto_id) ?? new Map<string, number>();
    set.set(v.factura_id, total); porTracto.set(v.tracto_id, set);
    todas.set(v.factura_id, total);
  }
  for (const [id, set] of porTracto) {
    const f = get(id);
    f.facturas = set.size; f.montoFacturas = [...set.values()].reduce((a, b) => a + b, 0);
  }

  const filas = [...m.values()].map((f) => ({
    ...f, litros: r2(f.litros), km: Math.round(f.km), costoCombustible: r2(f.costoCombustible),
    costoMantenimiento: r2(f.costoMantenimiento), montoFacturas: r2(f.montoFacturas), facturacion: r2(f.facturacion),
  })).sort((a, b) => b.facturacion - a.facturacion);

  const total = vacia(null);
  for (const f of filas) {
    total.litros += f.litros; total.costoCombustible += f.costoCombustible; total.cargasSinCosto += f.cargasSinCosto;
    total.costoMantenimiento += f.costoMantenimiento; total.viajes += f.viajes; total.km += f.km; total.facturacion += f.facturacion;
  }
  total.facturas = todas.size;                                   // distintas en toda la flota, sin duplicar facturas compartidas
  total.montoFacturas = r2([...todas.values()].reduce((a, b) => a + b, 0));
  total.litros = r2(total.litros); total.costoCombustible = r2(total.costoCombustible);
  total.costoMantenimiento = r2(total.costoMantenimiento); total.facturacion = r2(total.facturacion);
  return { filas, total };
}

export type ClaveMetrica = "litros" | "costoCombustible" | "costoMantenimiento" | "facturas" | "montoFacturas" | "viajes" | "km";
export const METRICAS: { clave: ClaveMetrica; label: string; tipo: "num" | "mxn" | "km" | "litros" }[] = [
  { clave: "litros", label: "Combustible (litros)", tipo: "litros" },
  { clave: "costoCombustible", label: "Costo de combustible", tipo: "mxn" },
  { clave: "costoMantenimiento", label: "Costo de mantenimiento", tipo: "mxn" },
  { clave: "facturas", label: "Facturas", tipo: "num" },
  { clave: "montoFacturas", label: "Monto de facturas", tipo: "mxn" },
  { clave: "viajes", label: "Viajes", tipo: "num" },
  { clave: "km", label: "Kilómetros recorridos", tipo: "km" },
];
