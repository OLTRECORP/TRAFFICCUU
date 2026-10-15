import type { FacturaSat, ImpuestosCfdi } from "@/lib/types";

const dos = (n: number) => n.toFixed(2);

/** Impuestos del CFDI: los guardados al leerlo; si el XML se guardó antes de que se leyeran, se sacan del propio XML. */
export function impuestosDe(sat: FacturaSat | null): ImpuestosCfdi | null {
  if (sat?.datos?.impuestos) return sat.datos.impuestos;
  if (!sat?.xml) return null;
  try {
    const doc = new DOMParser().parseFromString(sat.xml, "application/xml");
    const hijos = (n: Element | null | undefined, nombre: string) => Array.from(n?.children ?? []).filter((c) => c.localName === nombre);
    const nodo = hijos(doc.documentElement, "Impuestos")[0];
    if (!nodo) return null;
    const suma = (lista: string, hijo: string, impuesto?: string) =>
      hijos(hijos(nodo, lista)[0], hijo).filter((t) => !impuesto || t.getAttribute("Impuesto") === impuesto)
        .reduce((s, t) => s + Number(t.getAttribute("Importe") || 0), 0);
    const tt = nodo.getAttribute("TotalImpuestosTrasladados"), tr = nodo.getAttribute("TotalImpuestosRetenidos");
    return {
      iva_trasladado: dos(suma("Traslados", "Traslado", "002")), retencion_iva: dos(suma("Retenciones", "Retencion", "002")),
      retencion_isr: dos(suma("Retenciones", "Retencion", "001")),
      total_trasladados: tt != null ? dos(Number(tt)) : dos(suma("Traslados", "Traslado")),
      total_retenidos: tr != null ? dos(Number(tr)) : dos(suma("Retenciones", "Retencion")),
    };
  } catch { return null; }
}
