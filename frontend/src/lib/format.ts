import type { Ubicacion } from "@/lib/types";

/** Destino con su nombre de referencia (lugar del catálogo) y, si no hay, el de la Carta Porte. */
export const destinoLabel = (v: { lugar_destino?: { nombre: string } | null; destino: Ubicacion | null }) =>
  v.lugar_destino?.nombre ?? ubicacionLabel(v.destino);
export const origenLabel = (v: { lugar_origen?: { nombre: string } | null; origen: Ubicacion | null }) =>
  v.lugar_origen?.nombre ?? ubicacionLabel(v.origen);

export const ubicacionLabel = (u: Ubicacion | null) =>
  !u ? "—" : u.nombre || [u.municipio, u.estado].filter(Boolean).join(", ") || u.id_ubicacion;
