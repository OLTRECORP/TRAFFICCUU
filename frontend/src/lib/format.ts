import type { Ubicacion } from "@/lib/types";

export const ubicacionLabel = (u: Ubicacion | null) =>
  !u ? "—" : u.nombre || [u.municipio, u.estado].filter(Boolean).join(", ") || u.id_ubicacion;
