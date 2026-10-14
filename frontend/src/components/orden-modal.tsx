"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ViajesFactura } from "@/components/viajes-factura";
import { createClient } from "@/lib/supabase/client";
import { Download } from "lucide-react";
import { descargarXml } from "@/lib/descarga";
import type { ComplementoPago, Factura, OrdenResumen } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { fechaMx, mxn } from "@/lib/utils";
import { ErrorAlert } from "@/components/error-alert";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Fila = Pick<Factura, "id" | "folio" | "uuid" | "estado" | "fecha_emision" | "total" | "complemento" | "sat"> & {
  vs: { cliente: { nombre: string } | null }[];   // viajes ligados con su cliente
};

function Resumen({ label, value, tono }: { label: string; value: string; tono?: "verde" | "amarillo" }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-base font-bold ${tono === "verde" ? "text-emerald-600" : tono === "amarillo" ? "text-amber-600" : ""}`}>{value}</p>
    </div>
  );
}

export function OrdenModal({ orden, onClose }: { orden: OrdenResumen | null; onClose: () => void }) {
  const [facturas, setFacturas] = useState<Fila[]>([]);
  const [complementos, setComplementos] = useState<ComplementoPago[]>([]);
  const [loading, setLoading] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFacturas([]); setComplementos([]); setError(null); setAbierta(null);
    if (!orden) return;
    let vigente = true;
    setLoading(true);
    void (async () => {
      const { data, error: err } = await createClient().from("facturas")
        .select("id, folio, uuid, estado, fecha_emision, total, complemento, sat:facturas_sat(estado, actualizado_en, receptor:datos->receptor), vs:viajes(cliente:clientes(nombre))")
        .eq("orden_compra", orden.numero)
        .order("fecha_emision", { ascending: true, nullsFirst: false }).order("folio")
        .limit(1000);
      if (!vigente) return;
      if (err) setError(err.message); else setFacturas((data ?? []) as unknown as Fila[]);
      // Complementos de pago (XML del SAT) que cubren las facturas de esta orden
      const ligas = await createClient().from("complementos_pago_facturas").select("complemento_id").eq("orden_compra", orden.numero);
      const ids = [...new Set((ligas.data ?? []).map((l) => l.complemento_id as string))];
      if (ids.length && vigente) {
        const comp = await createClient().from("complementos_pago").select("id, uuid, serie, folio, fecha_pago, monto, xml").in("id", ids).order("fecha_pago");
        if (vigente && !comp.error) setComplementos((comp.data ?? []) as ComplementoPago[]);
      }
      setLoading(false);
    })();
    return () => { vigente = false; };
  }, [orden]);

  // Misma regla que la vista ordenes_compra_resumen: las canceladas no suman.
  const vigentes = facturas.filter((f) => f.estado !== "cancelado");
  const suma = vigentes.reduce((a, f) => a + Number(f.total), 0);
  const diferencia = Math.round((suma - (orden?.monto ?? 0)) * 100) / 100;

  return (
    <Dialog open={!!orden} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl">
        {orden && (
          <>
            <div className="pr-6">
              <DialogTitle className="text-lg font-semibold">Orden de compra {orden.numero}</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {orden.fecha_creacion ? `Creada ${fechaMx(orden.fecha_creacion)}` : "Sin fecha de creación"}
                {orden.pagada && orden.fecha_pago_complemento ? ` · Pagada ${fechaMx(orden.fecha_pago_complemento)}` : " · No pagada"}
              </DialogDescription>
            </div>

            <div className="grid gap-2 sm:grid-cols-4">
              <Resumen label="Monto de la orden" value={mxn(orden.monto)} />
              <Resumen label={`Suma facturas (${vigentes.length})`} value={mxn(suma)} />
              <Resumen label="Diferencia" value={mxn(diferencia)} tono={Math.abs(diferencia) <= 1 ? "verde" : "amarillo"} />
              <Resumen label="Pagado (complementos)" value={mxn(orden.monto_pagado)} tono={orden.pagada ? "verde" : "amarillo"} />
            </div>

            {error && <ErrorAlert where="orden-facturas" message={error} />}
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Folio</TableHead><TableHead>UUID</TableHead><TableHead>Emisión</TableHead>
                    <TableHead>Cliente</TableHead><TableHead className="text-right">Viajes</TableHead>
                    <TableHead>Estado</TableHead><TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Cargando facturas…</TableCell></TableRow>
                  ) : facturas.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Esta orden no tiene facturas ligadas.</TableCell></TableRow>
                  ) : facturas.map((f) => (
                    <Fragment key={f.id}>
                    <TableRow className={`cursor-pointer ${f.estado === "cancelado" ? "opacity-60" : ""}`} onClick={() => setAbierta(abierta === f.id ? null : f.id)}
                      aria-expanded={abierta === f.id}>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-1">
                          {abierta === f.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{f.folio}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs" title={f.uuid ?? undefined}>{f.uuid ? `${f.uuid.slice(0, 8).toUpperCase()}…` : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{f.fecha_emision ? fechaMx(f.fecha_emision) : "—"}</TableCell>
                      <TableCell className="max-w-48 truncate">{f.vs.find((v) => v.cliente)?.cliente?.nombre ?? f.sat?.receptor?.nombre ?? "—"}</TableCell>
                      <TableCell className="text-right">{f.vs.length}</TableCell>
                      <TableCell><Badge variant={f.estado === "cancelado" ? "rojo" : f.estado === "pagado" ? "verde" : "default"}>{f.estado ?? "—"}</Badge></TableCell>
                      <TableCell className="whitespace-nowrap text-right">{mxn(f.total)}</TableCell>
                    </TableRow>
                    {abierta === f.id && (
                      <TableRow className="bg-secondary/40 hover:bg-secondary/40">
                        <TableCell colSpan={7}><ViajesFactura facturaId={f.id} compacto /></TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                  ))}
                  {facturas.length > 0 && (
                    <TableRow className="bg-secondary/70 font-semibold hover:bg-secondary/70">
                      <TableCell colSpan={6} className="text-right">Total (sin canceladas)</TableCell>
                      <TableCell className="whitespace-nowrap text-right">{mxn(suma)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {complementos.length > 0 && (
              <div className="grid gap-1">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Complementos de pago</h4>
                <ul className="divide-y rounded-md border text-sm">
                  {complementos.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span>
                        <span className="font-medium">{[c.serie, c.folio].filter(Boolean).join(" ") || "Complemento"}</span>
                        <span className="ml-2 font-mono text-xs text-muted-foreground">{c.uuid.slice(0, 8).toUpperCase()}…</span>
                        <span className="ml-2 text-muted-foreground">{c.fecha_pago ? fechaMx(c.fecha_pago) : ""}</span>
                      </span>
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        {c.monto != null ? mxn(Number(c.monto)) : ""}
                        {c.xml && <Button variant="ghost" size="icon" aria-label="Descargar XML" onClick={() => descargarXml(c.uuid, c.xml!)}><Download className="h-4 w-4" /></Button>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
