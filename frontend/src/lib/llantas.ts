import type { Alerta, Nivel } from "./mantenimiento";

// Misma regla que nivelDe() de mantenimiento.ts (aquí sin importarla para que las pruebas carguen este archivo solo).
function nivelDe(usado: number, intervalo: number): Nivel {
  if (usado >= intervalo) return "rojo";
  if (usado >= intervalo * 0.9) return "amarillo";
  return "verde";
}

export type TipoUnidad = "tracto" | "gondola";

/** Llanta vigente con su avance (vista llantas_estado). */
export interface LlantaEstado {
  id: string; empresa_id: string; tracto_id: string | null; gondola_id: string | null; posicion: string;
  fecha_instalacion: string; km_instalacion: number | null; vida_km: number;
  marca: string | null; medida: string | null; numero_serie: string | null; costo: number; notas: string | null;
  servicio_id?: string | null;
  km_recorridos: number; dias: number; porcentaje: number;
}

export interface Posicion { codigo: string; eje: number; lado: "I" | "D"; doble: boolean; exterior: boolean }

/**
 * Posiciones por unidad. Tracto: eje 1 direccional con llanta sencilla, el resto de tracción con llantas dobles.
 * Góndola: todos los ejes con llantas dobles. Códigos: E1-I, E1-D, E2-IE (izq. exterior), E2-II, E2-DI, E2-DE.
 */
export function posiciones(tipo: TipoUnidad, ejes: number): Posicion[] {
  const out: Posicion[] = [];
  for (let e = 1; e <= ejes; e++) {
    if (tipo === "tracto" && e === 1) {
      out.push({ codigo: "E1-I", eje: 1, lado: "I", doble: false, exterior: true }, { codigo: "E1-D", eje: 1, lado: "D", doble: false, exterior: true });
    } else {
      out.push(
        { codigo: `E${e}-IE`, eje: e, lado: "I", doble: true, exterior: true }, { codigo: `E${e}-II`, eje: e, lado: "I", doble: true, exterior: false },
        { codigo: `E${e}-DI`, eje: e, lado: "D", doble: true, exterior: false }, { codigo: `E${e}-DE`, eje: e, lado: "D", doble: true, exterior: true },
      );
    }
  }
  return out;
}

export function etiquetaPosicion(codigo: string): string {
  const m = /^E(\d)-(I|D|IE|II|DI|DE)$/.exec(codigo);
  if (!m) return codigo;
  const lado = { I: "izquierda", D: "derecha", IE: "izquierda exterior", II: "izquierda interior", DI: "derecha interior", DE: "derecha exterior" }[m[2]];
  return `Eje ${m[1]} ${lado}`;
}

/**
 * Número de llanta en la unidad, de adelante hacia atrás y de izquierda a derecha (exterior → interior → interior →
 * exterior). Tracto: 1-2 direccionales, 3-6 eje 2, 7-10 eje 3… Góndola: 1-4 eje 1, 5-8 eje 2…
 */
export function numeroLlanta(tipo: TipoUnidad, codigo: string): number {
  const m = /^E(\d)-(I|D|IE|II|DI|DE)$/.exec(codigo);
  if (!m) return 0;
  const eje = Number(m[1]);
  if (tipo === "tracto" && eje === 1) return m[2] === "I" ? 1 : 2;
  const i = ["IE", "II", "DI", "DE"].indexOf(m[2]) + 1;
  return tipo === "tracto" ? 2 + (eje - 2) * 4 + i : (eje - 1) * 4 + i;
}

export const nombreLlanta = (tipo: TipoUnidad, codigo: string) => `Llanta ${numeroLlanta(tipo, codigo)} · ${etiquetaPosicion(codigo)}`;

/** «llantas 3, 4» / «llanta 7» */
export function listaLlantas(tipo: TipoUnidad, codigos: string[]): string {
  const n = codigos.map((c) => numeroLlanta(tipo, c)).sort((a, b) => a - b);
  return `${n.length === 1 ? "llanta" : "llantas"} ${n.join(", ")}`;
}

/** Reparte un costo entre n llantas en centavos, sin perder ni sobrar centavos. */
export function repartirCosto(total: number, n: number): number[] {
  if (n <= 0) return [];
  const c = Math.round(total * 100), base = Math.floor(c / n);
  return Array.from({ length: n }, (_, i) => (base + (i < c - base * n ? 1 : 0)) / 100);
}

export const nivelLlanta = (l: Pick<LlantaEstado, "km_recorridos" | "vida_km">): Nivel => nivelDe(Number(l.km_recorridos), Number(l.vida_km));

export interface ResumenLlantas { total: number; vencidas: number; proximas: number; bien: number; sinRegistro: number; recomendadas: number }

/** Cuántas llantas de la unidad conviene cambiar: vencidas (≥ 100 % de su vida) ahora; próximas (≥ 90 %) pronto. */
export function resumenLlantas(pos: Posicion[], llantas: LlantaEstado[]): ResumenLlantas {
  const r = { total: pos.length, vencidas: 0, proximas: 0, bien: 0, sinRegistro: 0, recomendadas: 0 };
  for (const p of pos) {
    const l = llantas.find((x) => x.posicion === p.codigo);
    if (!l) { r.sinRegistro++; continue; }
    const n = nivelLlanta(l);
    if (n === "rojo") r.vencidas++; else if (n === "amarillo") r.proximas++; else r.bien++;
  }
  r.recomendadas = r.vencidas + r.proximas;
  return r;
}

export function sumarResumen(a: ResumenLlantas, b: ResumenLlantas): ResumenLlantas {
  return { total: a.total + b.total, vencidas: a.vencidas + b.vencidas, proximas: a.proximas + b.proximas, bien: a.bien + b.bien,
    sinRegistro: a.sinRegistro + b.sinRegistro, recomendadas: a.recomendadas + b.recomendadas };
}

/**
 * La regla del rubro «llantas» se mide con las llantas vigentes del tracto (la más gastada manda) en lugar del
 * último servicio de llantas. Sin llantas registradas se deja la alerta como estaba.
 */
export function alertaConLlantas(a: Alerta, llantas: LlantaEstado[]): Alerta {
  if (a.regla.categoria !== "llantas" || !llantas.length) return a;
  const peor = [...llantas].sort((x, y) => Number(y.porcentaje) - Number(x.porcentaje))[0];
  const usado = Number(peor.km_recorridos), intervalo = Number(peor.vida_km);
  const km = { usado, intervalo, restante: intervalo - usado, porcentaje: (usado / intervalo) * 100, nivel: nivelDe(usado, intervalo) };
  const peso = { verde: 0, amarillo: 1, rojo: 2 } as const;
  const nivel: Nivel = a.dias && peso[a.dias.nivel] > peso[km.nivel] ? a.dias.nivel : km.nivel;   // el peor entre km y días
  return {
    ...a, km, nivel, porcentaje: Math.max(km.porcentaje, a.dias?.porcentaje ?? 0), sinRegistro: false,
    ultimo: { fecha: peor.fecha_instalacion, km: peor.km_instalacion == null ? null : Number(peor.km_instalacion), servicio: `Llanta más gastada: ${etiquetaPosicion(peor.posicion)}` },
  };
}
