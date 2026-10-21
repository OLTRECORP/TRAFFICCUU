"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTheme } from "@/components/theme-provider";
import { folioTexto, totalesDocumento, vigenciaHasta, type DocumentoCotizacion } from "@/lib/cotizador";
import { duracionTexto } from "@/lib/rutas";
import { fechaMx, km, mxn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

interface Emisor { razon_social: string; rfc: string }

/** Formato de cotización para el cliente (siempre en claro, para impresión): no muestra costos internos ni la ganancia. */
export function CotizacionDocumento({ d, emisor, logoUrl }: { d: DocumentoCotizacion; emisor: Emisor | null; logoUrl: string | null }) {
  const t = totalesDocumento(d);
  const unidad = d.unidad === "tonelada" ? "tonelada" : "m³";
  const unidades = d.unidad === "tonelada" ? "toneladas" : "m³";
  const condiciones = d.condiciones.split("\n").map((c) => c.trim()).filter(Boolean);
  const hasta = vigenciaHasta(d.fecha, d.vigencia_dias);
  const acento = { color: "hsl(var(--primary))" };
  return (
    <div className="mx-auto w-full max-w-[800px] bg-white p-8 text-[13px] leading-snug text-slate-900" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      <header className="flex items-start justify-between gap-6 border-b-4 pb-4" style={{ borderColor: "hsl(var(--primary))" }}>
        <div className="flex items-center gap-4">
          {logoUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={logoUrl} alt="" className="h-16 w-auto max-w-[140px] object-contain" />}
          <div>
            <p className="text-lg font-bold">{emisor?.razon_social ?? "Empresa"}</p>
            {emisor?.rfc && <p className="text-xs text-slate-600">RFC {emisor.rfc}</p>}
            <p className="text-xs text-slate-600">Autotransporte federal de carga</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-extrabold tracking-wide" style={acento}>COTIZACIÓN</p>
          <p className="text-sm font-semibold">No. {folioTexto(d.folio)}</p>
          <p className="text-xs text-slate-600">Fecha: {fechaMx(d.fecha)}</p>
          <p className="text-xs text-slate-600">Vigente hasta: {fechaMx(hasta)}</p>
        </div>
      </header>

      <section className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3">
        <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cliente</p><p className="font-medium">{d.cliente || "—"}</p></div>
        <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Mercancía</p><p className="font-medium">{d.mercancia || "—"}</p></div>
        <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Origen</p><p className="font-medium">{d.origen}</p></div>
        <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Destino</p><p className="font-medium">{d.destino}</p></div>
        <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Distancia del trayecto</p><p className="font-medium">{km(d.km_ida)}{d.redondo ? " (ida)" : ""}</p></div>
        <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tiempo estimado de traslado</p><p className="font-medium">{duracionTexto(d.minutos_ida)}{d.redondo ? " (ida)" : ""}</p></div>
      </section>

      <table className="mt-6 w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-y-2 text-left text-[11px] uppercase tracking-wide text-slate-600" style={{ borderColor: "hsl(var(--primary))" }}>
            <th className="py-2 font-semibold">Concepto</th><th className="py-2 text-right font-semibold">Cantidad</th>
            <th className="py-2 text-right font-semibold">Precio por {unidad}</th><th className="py-2 text-right font-semibold">Importe</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b">
            <td className="py-3">
              <p className="font-medium">Servicio de flete en tractocamión con góndola</p>
              <p className="text-xs text-slate-600">{d.origen} → {d.destino}</p>
            </td>
            <td className="py-3 text-right">{d.cantidad.toLocaleString("es-MX")} {unidades}</td>
            <td className="py-3 text-right">{mxn(d.precio_unidad)}</td>
            <td className="py-3 text-right font-medium">{mxn(t.subtotal)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-4 flex justify-end">
        <table className="w-72 text-[13px]">
          <tbody>
            <tr><td className="py-1">Subtotal</td><td className="py-1 text-right">{mxn(t.subtotal)}</td></tr>
            <tr><td className="py-1">IVA 16 %</td><td className="py-1 text-right">{mxn(t.iva)}</td></tr>
            <tr><td className="py-1">Retención de IVA 4 %</td><td className="py-1 text-right">−{mxn(t.retencion)}</td></tr>
            <tr className="border-t-2 text-base font-bold" style={{ borderColor: "hsl(var(--primary))" }}>
              <td className="py-2" style={acento}>Total (MXN)</td><td className="py-2 text-right">{mxn(t.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {condiciones.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Condiciones</h3>
          <ol className="list-decimal space-y-0.5 pl-5 text-xs text-slate-700">{condiciones.map((c, i) => <li key={i}>{c}</li>)}</ol>
        </section>
      )}

      <section className="mt-12 grid grid-cols-2 gap-16 text-center text-xs text-slate-600">
        <div className="border-t border-slate-400 pt-1">{emisor?.razon_social ?? "Empresa"}<br />Atentamente</div>
        <div className="border-t border-slate-400 pt-1">{d.cliente || "Cliente"}<br />Aceptación</div>
      </section>
    </div>
  );
}

/** Vista previa en pantalla e impresión (o guardar como PDF desde el diálogo de impresión del navegador). */
export function ImprimirCotizacion({ doc, onClose }: { doc: DocumentoCotizacion | null; onClose: () => void }) {
  const { logoUrl } = useTheme();
  const [emisor, setEmisor] = useState<Emisor | null>(null);
  const [montado, setMontado] = useState(false);
  useEffect(() => {
    setMontado(true);
    void createClient().from("empresa_configuracion").select("razon_social, rfc").maybeSingle().then(({ data }) => setEmisor((data as Emisor | null) ?? null));
  }, []);

  return (
    <>
      <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <div className="flex items-start justify-between gap-3 pr-6">
            <div>
              <DialogTitle className="text-lg font-semibold">Cotización {doc ? folioTexto(doc.folio) : ""}</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">Formato para el cliente. En el diálogo de impresión puedes elegir «Guardar como PDF».</DialogDescription>
            </div>
            <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimir / PDF</Button>
          </div>
          <div className="overflow-x-auto rounded-md border bg-slate-100 p-2">{doc && <CotizacionDocumento d={doc} emisor={emisor} logoUrl={logoUrl} />}</div>
        </DialogContent>
      </Dialog>
      {montado && doc && createPortal(<div id="print-root"><CotizacionDocumento d={doc} emisor={emisor} logoUrl={logoUrl} /></div>, document.body)}
    </>
  );
}
