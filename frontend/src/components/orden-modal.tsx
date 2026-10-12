"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Factura, OrdenResumen } from "@/lib/types";
import { fechaMx, mxn } from "@/lib/utils";
import { ErrorAlert } from "@/components/error-alert";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Fila = Pick<Factura, "id" | "folio" | "uuid" | "estado" | "fecha_emision" | "total" | "complemento">;

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFacturas([]); setError(null);
    if (!orden) return;
    let vigente = true;
    setLoading(true);
    void (async () => {
      const { data, error: err } = await createClient().from("facturas")
        .select("id, folio, uuid, estado, fecha_emision, total, complemento")
        .eq("orden_compra", orden.numero)
        .order("fecha_emision", { ascending: true, nullsFirst: false }).order("folio")
        .limit(1000);
      if (!vigente) return;
      if (err) setError(err.message); else setFacturas((data ?? []) as Fila[]);
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
      <DialogContent className="max-w-3xl">
        {orden && (
          <>
            <div className="pr-6">
              <DialogTitle className="text-lg font-semibold">Orden de compra {orden.numero}</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {orden.fecha_creacion ? `Creada ${fechaMx(orden.fecha_creacion)}` : "Sin fecha de creación"}
                {orden.fecha_pago ? ` · Pago ${fechaMx(orden.fecha_pago)}` : ""}
              </DialogDescription>
            </div>

            <div className="grid gap-2 sm:grid-cols-4">
              <Resumen label="Monto de la orden" value={mxn(orden.monto)} />
              <Resumen label={`Suma facturas (${vigentes.length})`} value={mxn(suma)} />
              <Resumen label="Diferencia" value={mxn(diferencia)} tono={Math.abs(diferencia) <= 1 ? "verde" : "amarillo"} />
              <Resumen label="Complemento de pago" value={orden.comp_pago != null ? mxn(orden.comp_pago) : "—"} />
            </div>

            {error && <ErrorAlert where="orden-facturas" message={error} />}
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Folio</TableHead><TableHead>UUID</TableHead><TableHead>Emisión</TableHead>
                    <TableHead>Estado</TableHead><TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Cargando facturas…</TableCell></TableRow>
                  ) : facturas.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Esta orden no tiene facturas ligadas.</TableCell></TableRow>
                  ) : facturas.map((f) => (
                    <TableRow key={f.id} className={f.estado === "cancelado" ? "opacity-60" : undefined}>
                      <TableCell className="font-medium">{f.folio}</TableCell>
                      <TableCell className="font-mono text-xs" title={f.uuid ?? undefined}>{f.uuid ? `${f.uuid.slice(0, 8).toUpperCase()}…` : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{f.fecha_emision ? fechaMx(f.fecha_emision) : "—"}</TableCell>
                      <TableCell><Badge variant={f.estado === "cancelado" ? "rojo" : f.estado === "pagado" ? "verde" : "default"}>{f.estado ?? "—"}</Badge></TableCell>
                      <TableCell className="whitespace-nowrap text-right">{mxn(f.total)}</TableCell>
                    </TableRow>
                  ))}
                  {facturas.length > 0 && (
                    <TableRow className="bg-secondary/70 font-semibold hover:bg-secondary/70">
                      <TableCell colSpan={4} className="text-right">Total (sin canceladas)</TableCell>
                      <TableCell className="whitespace-nowrap text-right">{mxn(suma)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
