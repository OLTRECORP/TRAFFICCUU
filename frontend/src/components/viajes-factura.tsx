"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fechaMx, km, mxn } from "@/lib/utils";
import { ErrorAlert } from "@/components/error-alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ViajeFila {
  id: string; fecha: string; fecha_salida: string | null; remision: string | null; material: string | null; mercancia: string | null;
  cantidad: number | null; unidad: string | null; precio_unitario: number | null; subtotal: number; distancia_operativa: number;
  origen_registro: string | null; km_por_mapa: boolean | null;
  lugar_origen: { nombre: string } | null; lugar_destino: { nombre: string } | null;
  chofer: { nombre: string } | null; tracto: { placa: string } | null; cliente: { nombre: string } | null;
}

const corta = (d: string) => new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(d));

/** Viajes ligados a una factura: uno si viene de la Carta Porte del XML; varios si es una factura semanal (p. ej. La Purísima). */
export function ViajesFactura({ facturaId, compacto }: { facturaId: string; compacto?: boolean }) {
  const [viajes, setViajes] = useState<ViajeFila[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    setViajes(null); setError(null);
    void createClient().from("viajes")
      .select("id, fecha, fecha_salida, remision, material, mercancia, cantidad, unidad, precio_unitario, subtotal, distancia_operativa, origen_registro, km_por_mapa, "
        + "lugar_origen:lugares!lugar_origen_id(nombre), lugar_destino:lugares!lugar_destino_id(nombre), chofer:choferes(nombre), tracto:tractocamiones(placa), cliente:clientes(nombre)")
      .eq("factura_id", facturaId).order("fecha").order("remision").limit(1000)
      .then(({ data, error: e }) => {
        if (!vigente) return;
        if (e) setError(e.message); else setViajes((data ?? []) as unknown as ViajeFila[]);
      });
    return () => { vigente = false; };
  }, [facturaId]);

  if (error) return <ErrorAlert where="viajes-factura" message={error} />;
  if (!viajes) return <p className="text-sm text-muted-foreground">Cargando viajes…</p>;
  if (!viajes.length) return <p className="text-sm text-muted-foreground">Esta factura no tiene viajes ligados. Si es una factura semanal, lígala a su semana en Clientes → Semanas y facturas.</p>;

  const fechas = viajes.map((v) => v.fecha_salida ?? v.fecha).sort();
  const subtotal = viajes.reduce((s, v) => s + Number(v.subtotal), 0);
  const cantidad = viajes.reduce((s, v) => s + Number(v.cantidad ?? 0), 0);
  const kms = viajes.reduce((s, v) => s + Number(v.distancia_operativa), 0);
  const clientes = [...new Set(viajes.map((v) => v.cliente?.nombre).filter(Boolean))];

  return (
    <div className="grid gap-2">
      <p className="text-sm">
        <b>{viajes.length}</b> viaje{viajes.length === 1 ? "" : "s"}{clientes.length ? <> de <b>{clientes.join(", ")}</b></> : null}
        {viajes.length > 1 && <> · del {corta(fechas[0])} al {corta(fechas[fechas.length - 1])}</>}
        {cantidad > 0 && <> · {cantidad.toLocaleString("es-MX")} {viajes[0].unidad ?? ""}</>}
        {" "}· {km(kms)} · subtotal de viajes <b>{mxn(subtotal)}</b>
      </p>
      <div className={`overflow-y-auto rounded-lg border ${compacto ? "max-h-72" : "max-h-[50vh]"}`}>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Fecha</TableHead><TableHead>Remisión</TableHead><TableHead>Origen → destino</TableHead>
              <TableHead>Chofer / tracto</TableHead><TableHead className="text-right">Cantidad</TableHead>
              <TableHead className="text-right">Km</TableHead><TableHead className="text-right">Subtotal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {viajes.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="whitespace-nowrap">{fechaMx(v.fecha_salida ?? v.fecha)}</TableCell>
                <TableCell>{v.remision ?? <span className="text-muted-foreground">XML</span>}</TableCell>
                <TableCell>{v.lugar_origen?.nombre ?? "—"} → {v.lugar_destino?.nombre ?? "—"}
                  {(v.material || v.mercancia) && <span className="block text-xs text-muted-foreground">{v.material ?? v.mercancia}</span>}</TableCell>
                <TableCell>{v.chofer?.nombre ?? "—"}<span className="block text-xs text-muted-foreground">{v.tracto?.placa ?? ""}</span></TableCell>
                <TableCell className="whitespace-nowrap text-right">{v.cantidad != null ? `${Number(v.cantidad).toLocaleString("es-MX")} ${v.unidad ?? ""}` : "—"}
                  {v.precio_unitario != null && <span className="block text-xs text-muted-foreground">× {mxn(Number(v.precio_unitario))}</span>}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{Number(v.distancia_operativa) ? km(v.distancia_operativa)
                  : <span className="text-xs text-muted-foreground">{v.km_por_mapa ? "sin mapa" : "—"}</span>}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{mxn(v.subtotal)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          {viajes.length > 1 && (
            <tfoot className="border-t bg-secondary/50">
              <TableRow><TableCell colSpan={6} className="font-semibold">Total · {viajes.length} viajes</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold">{mxn(subtotal)}</TableCell></TableRow>
            </tfoot>
          )}
        </Table>
      </div>
    </div>
  );
}
