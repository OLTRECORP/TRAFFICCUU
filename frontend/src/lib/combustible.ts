/** Cargas de combustible (diésel, litros) y rendimiento de choferes. */

export interface Carga {
  id: string; empresa_id: string; tracto_id: string; chofer_id: string | null;
  fecha: string;                       // YYYY-MM-DD
  litros: number | null; costo: number | null; kilometraje: number | null;   // kilometraje: dato histórico, ya no se captura
  estacion: string | null; notas: string | null;
}

export interface ViajeRend { viaje_id: string; chofer_id: string | null; tracto_id: string | null; fecha_viaje: string; km: number }

/**
 * Tramo entre dos cargas consecutivas (por fecha) del mismo tracto. No requiere odómetro: los km y viajes salen
 * de los viajes (Carta Porte) del tracto con fecha en (desde, hasta].
 */
export interface Tramo {
  tractoId: string; choferId: string | null;
  desde: string; hasta: string;        // fechas de la carga anterior y de la carga que cierra el tramo
  km: number;                          // km (redondo) de los viajes del tracto en el tramo
  viajes: number;                      // viajes del tracto en el tramo
  litros: number | null;               // litros del día que cierra el tramo (suma de todas sus cargas); null si ninguna tiene litros
  cargas: number;                      // cargas de ese día (2 o más se suman como una sola)
}

export interface RendChofer {
  choferId: string | null;
  cargas: number; litros: number; costo: number;
  cargasSinLitros: number;             // cuentan en tramos (km y viajes) pero no en km/l
  tramos: Tramo[];
  km: number; viajesTramos: number;    // de todos los tramos del rango
  kmConLitros: number; litrosTramos: number;   // solo tramos con litros: base del km/l
  kmPorLitro: number | null;           // null si ningún tramo tiene litros
  viajes: number;                      // viajes del rango (todos los del chofer, con o sin cargas)
  kmViajes: number;                    // km (redondo, del mapa) de TODOS sus viajes del rango, estén o no entre cargas
  litrosPorViaje: number | null; viajesPorCarga: number | null;
}

const cmp = (a: Carga, b: Carga) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id);

/** tracto_id -> chofer_id con asignación fija (choferes.tracto_asignado_id). */
export type Asignaciones = Map<string, string>;

/**
 * Chofer de una carga: el que se capturó; si no, el asignado al tracto; si no, el del último viaje del tracto con fecha <= la de la carga
 * (el tracto lo traía él); si no hay viajes previos, null ("sin chofer").
 */
export function choferDeCarga(c: Carga, viajes: ViajeRend[], asignados: Asignaciones = new Map()): string | null {
  if (c.chofer_id) return c.chofer_id;
  const fijo = asignados.get(c.tracto_id);
  if (fijo) return fijo;
  let mejor: ViajeRend | null = null;
  for (const v of viajes) {
    if (v.tracto_id !== c.tracto_id || !v.chofer_id || v.fecha_viaje > c.fecha) continue;
    if (!mejor || v.fecha_viaje > mejor.fecha_viaje) mejor = v;
  }
  return mejor?.chofer_id ?? null;
}

/** Cargas de un mismo tracto en un mismo día, sumadas como una sola. */
export interface DiaCarga { fecha: string; litros: number | null; costo: number; cargas: Carga[] }

/** Agrupa por día (fecha) las cargas de UN tracto: 2 o más del mismo día se suman a ese día. */
export function cargasPorDia(lista: Carga[]): DiaCarga[] {
  const dias = new Map<string, DiaCarga>();
  for (const c of [...lista].sort(cmp)) {
    const d = dias.get(c.fecha) ?? { fecha: c.fecha, litros: null, costo: 0, cargas: [] };
    if (c.litros != null) d.litros = (d.litros ?? 0) + Number(c.litros);
    d.costo += Number(c.costo ?? 0);
    d.cargas.push(c);
    dias.set(c.fecha, d);
  }
  return [...dias.values()];
}

/**
 * Tramos por tracto: pares de días consecutivos con carga. Las cargas del mismo día se suman a ese día, y los km son
 * los de los viajes hasta el día de la siguiente carga. Se asume tanque lleno: los litros del tramo son los del día que
 * lo cierra. El primer día con carga de un tracto solo marca el inicio del primer tramo.
 */
export function tramos(cargas: Carga[], viajes: ViajeRend[], asignados: Asignaciones = new Map()): Tramo[] {
  const porTracto = new Map<string, Carga[]>();
  for (const c of cargas) porTracto.set(c.tracto_id, [...(porTracto.get(c.tracto_id) ?? []), c]);
  const out: Tramo[] = [];
  for (const [tractoId, lista] of porTracto) {
    const dias = cargasPorDia(lista);
    const delTracto = viajes.filter((v) => v.tracto_id === tractoId);
    for (let i = 1; i < dias.length; i++) {
      const a = dias[i - 1], b = dias[i];
      const enTramo = delTracto.filter((v) => v.fecha_viaje > a.fecha && v.fecha_viaje <= b.fecha);
      // Chofer del día: el de la primera carga del día que tenga uno.
      const choferId = b.cargas.map((c) => choferDeCarga(c, viajes, asignados)).find((id) => id != null) ?? null;
      out.push({
        tractoId, choferId, desde: a.fecha, hasta: b.fecha,
        km: enTramo.reduce((t, v) => t + Number(v.km), 0), viajes: enTramo.length,
        litros: b.litros, cargas: b.cargas.length,
      });
    }
  }
  return out;
}

/**
 * Rendimiento por chofer en un rango (inclusive; vacío = sin límite). Se pasan TODAS las cargas e historial de
 * viajes: el rango filtra después, para que el primer tramo del periodo no pierda su carga de referencia.
 * Un tramo cuenta en el rango según la fecha de la carga que lo cierra.
 */
export function rendimientoPorChofer(cargas: Carga[], viajes: ViajeRend[], desde: string, hasta: string, asignados: Asignaciones = new Map()): RendChofer[] {
  const enRango = (f: string) => (!desde || f >= desde) && (!hasta || f <= hasta);
  const mapa = new Map<string | null, RendChofer>();
  const get = (id: string | null) => {
    let r = mapa.get(id);
    if (!r) {
      r = { choferId: id, cargas: 0, litros: 0, costo: 0, cargasSinLitros: 0, tramos: [], km: 0, viajesTramos: 0, kmConLitros: 0, litrosTramos: 0,
        kmPorLitro: null, viajes: 0, kmViajes: 0, litrosPorViaje: null, viajesPorCarga: null };
      mapa.set(id, r);
    }
    return r;
  };
  for (const c of cargas) {
    if (!enRango(c.fecha)) continue;
    const r = get(choferDeCarga(c, viajes, asignados));
    r.cargas += 1; r.litros += Number(c.litros ?? 0); r.costo += Number(c.costo ?? 0);
    if (c.litros == null) r.cargasSinLitros += 1;
  }
  for (const t of tramos(cargas, viajes, asignados)) {
    if (!enRango(t.hasta)) continue;
    const r = get(t.choferId);
    r.tramos.push(t); r.km += t.km; r.viajesTramos += t.viajes;
    if (t.litros != null) { r.kmConLitros += t.km; r.litrosTramos += t.litros; }
  }
  for (const v of viajes) {
    if (!v.chofer_id || !enRango(v.fecha_viaje)) continue;
    const r = get(v.chofer_id);   // todos los viajes del rango entran, también los de choferes sin cargas y los previos a su primera carga
    r.viajes += 1; r.kmViajes += Number(v.km);
  }
  for (const r of mapa.values()) {
    if (r.litrosTramos > 0) r.kmPorLitro = r.kmConLitros / r.litrosTramos;
    if (r.litros > 0 && r.viajes > 0) r.litrosPorViaje = r.litros / r.viajes;
    if (r.cargas > 0 && r.choferId) r.viajesPorCarga = r.viajes / r.cargas;
    r.tramos.sort((a, b) => b.hasta.localeCompare(a.hasta));
  }
  return [...mapa.values()].sort((a, b) => (b.kmPorLitro ?? -1) - (a.kmPorLitro ?? -1) || b.litros - a.litros);
}
