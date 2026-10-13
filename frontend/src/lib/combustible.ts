/** Cargas de combustible (diésel, litros) y rendimiento de choferes. */

export interface Carga {
  id: string; empresa_id: string; tracto_id: string; chofer_id: string | null;
  fecha: string;                       // YYYY-MM-DD
  litros: number; costo: number | null; kilometraje: number | null;
  estacion: string | null; notas: string | null;
}

export interface ViajeRend { viaje_id: string; chofer_id: string | null; tracto_id: string | null; fecha_viaje: string; km: number }

/** Tramo entre dos cargas consecutivas (con odómetro) del mismo tracto. */
export interface Tramo {
  tractoId: string; choferId: string | null;
  desde: string; hasta: string;        // fechas de la carga anterior y de la carga que cierra el tramo
  kmOdometro: number;                  // odómetro final - odómetro inicial
  kmCartaPorte: number;                // km de los viajes del tracto con fecha en (desde, hasta]
  litros: number;                      // litros de la carga que cierra el tramo (tanque lleno a tanque lleno)
}

export interface RendChofer {
  choferId: string | null;
  cargas: number; litros: number; costo: number;
  cargasSinOdometro: number;           // cuentan en litros/costo pero no en km/l
  tramos: Tramo[];
  kmOdometro: number; litrosTramos: number; kmCartaPorte: number;
  kmPorLitro: number | null;           // odómetro; null si no hay ningún tramo calculable
  kmPorLitroCp: number | null;         // km de Carta Porte
  viajes: number; litrosPorViaje: number | null; viajesPorCarga: number | null;
}

const cmp = (a: Carga, b: Carga) =>
  a.fecha.localeCompare(b.fecha) || (a.kilometraje ?? 0) - (b.kilometraje ?? 0) || a.id.localeCompare(b.id);

/**
 * Chofer de una carga: el que se capturó; si no, el del último viaje del tracto con fecha <= la de la carga
 * (el tracto lo traía él); si no hay viajes previos, null ("sin chofer").
 */
export function choferDeCarga(c: Carga, viajes: ViajeRend[]): string | null {
  if (c.chofer_id) return c.chofer_id;
  let mejor: ViajeRend | null = null;
  for (const v of viajes) {
    if (v.tracto_id !== c.tracto_id || !v.chofer_id || v.fecha_viaje > c.fecha) continue;
    if (!mejor || v.fecha_viaje > mejor.fecha_viaje) mejor = v;
  }
  return mejor?.chofer_id ?? null;
}

/**
 * Tramos por tracto: pares consecutivos de cargas CON odómetro (las cargas sin odómetro se saltan, no se adivinan).
 * Se asume tanque lleno en cada carga: los litros del tramo son los de la carga que lo cierra. Un tramo con
 * odómetro que no avanza se descarta.
 */
export function tramos(cargas: Carga[], viajes: ViajeRend[]): Tramo[] {
  const porTracto = new Map<string, Carga[]>();
  for (const c of cargas) if (c.kilometraje != null) porTracto.set(c.tracto_id, [...(porTracto.get(c.tracto_id) ?? []), c]);
  const out: Tramo[] = [];
  for (const [tractoId, lista] of porTracto) {
    lista.sort((a, b) => (a.kilometraje! - b.kilometraje!) || cmp(a, b));
    for (let i = 1; i < lista.length; i++) {
      const a = lista[i - 1], b = lista[i];
      const kmOdo = b.kilometraje! - a.kilometraje!;
      if (kmOdo <= 0) continue;
      const kmCp = viajes
        .filter((v) => v.tracto_id === tractoId && v.fecha_viaje > a.fecha && v.fecha_viaje <= b.fecha)
        .reduce((s, v) => s + Number(v.km), 0);
      out.push({ tractoId, choferId: choferDeCarga(b, viajes), desde: a.fecha, hasta: b.fecha, kmOdometro: kmOdo, kmCartaPorte: kmCp, litros: Number(b.litros) });
    }
  }
  return out;
}

/**
 * Rendimiento por chofer en un rango (inclusive; vacío = sin límite). Se pasan TODAS las cargas e historial de
 * viajes: el rango filtra después, para que el primer tramo del periodo no pierda su carga de referencia.
 * Un tramo cuenta en el rango según la fecha de la carga que lo cierra.
 */
export function rendimientoPorChofer(cargas: Carga[], viajes: ViajeRend[], desde: string, hasta: string): RendChofer[] {
  const enRango = (f: string) => (!desde || f >= desde) && (!hasta || f <= hasta);
  const mapa = new Map<string | null, RendChofer>();
  const get = (id: string | null) => {
    let r = mapa.get(id);
    if (!r) {
      r = { choferId: id, cargas: 0, litros: 0, costo: 0, cargasSinOdometro: 0, tramos: [], kmOdometro: 0, litrosTramos: 0, kmCartaPorte: 0,
        kmPorLitro: null, kmPorLitroCp: null, viajes: 0, litrosPorViaje: null, viajesPorCarga: null };
      mapa.set(id, r);
    }
    return r;
  };
  for (const c of cargas) {
    if (!enRango(c.fecha)) continue;
    const r = get(choferDeCarga(c, viajes));
    r.cargas += 1; r.litros += Number(c.litros); r.costo += Number(c.costo ?? 0);
    if (c.kilometraje == null) r.cargasSinOdometro += 1;
  }
  for (const t of tramos(cargas, viajes)) {
    if (!enRango(t.hasta)) continue;
    const r = get(t.choferId);
    r.tramos.push(t); r.kmOdometro += t.kmOdometro; r.litrosTramos += t.litros; r.kmCartaPorte += t.kmCartaPorte;
  }
  for (const v of viajes) {
    if (!v.chofer_id || !enRango(v.fecha_viaje)) continue;
    if (mapa.has(v.chofer_id)) mapa.get(v.chofer_id)!.viajes += 1;   // solo choferes con cargas en el rango
  }
  for (const r of mapa.values()) {
    if (r.litrosTramos > 0) {
      r.kmPorLitro = r.kmOdometro / r.litrosTramos;
      r.kmPorLitroCp = r.kmCartaPorte / r.litrosTramos;
    }
    if (r.litros > 0 && r.viajes > 0) r.litrosPorViaje = r.litros / r.viajes;
    if (r.cargas > 0 && r.choferId) r.viajesPorCarga = r.viajes / r.cargas;
    r.tramos.sort((a, b) => b.hasta.localeCompare(a.hasta));
  }
  return [...mapa.values()].sort((a, b) => (b.kmPorLitro ?? -1) - (a.kmPorLitro ?? -1) || b.litros - a.litros);
}
