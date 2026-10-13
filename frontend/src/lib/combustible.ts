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
  litros: number | null;               // litros de la carga que cierra el tramo (tanque lleno a tanque lleno); null si no se capturaron
}

export interface RendChofer {
  choferId: string | null;
  cargas: number; litros: number; costo: number;
  cargasSinLitros: number;             // cuentan en tramos (km y viajes) pero no en km/l
  tramos: Tramo[];
  km: number; viajesTramos: number;    // de todos los tramos del rango
  kmConLitros: number; litrosTramos: number;   // solo tramos con litros: base del km/l
  kmPorLitro: number | null;           // null si ningún tramo tiene litros
  viajes: number; litrosPorViaje: number | null; viajesPorCarga: number | null;
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

/**
 * Tramos por tracto: pares consecutivos de cargas ordenadas por fecha (dos cargas el mismo día no forman tramo).
 * Se asume tanque lleno en cada carga: los litros del tramo son los de la carga que lo cierra. La primera carga
 * de un tracto solo marca el inicio del primer tramo.
 */
export function tramos(cargas: Carga[], viajes: ViajeRend[], asignados: Asignaciones = new Map()): Tramo[] {
  const porTracto = new Map<string, Carga[]>();
  for (const c of cargas) porTracto.set(c.tracto_id, [...(porTracto.get(c.tracto_id) ?? []), c]);
  const out: Tramo[] = [];
  for (const [tractoId, lista] of porTracto) {
    lista.sort(cmp);
    const delTracto = viajes.filter((v) => v.tracto_id === tractoId);
    for (let i = 1; i < lista.length; i++) {
      const a = lista[i - 1], b = lista[i];
      if (b.fecha <= a.fecha) continue;
      const enTramo = delTracto.filter((v) => v.fecha_viaje > a.fecha && v.fecha_viaje <= b.fecha);
      out.push({
        tractoId, choferId: choferDeCarga(b, viajes, asignados), desde: a.fecha, hasta: b.fecha,
        km: enTramo.reduce((t, v) => t + Number(v.km), 0), viajes: enTramo.length,
        litros: b.litros == null ? null : Number(b.litros),
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
        kmPorLitro: null, viajes: 0, litrosPorViaje: null, viajesPorCarga: null };
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
    if (mapa.has(v.chofer_id)) mapa.get(v.chofer_id)!.viajes += 1;   // solo choferes con cargas en el rango
  }
  for (const r of mapa.values()) {
    if (r.litrosTramos > 0) r.kmPorLitro = r.kmConLitros / r.litrosTramos;
    if (r.litros > 0 && r.viajes > 0) r.litrosPorViaje = r.litros / r.viajes;
    if (r.cargas > 0 && r.choferId) r.viajesPorCarga = r.viajes / r.cargas;
    r.tramos.sort((a, b) => b.hasta.localeCompare(a.hasta));
  }
  return [...mapa.values()].sort((a, b) => (b.kmPorLitro ?? -1) - (a.kmPorLitro ?? -1) || b.litros - a.litros);
}
