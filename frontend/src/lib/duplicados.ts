/** Viajes de un periodo que probablemente están duplicados. Una remisión repetida es duplicado; remisiones parecidas
 *  pero con distinto folio no lo son. Los viajes sin remisión solo se agrupan si todos sus datos coinciden. */
export interface ViajeDup {
  id: string; created_at: string; fecha: string; remision: string | null; material: string | null; cantidad: number | null; subtotal: number;
  origen: string | null; destino: string | null; chofer: string | null; tracto: string | null;
}

export interface GrupoDuplicado {
  clave: string; motivo: "remision" | "datos";
  viajes: ViajeDup[];
  conservar: string;       // el más antiguo (primero capturado)
  sobran: string[];        // ids de los demás
}

const norm = (s: string | null) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const sinCeros = (s: string) => s.replace(/^0+(?=.)/, "");

export const claveRemision = (r: string | null) => sinCeros(norm(r));

export function gruposDuplicados(viajes: ViajeDup[]): GrupoDuplicado[] {
  const m = new Map<string, { motivo: GrupoDuplicado["motivo"]; viajes: ViajeDup[] }>();
  for (const v of viajes) {
    const r = claveRemision(v.remision);
    const clave = r ? `rem:${r}` : `datos:${[v.fecha.slice(0, 10), norm(v.origen), norm(v.destino), norm(v.material), v.cantidad ?? "", norm(v.tracto), norm(v.chofer), Number(v.subtotal)].join("|")}`;
    const g = m.get(clave) ?? { motivo: r ? "remision" : "datos", viajes: [] };
    g.viajes.push(v);
    m.set(clave, g);
  }
  return [...m.entries()].filter(([, g]) => g.viajes.length > 1).map(([clave, g]) => {
    const orden = [...g.viajes].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    return { clave, motivo: g.motivo, viajes: orden, conservar: orden[0].id, sobran: orden.slice(1).map((x) => x.id) };
  }).sort((a, b) => a.viajes[0].fecha.localeCompare(b.viajes[0].fecha));
}
