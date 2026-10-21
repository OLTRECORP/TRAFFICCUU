"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { etiquetaTasas, resumenPorChofer, type ViajeComision } from "@/lib/comisiones";
import { mxn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAG = 1000;
export interface ChoferCom { id: string; nombre: string; activo: boolean }

/** Solo choferes activos, con sus viajes y comisión del periodo (por defecto la semana de pago vie–jue en curso). */
export function ComisionesResumen({ choferes, desde, hasta, titulo, onError, onDetalle }: {
  choferes: ChoferCom[]; desde: string; hasta: string; titulo: string;
  onError: (m: string) => void; onDetalle: (chofer: string, viajes: ViajeComision[]) => void;
}) {
  const [viajes, setViajes] = useState<ViajeComision[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let vigente = true;
    setLoading(true);
    (async () => {
      const sb = createClient();
      const acum: ViajeComision[] = [];
      for (let d = 0; ; d += PAG) {
        let q = sb.from("comisiones_viajes")
          .select("viaje_id, chofer_id, folio, fecha_viaje, subtotal, origen, destino, cliente, remision, tasa_comision")
          .order("fecha_viaje", { ascending: false }).order("viaje_id").range(d, d + PAG - 1);
        if (desde) q = q.gte("fecha_viaje", desde);
        if (hasta) q = q.lte("fecha_viaje", hasta);
        const { data, error } = await q;
        if (!vigente) return;
        if (error) { onError(error.message); setLoading(false); return; }
        acum.push(...((data ?? []) as ViajeComision[]));
        if ((data?.length ?? 0) < PAG) break;
      }
      setViajes(acum); setLoading(false);
    })();
    return () => { vigente = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta]);

  const filas = useMemo(() => resumenPorChofer(choferes, viajes), [choferes, viajes]);
  const sinChofer = useMemo(() => viajes.filter((v) => !v.chofer_id).length, [viajes]);
  const tot = useMemo(() => filas.reduce((t, f) => ({
    viajes: t.viajes + f.resumen.viajes, facturas: t.facturas + f.resumen.facturas, subtotal: t.subtotal + f.resumen.subtotal, comision: t.comision + f.resumen.comision,
  }), { viajes: 0, facturas: 0, subtotal: 0, comision: 0 }), [filas]);

  if (loading) return <p className="text-sm text-muted-foreground">Calculando comisiones…</p>;
  return (
    <div className="grid gap-2">
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Chofer</TableHead>
              <TableHead className="text-right">Viajes</TableHead>
              <TableHead className="text-right">Facturas</TableHead>
              <TableHead className="text-right">Subtotal (sin IVA)</TableHead>
              <TableHead className="text-right">%</TableHead>
              <TableHead className="text-right">Comisión</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No hay choferes activos.</TableCell></TableRow>
            ) : filas.map((f) => {
              const vacio = f.resumen.viajes === 0;
              return (
                <TableRow key={f.chofer_id} tabIndex={vacio ? undefined : 0} className={vacio ? "text-muted-foreground" : "cursor-pointer"}
                  aria-label={vacio ? undefined : `Ver facturas de ${f.nombre}`}
                  onClick={() => !vacio && onDetalle(f.nombre, f.viajes)}
                  onKeyDown={(e) => !vacio && (e.key === "Enter" || e.key === " ") && onDetalle(f.nombre, f.viajes)}>
                  <TableCell className="font-medium">{f.nombre}</TableCell>
                  <TableCell className="text-right">{f.resumen.viajes}</TableCell>
                  <TableCell className="text-right">{f.resumen.facturas}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{vacio ? "—" : mxn(f.resumen.subtotal)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{vacio ? "—" : etiquetaTasas(f.viajes)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold">{vacio ? "—" : mxn(f.resumen.comision)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {filas.length > 0 && (
            <tfoot className="border-t bg-secondary/50">
              <TableRow>
                <TableCell className="font-semibold">Total · {titulo}</TableCell>
                <TableCell className="text-right font-semibold">{tot.viajes}</TableCell>
                <TableCell className="text-right font-semibold">{tot.facturas}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold">{mxn(tot.subtotal)}</TableCell>
                <TableCell />
                <TableCell className="whitespace-nowrap text-right font-semibold">{mxn(tot.comision)}</TableCell>
              </TableRow>
            </tfoot>
          )}
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">
        Haz clic en un chofer para ver sus facturas y viajes. Semanas de pago: de viernes a jueves; se pagan el viernes siguiente al cierre.
        {sinChofer > 0 && ` ${sinChofer} viaje${sinChofer === 1 ? "" : "s"} del periodo no tiene${sinChofer === 1 ? "" : "n"} chofer asignado y no suma${sinChofer === 1 ? "" : "n"} comisión (se listan abajo).`}
      </p>
    </div>
  );
}
