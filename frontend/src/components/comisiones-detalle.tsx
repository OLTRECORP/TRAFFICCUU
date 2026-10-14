"use client";

import { useMemo } from "react";
import { comisionViaje, contabilizados, etiquetaTasas, tasaDe, type ViajeComision } from "@/lib/comisiones";
import { fechaMx, mxn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface DetalleComision { titulo: string; chofer: string; viajes: ViajeComision[] }

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/60 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold leading-tight">{value}</p>
    </div>
  );
}

/** Facturas/viajes que componen una comisión, con lo contabilizado arriba y los totales al pie. */
export function ComisionesDetalle({ detalle, onClose }: { detalle: DetalleComision | null; onClose: () => void }) {
  const viajes = useMemo(
    () => [...(detalle?.viajes ?? [])].sort((a, b) => a.fecha_viaje.localeCompare(b.fecha_viaje) || (a.folio ?? "").localeCompare(b.folio ?? "")),
    [detalle],
  );
  const c = useMemo(() => contabilizados(viajes), [viajes]);

  return (
    <Dialog open={!!detalle} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        {detalle && (
          <>
            <div className="pr-6">
              <DialogTitle className="text-lg font-semibold">Comisión de {detalle.chofer}</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">{detalle.titulo}</DialogDescription>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Contabilizado">
              <Dato label="Viajes contabilizados" value={String(c.viajes)} />
              <Dato label="Facturas incluidas" value={String(c.facturas)} />
              <Dato label="Subtotal (sin IVA)" value={mxn(c.subtotal)} />
              <Dato label={`Comisión ${etiquetaTasas(viajes)}`} value={mxn(c.comision)} />
            </div>

            <div className="max-h-[50vh] overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Fecha de salida</TableHead>
                    <TableHead>Factura</TableHead>
                    <TableHead>Origen</TableHead>
                    <TableHead>Destino</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                    <TableHead className="text-right">%</TableHead>
                    <TableHead className="text-right">Comisión</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viajes.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Sin viajes en este periodo.</TableCell></TableRow>
                  ) : viajes.map((v, i) => (
                    <TableRow key={v.viaje_id}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="whitespace-nowrap">{fechaMx(v.fecha_viaje)}</TableCell>
                      <TableCell className="whitespace-nowrap font-medium">{v.folio ?? (v.remision ? `Rem. ${v.remision}` : "—")}{v.folio && v.remision && <span className="block text-xs font-normal text-muted-foreground">Rem. {v.remision}</span>}</TableCell>
                      <TableCell>{v.origen ?? "—"}</TableCell>
                      <TableCell>{v.destino ?? "—"}{v.cliente && <span className="block text-xs text-muted-foreground">{v.cliente}</span>}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">{mxn(v.subtotal)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right text-muted-foreground">{tasaDe(v)}%</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium">{mxn(comisionViaje(v))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {viajes.length > 0 && (
                  <tfoot className="border-t bg-secondary/50">
                    <TableRow>
                      <TableCell colSpan={5} className="font-semibold">Total · {c.viajes} viajes · {c.facturas} facturas</TableCell>
                      <TableCell className="text-right font-semibold">{mxn(c.subtotal)}</TableCell>
                      <TableCell />
                      <TableCell className="text-right font-semibold">{mxn(c.comision)}</TableCell>
                    </TableRow>
                  </tfoot>
                )}
              </Table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
