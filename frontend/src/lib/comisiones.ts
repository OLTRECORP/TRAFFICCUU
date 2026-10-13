/** Comisión del chofer: 12 % del subtotal de la factura (antes de IVA) de cada viaje. */
export const TASA_COMISION = 0.12;

export interface ViajeComision {
  viaje_id: string; chofer_id: string; folio: string | null; fecha_viaje: string;   // YYYY-MM-DD
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
const parse = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return Date.UTC(y, m - 1, dd); };
const dia = (t: number) => { const d = new Date(t); return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`; };

/** Semana ISO 8601: inicia en lunes; la semana 1 es la que contiene el primer jueves del año. */
export function semanaIso(fecha: string) {
  const t = parse(fecha);
  const lunes = t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000;
  const jueves = lunes + 3 * 86400000;
  const anio = new Date(jueves).getUTCFullYear();
  const semana = Math.floor((jueves - Date.UTC(anio, 0, 1)) / (7 * 86400000)) + 1;
  return { anio, semana, lunes, domingo: lunes + 6 * 86400000 };
}

function clave(fecha: string, p: Periodo): { clave: string; etiqueta: string } {
  if (p === "anio") return { clave: fecha.slice(0, 4), etiqueta: fecha.slice(0, 4) };
  if (p === "mes") {
    const m = Number(fecha.slice(5, 7));
    return { clave: fecha.slice(0, 7), etiqueta: `${MESES[m - 1]} ${fecha.slice(0, 4)}` };
  }
  const s = semanaIso(fecha);
  return {
    clave: `${s.anio}-W${String(s.semana).padStart(2, "0")}`,
    etiqueta: `Sem ${s.semana} · ${dia(s.lunes)} – ${dia(s.domingo)} ${new Date(s.domingo).getUTCFullYear()}`,
  };
}

/** Viajes y comisión por mes, semana ISO o año; el más reciente primero. */
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
