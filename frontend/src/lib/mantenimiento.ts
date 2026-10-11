import type { Bitacora, Regla, Tracto } from "./types";

export type Nivel = "rojo" | "amarillo" | "verde";

export interface Alerta {
  regla: Regla;
  nivel: Nivel;
  recorrido: number;        // km desde el último servicio
  restante: number;         // km que faltan (negativo = excedido)
  porcentaje: number;       // 0..100+ del intervalo consumido
  kmUltimoServicio: number;
  sinRegistro: boolean;     // true si nunca se ha registrado: se usa kilometraje_inicial como base
}

/** Rojo: >= intervalo. Amarillo: >= 90% del intervalo. Verde: resto. */
export function nivelDe(recorrido: number, intervalo: number): Nivel {
  if (recorrido >= intervalo) return "rojo";
  if (recorrido >= intervalo * 0.9) return "amarillo";
  return "verde";
}

export function calcularAlertas(tracto: Tracto, reglas: Regla[], bitacora: Bitacora[]): Alerta[] {
  return reglas.map((regla) => {
    const previos = bitacora.filter((b) => b.tracto_id === tracto.id && b.servicio_id === regla.id);
    const sinRegistro = previos.length === 0;
    const base = sinRegistro
      ? Number(tracto.kilometraje_inicial)
      : Math.max(...previos.map((b) => Number(b.kilometraje_al_servicio)));
    const recorrido = Math.max(0, Number(tracto.kilometraje_actual) - base);
    return {
      regla,
      nivel: nivelDe(recorrido, regla.intervalo_km),
      recorrido,
      restante: regla.intervalo_km - recorrido,
      porcentaje: (recorrido / regla.intervalo_km) * 100,
      kmUltimoServicio: base,
      sinRegistro,
    };
  });
}

const PESO: Record<Nivel, number> = { rojo: 2, amarillo: 1, verde: 0 };
export const peorNivel = (a: Alerta[]): Nivel =>
  a.reduce<Nivel>((w, x) => (PESO[x.nivel] > PESO[w] ? x.nivel : w), "verde");
