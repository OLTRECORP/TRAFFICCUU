/** Comisión del chofer: % del subtotal (antes de IVA) de cada viaje. La tasa viene por viaje (vista comisiones_viajes):
 *  la excepción de la ruta (tarifa), la del cliente (p. ej. La Purísima 11 %) o la general del 12 %. */
export const TASA_GENERAL = 12;

export interface ViajeComision {
  viaje_id: string; chofer_id: string | null; folio: string | null; fecha_viaje: string;   // YYYY-MM-DD
  subtotal: number; origen: string | null; destino: string | null; cliente: string | null;
  tasa_comision?: number | null;      // % aplicado a este viaje; sin dato = 12 %
  remision?: string | null;           // viajes del Excel de remisiones (sin XML)
}

export type Periodo = "mes" | "semana" | "anio";

export interface FilaEstadistica { clave: string; etiqueta: string; viajes: number; subtotal: number; comision: number; detalle: ViajeComision[] }

export const tasaDe = (v: Pick<ViajeComision, "tasa_comision">) => (v.tasa_comision == null ? TASA_GENERAL : Number(v.tasa_comision));

export const comisionDe = (subtotal: number, tasa: number = TASA_GENERAL) => Math.round(Number(subtotal) * tasa) / 100;

/** Comisión de un viaje con su propia tasa. */
export const comisionViaje = (v: Pick<ViajeComision, "subtotal" | "tasa_comision">) => comisionDe(v.subtotal, tasaDe(v));

/** «12 %» si todos los viajes llevan la misma tasa; «10–12 %» si varían. */
export function etiquetaTasas(v: Pick<ViajeComision, "tasa_comision">[]): string {
  const t = [...new Set(v.map(tasaDe))].sort((a, b) => a - b);
  if (!t.length) return `${TASA_GENERAL} %`;
  return t.length === 1 ? `${t[0]} %` : `${t[0]}–${t[t.length - 1]} %`;
}

export const totales = (v: ViajeComision[]) => {
  const subtotal = v.reduce((s, x) => s + Number(x.subtotal), 0);
  // Suma de comisiones por viaje, para que el total coincida con el detalle
  const comision = v.reduce((s, x) => s + comisionViaje(x), 0);
  return { viajes: v.length, subtotal, comision: Math.round(comision * 100) / 100 };
};

/** Lo contabilizado en un conjunto de viajes: viajes, facturas distintas (por folio), subtotal y comisión. */
export interface Contabilizado { viajes: number; facturas: number; subtotal: number; comision: number }

export const contabilizados = (v: ViajeComision[]): Contabilizado => ({
  ...totales(v),
  facturas: new Set(v.map((x) => x.folio ?? x.viaje_id)).size,
});

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DIA_MS = 86400000;
const parse = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return Date.UTC(y, m - 1, dd); };
const dia = (t: number) => { const d = new Date(t); return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`; };
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Semana de pago: de viernes a jueves. Lo trabajado en la semana se paga el viernes siguiente al cierre
 * (el viernes que sigue al jueves final), así que cada viaje cae en la semana que inicia el viernes anterior o igual a su fecha.
 */
export interface SemanaPago { desde: string; hasta: string; pago: string }   // YYYY-MM-DD: viernes, jueves y viernes de pago

export function semanaPago(fecha: string): SemanaPago {
  const t = parse(fecha);
  const inicio = t - ((new Date(t).getUTCDay() - 5 + 7) % 7) * DIA_MS;   // viernes (día 5) de esa semana
  return { desde: iso(inicio), hasta: iso(inicio + 6 * DIA_MS), pago: iso(inicio + 7 * DIA_MS) };
}

/** Semana de pago `delta` semanas antes (negativo) o después (positivo) de la que contiene `fecha`. */
export const semanaPagoDesplazada = (fecha: string, delta: number) => semanaPago(iso(parse(fecha) + delta * 7 * DIA_MS));

/** Etiqueta legible: «vie 9 oct – jue 15 oct 2026 · pago vie 16 oct». */
export function etiquetaSemanaPago(s: SemanaPago) {
  const f = (d: string) => `${DIAS[new Date(parse(d)).getUTCDay()]} ${dia(parse(d))}`;
  return `${f(s.desde)} – ${f(s.hasta)} ${s.hasta.slice(0, 4)} · pago ${f(s.pago)}`;
}

function clave(fecha: string, p: Periodo): { clave: string; etiqueta: string } {
  if (p === "anio") return { clave: fecha.slice(0, 4), etiqueta: fecha.slice(0, 4) };
  if (p === "mes") {
    const m = Number(fecha.slice(5, 7));
    return { clave: fecha.slice(0, 7), etiqueta: `${MESES[m - 1]} ${fecha.slice(0, 4)}` };
  }
  const s = semanaPago(fecha);
  return { clave: s.desde, etiqueta: etiquetaSemanaPago(s) };
}

/** Viajes y comisión por mes, semana de pago (viernes a jueves) o año; el más reciente primero. */
export function estadisticas(viajes: ViajeComision[], p: Periodo): FilaEstadistica[] {
  const mapa = new Map<string, FilaEstadistica>();
  for (const v of viajes) {
    const { clave: k, etiqueta } = clave(v.fecha_viaje, p);
    const f = mapa.get(k) ?? { clave: k, etiqueta, viajes: 0, subtotal: 0, comision: 0, detalle: [] };
    f.viajes += 1; f.subtotal += Number(v.subtotal); f.comision += comisionViaje(v); f.detalle.push(v);
    mapa.set(k, f);
  }
  return [...mapa.values()].sort((a, b) => b.clave.localeCompare(a.clave));
}
