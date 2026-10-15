/**
 * Ganancia por tracto y por chofer en un año:
 *   ganancia = facturación (subtotal, antes de IVA, de los viajes) − combustible − mantenimiento − comisiones.
 * Combustible: costo de las cargas (el chofer de cada carga sale de choferDeCarga). Mantenimiento: servicios de tractocamión.
 * Comisión: tasa del viaje (tarifa, cliente o 12 %) sobre su subtotal. Las góndolas no se incluyen (no están ligadas a un tracto).
 */
import { choferDeCarga, type Asignaciones, type Carga, type ViajeRend } from "./combustible.ts";
import { comisionDe, TASA_GENERAL } from "./comisiones.ts";

export interface ViajeGan { viaje_id: string; chofer_id: string | null; tracto_id: string | null; fecha_viaje: string; subtotal: number; tasa_comision?: number | null }
export interface ServicioGan { tracto_id: string | null; fecha: string; costo: number }

export interface FilaGanancia {
  id: string | null;                   // tracto_id o chofer_id; null = viajes sin tracto / sin chofer
  viajes: number;
  facturacion: number; combustible: number; mantenimiento: number; comisiones: number;
  ganancia: number;
  margen: number | null;               // ganancia / facturación; null sin facturación
  cargasSinCosto: number;              // cargas del año sin costo capturado (cuentan 0)
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const delAnio = (f: string, anio: number) => f.slice(0, 4) === String(anio);
const tasa = (v: ViajeGan) => (v.tasa_comision == null ? TASA_GENERAL : Number(v.tasa_comision));

function fila(id: string | null): FilaGanancia {
  return { id, viajes: 0, facturacion: 0, combustible: 0, mantenimiento: 0, comisiones: 0, ganancia: 0, margen: null, cargasSinCosto: 0 };
}

function cerrar(m: Map<string | null, FilaGanancia>): FilaGanancia[] {
  for (const f of m.values()) {
    f.facturacion = r2(f.facturacion); f.combustible = r2(f.combustible); f.mantenimiento = r2(f.mantenimiento); f.comisiones = r2(f.comisiones);
    f.ganancia = r2(f.facturacion - f.combustible - f.mantenimiento - f.comisiones);
    f.margen = f.facturacion > 0 ? f.ganancia / f.facturacion : null;
  }
  return [...m.values()].sort((a, b) => b.ganancia - a.ganancia);
}

/** Ganancia por tracto: sus viajes, sus cargas y sus servicios del año. Los viajes sin tracto van en la fila null. */
export function gananciaPorTracto(viajes: ViajeGan[], cargas: Carga[], servicios: ServicioGan[], anio: number): FilaGanancia[] {
  const m = new Map<string | null, FilaGanancia>();
  const get = (id: string | null) => { let f = m.get(id); if (!f) { f = fila(id); m.set(id, f); } return f; };
  for (const v of viajes) {
    if (!delAnio(v.fecha_viaje, anio)) continue;
    const f = get(v.tracto_id);
    f.viajes += 1; f.facturacion += Number(v.subtotal); f.comisiones += comisionDe(v.subtotal, tasa(v));
  }
  for (const c of cargas) {
    if (!delAnio(c.fecha, anio)) continue;
    const f = get(c.tracto_id);
    f.combustible += Number(c.costo ?? 0);
    if (c.costo == null) f.cargasSinCosto += 1;
  }
  for (const s of servicios) {
    if (!s.tracto_id || !delAnio(s.fecha, anio)) continue;
    get(s.tracto_id).mantenimiento += Number(s.costo);
  }
  return cerrar(m);
}

/**
 * Ganancia por chofer: sus viajes (facturación y comisión), el combustible de las cargas que se le atribuyen y la parte del
 * mantenimiento de cada tracto que le toca según su participación en la facturación de ese tracto en el año.
 */
export function gananciaPorChofer(
  viajes: ViajeGan[], cargas: Carga[], servicios: ServicioGan[], anio: number,
  historial: ViajeRend[] = [], asignados: Asignaciones = new Map(),
): FilaGanancia[] {
  const m = new Map<string | null, FilaGanancia>();
  const get = (id: string | null) => { let f = m.get(id); if (!f) { f = fila(id); m.set(id, f); } return f; };
  const factTracto = new Map<string, number>();
  const factChoferTracto = new Map<string, Map<string | null, number>>();
  for (const v of viajes) {
    if (!delAnio(v.fecha_viaje, anio)) continue;
    const f = get(v.chofer_id);
    f.viajes += 1; f.facturacion += Number(v.subtotal); f.comisiones += comisionDe(v.subtotal, tasa(v));
    if (v.tracto_id) {
      factTracto.set(v.tracto_id, (factTracto.get(v.tracto_id) ?? 0) + Number(v.subtotal));
      const por = factChoferTracto.get(v.tracto_id) ?? new Map<string | null, number>();
      por.set(v.chofer_id, (por.get(v.chofer_id) ?? 0) + Number(v.subtotal));
      factChoferTracto.set(v.tracto_id, por);
    }
  }
  for (const c of cargas) {
    if (!delAnio(c.fecha, anio)) continue;
    const f = get(choferDeCarga(c, historial, asignados));
    f.combustible += Number(c.costo ?? 0);
    if (c.costo == null) f.cargasSinCosto += 1;
  }
  for (const s of servicios) {
    if (!s.tracto_id || !delAnio(s.fecha, anio)) continue;
    const total = factTracto.get(s.tracto_id) ?? 0;
    const por = factChoferTracto.get(s.tracto_id);
    if (!por || total <= 0) { get(null).mantenimiento += Number(s.costo); continue; }   // sin facturación del tracto: no hay a quién prorratear
    for (const [chofer, fact] of por) get(chofer).mantenimiento += Number(s.costo) * (fact / total);
  }
  return cerrar(m);
}

/** Años con viajes, cargas o servicios, del más reciente al más antiguo; siempre incluye el año en curso. */
export function aniosDisponibles(fechas: string[], actual: number): number[] {
  const s = new Set<number>([actual]);
  for (const f of fechas) { const y = Number(f.slice(0, 4)); if (y > 2000) s.add(y); }
  return [...s].sort((a, b) => b - a);
}
