/**
 * PDF del resumen de comisiones de un chofer con la lista de sus viajes. Cada chofer empieza en página nueva, así que un
 * mismo documento sirve para uno solo o para todos («una hoja por chofer»). Se arma con jsPDF en el navegador.
 */
import { comisionViaje, contabilizados, etiquetaTasas, tasaDe, type ViajeComision } from "./comisiones.ts";

export interface ChoferPdf { nombre: string; viajes: ViajeComision[] }
export interface OpcionesPdf {
  empresa: { razon_social: string; rfc: string } | null;
  periodo: string;                 // «vie 16 oct – jue 22 oct 2026 · pago vie 23 oct»
  generado?: string;               // YYYY-MM-DD; por omisión hoy
}

const peso = (n: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
const fecha = (iso: string) => new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso.slice(0, 10) + "T00:00:00Z"));

/** Nombre de archivo seguro: «comisiones-juan-perez-vie-16-oct-jue-22-oct-2026.pdf». */
export function nombreArchivoPdf(...partes: string[]): string {
  const slug = partes.join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
  return `comisiones-${slug}.pdf`;
}

/** Arma el documento (sin descargarlo). Los choferes sin viajes no llevan hoja. */
export async function construirPdfComisiones(choferes: ChoferPdf[], o: OpcionesPdf) {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const ancho = doc.internal.pageSize.getWidth(), margen = 32;
  const generado = o.generado ?? new Date().toLocaleDateString("en-CA");
  const lista = choferes.filter((c) => c.viajes.length > 0);
  if (!lista.length) throw new Error("No hay viajes que imprimir en este periodo");

  lista.forEach((c, i) => {
    if (i > 0) doc.addPage();
    const viajes = [...c.viajes].sort((a, b) => a.fecha_viaje.localeCompare(b.fecha_viaje) || (a.folio ?? "").localeCompare(b.folio ?? ""));
    const t = contabilizados(viajes);

    // Encabezado: sobrio y chico, con una línea fina
    doc.setFont("helvetica", "bold").setFontSize(9.5).setTextColor(20);
    doc.text(o.empresa?.razon_social ?? "Comisiones de choferes", margen, 36);
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(120);
    if (o.empresa?.rfc) doc.text(`RFC ${o.empresa.rfc}`, margen, 46);
    doc.setFont("helvetica", "bold").setFontSize(9.5).setTextColor(20);
    doc.text("Resumen de comisiones", ancho - margen, 36, { align: "right" });
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(120);
    doc.text(`Generado el ${fecha(generado)}`, ancho - margen, 46, { align: "right" });
    doc.setDrawColor(200).setLineWidth(0.4).line(margen, 54, ancho - margen, 54);

    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(20);
    doc.text(c.nombre, margen, 72);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(90);
    doc.text(`Periodo: ${o.periodo}`, margen, 84);

    // Totales en una sola línea
    const cajas: [string, string][] = [["Viajes", String(t.viajes)], ["Facturas", String(t.facturas)], ["Subtotal (sin IVA)", peso(t.subtotal)], [`Comisión ${etiquetaTasas(viajes)}`, peso(t.comision)]];
    const w = (ancho - 2 * margen) / 4;
    cajas.forEach(([k, v], j) => {
      const x = margen + j * w;
      doc.setFont("helvetica", "normal").setFontSize(6.5).setTextColor(120).text(k, x, 100);
      doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(20).text(v, x, 111);
    });

    autoTable(doc, {
      startY: 122, margin: { left: margen, right: margen, bottom: 34 }, theme: "plain",
      head: [["#", "Fecha", "Factura / remisión", "Origen", "Destino", "Subtotal", "%", "Comisión"]],
      body: viajes.map((v, k) => [
        String(k + 1), fecha(v.fecha_viaje), v.folio ?? (v.remision ? `Rem. ${v.remision}` : "—"), v.origen ?? "—",
        v.destino ? (v.cliente ? `${v.destino} · ${v.cliente}` : v.destino) : "—", peso(Number(v.subtotal)), `${tasaDe(v)}%`, peso(comisionViaje(v)),
      ]),
      foot: [[{ content: `Total: ${t.viajes} viajes · ${t.facturas} facturas`, colSpan: 5 }, peso(t.subtotal), "", peso(t.comision)]],
      showFoot: "lastPage",
      styles: { font: "helvetica", fontSize: 7, cellPadding: { top: 2, bottom: 2, left: 2.5, right: 2.5 }, textColor: 30, overflow: "linebreak", lineColor: 228, lineWidth: { bottom: 0.3 } },
      headStyles: { fillColor: [240, 243, 246], textColor: 70, fontStyle: "bold", fontSize: 6.5, lineColor: 190, lineWidth: { bottom: 0.5 } },
      footStyles: { fillColor: false, textColor: 20, fontStyle: "bold", lineColor: 190, lineWidth: { top: 0.5 } },
      columnStyles: { 0: { cellWidth: 16 }, 1: { cellWidth: 50 }, 2: { cellWidth: 62 }, 5: { halign: "right", cellWidth: 52 }, 6: { halign: "right", cellWidth: 24 }, 7: { halign: "right", cellWidth: 52 } },
      didParseCell: (d) => { if (d.section !== "body" && [5, 6, 7].includes(d.column.index)) d.cell.styles.halign = "right"; },
    });
  });

  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal").setFontSize(6.5).setTextColor(140);
    doc.text(`Página ${p} de ${total}`, ancho - margen, doc.internal.pageSize.getHeight() - 18, { align: "right" });
    doc.text("Comisión = % del subtotal de cada viaje (antes de IVA). Fecha del viaje = salida del origen.", margen, doc.internal.pageSize.getHeight() - 18);
  }
  return doc;
}

/** Descarga el PDF de uno o varios choferes (una hoja por chofer). */
export async function descargarPdfComisiones(choferes: ChoferPdf[], o: OpcionesPdf, archivo: string): Promise<void> {
  (await construirPdfComisiones(choferes, o)).save(archivo);
}
