/** Comisión del chofer: 12 % del subtotal de la factura (antes de IVA) de cada viaje. */
export const TASA_COMISION = 0.12;

export interface ViajeComision {
  viaje_id: string; chofer_id: string | null; folio: string | null; fecha_viaje: string;   // YYYY-MM-DD
  subtotal: number; origen: string | null; destino: string | null; cliente: string | null;
}

export type Periodo = "mes" | "semana" | "anio";

export interface FilaEstadistica { clave: string; etiqueta: string; viajes: number; subtotal: number; comision: number }

export const comisionDe = (subtotal: number) => Math.round(Number(subtotal) * TASA_COMISION * 100) / 100;

export const totales = (v: ViajeComision[]) => {
  const subtotal = v.reduce((s, x) => s + Number(x.subtotal), 0);
  // Suma de comisiones por viaje, para que el total coincida con el detalle
  const comision = v.reduce((s, x) => s + comisionDe(x.subtotal), 0);
  return { viajes: v.length, subtotal, comision: Math.round(comision * 100) / 100 };
};

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
    const f = mapa.get(k) ?? { clave: k, etiqueta, viajes: 0, subtotal: 0, comision: 0 };
    f.viajes += 1; f.subtotal += Number(v.subtotal); f.comision += comisionDe(v.subtotal);
    mapa.set(k, f);
  }
  return [...mapa.values()].sort((a, b) => b.clave.localeCompare(a.clave));
}
