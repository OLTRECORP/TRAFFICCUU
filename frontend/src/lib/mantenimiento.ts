import type { Bitacora, Regla, ServicioMant, Tracto } from "./types";

export type Nivel = "rojo" | "amarillo" | "verde";

/** Desde qué fracción del intervalo se avisa en amarillo. */
export const UMBRAL_AVISO = 0.9;

/** Avance de un intervalo (km o días) desde el último servicio. */
export interface Medida {
  usado: number;        // km recorridos o días transcurridos
  intervalo: number;
  restante: number;     // negativo = excedido
  porcentaje: number;   // 0..100+ del intervalo consumido
  nivel: Nivel;
}

export interface UltimoServicio { fecha: string; km: number | null; servicio: string }

export interface Alerta {
  regla: Regla;
  nivel: Nivel;          // el peor entre km y días
  porcentaje: number;    // el más avanzado entre km y días
  km: Medida | null;     // null si la regla no tiene intervalo en km
  dias: Medida | null;   // null si no tiene intervalo en días o nunca se ha hecho el servicio
  ultimo: UltimoServicio | null;
  sinRegistro: boolean;  // nunca se registró: los km cuentan desde el kilometraje inicial
}

/** Rojo: llegó al intervalo. Amarillo: 90 % o más. Verde: resto. */
export function nivelDe(usado: number, intervalo: number): Nivel {
  if (usado >= intervalo) return "rojo";
  if (usado >= intervalo * UMBRAL_AVISO) return "amarillo";
  return "verde";
}

const PESO: Record<Nivel, number> = { rojo: 2, amarillo: 1, verde: 0 };
const peor = (a: Nivel, b: Nivel): Nivel => (PESO[a] >= PESO[b] ? a : b);

function medida(usado: number, intervalo: number): Medida {
  return { usado, intervalo, restante: intervalo - usado, porcentaje: (usado / intervalo) * 100, nivel: nivelDe(usado, intervalo) };
}

const DIA = 86_400_000;
const diasEntre = (desde: string, hasta: string) =>
  Math.max(0, Math.round((Date.parse(`${hasta.slice(0, 10)}T00:00:00Z`) - Date.parse(`${desde.slice(0, 10)}T00:00:00Z`)) / DIA));

/**
 * Último servicio de una regla en un tracto: el registrado para esa regla (bitácora de servicios con regla_id o el
 * registro de la regla) o, si su rubro tiene una sola regla, cualquier servicio de ese rubro. El más reciente gana.
 */
export function ultimoServicio(tracto: Tracto, regla: Regla, reglas: Regla[], servicios: ServicioMant[], bitacora: Bitacora[]): UltimoServicio | null {
  const unicaDelRubro = !!regla.categoria && reglas.filter((r) => r.categoria === regla.categoria).length === 1;
  const cands: UltimoServicio[] = [
    ...servicios
      .filter((s) => s.tracto_id === tracto.id && (s.regla_id === regla.id || (!s.regla_id && unicaDelRubro && s.categoria === regla.categoria)))
      .map((s) => ({ fecha: s.fecha, km: s.kilometraje == null ? null : Number(s.kilometraje), servicio: s.servicio })),
    ...bitacora
      .filter((b) => b.tracto_id === tracto.id && b.servicio_id === regla.id)
      .map((b) => ({ fecha: b.fecha, km: Number(b.kilometraje_al_servicio), servicio: regla.tipo_servicio })),
  ];
  return cands.sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.km ?? 0) - (a.km ?? 0))[0] ?? null;
}

/** Estado de cada servicio programado del tracto. `hoy` en YYYY-MM-DD. */
export function calcularAlertas(tracto: Tracto, reglas: Regla[], bitacora: Bitacora[], servicios: ServicioMant[] = [], hoy = new Date().toISOString().slice(0, 10)): Alerta[] {
  return reglas.map((regla) => {
    const ultimo = ultimoServicio(tracto, regla, reglas, servicios, bitacora);
    const baseKm = ultimo?.km ?? (ultimo ? null : Number(tracto.kilometraje_inicial));
    const km = regla.intervalo_km && baseKm != null
      ? medida(Math.max(0, Number(tracto.kilometraje_actual) - baseKm), Number(regla.intervalo_km)) : null;
    const dias = regla.intervalo_dias && ultimo ? medida(diasEntre(ultimo.fecha, hoy), Number(regla.intervalo_dias)) : null;
    const medidas = [km, dias].filter(Boolean) as Medida[];
    return {
      regla, km, dias, ultimo, sinRegistro: !ultimo,
      nivel: medidas.reduce<Nivel>((n, m) => peor(n, m.nivel), "verde"),
      porcentaje: Math.max(0, ...medidas.map((m) => m.porcentaje)),
    };
  });
}

export const peorNivel = (a: Alerta[]): Nivel => a.reduce<Nivel>((w, x) => peor(w, x.nivel), "verde");

/** Texto corto de lo que falta: «faltan 3,200 km · 25 días» o «excedido 800 km». */
export function textoRestante(a: Alerta, fmtKm: (n: number) => string): string {
  const partes: string[] = [];
  if (a.km) partes.push(a.km.restante >= 0 ? `faltan ${fmtKm(a.km.restante)}` : `excedido ${fmtKm(-a.km.restante)}`);
  if (a.dias) partes.push(a.dias.restante >= 0 ? `${a.dias.restante} días` : `vencido hace ${-a.dias.restante} días`);
  if (!partes.length) return a.regla.intervalo_dias && !a.ultimo ? "sin servicio registrado" : "—";
  return partes.join(" · ");
}
