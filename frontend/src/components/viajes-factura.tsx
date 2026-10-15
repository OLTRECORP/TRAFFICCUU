"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Loader2, Unlink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ApiError, postBackend } from "@/lib/api";
import { impuestosDe } from "@/lib/cfdi";
import type { FacturaSat } from "@/lib/types";
import { fechaMx, km, mxn } from "@/lib/utils";
import { ErrorAlert } from "@/components/error-alert";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ViajeFila {
  id: string; fecha: string; fecha_salida: string | null; remision: string | null; material: string | null; mercancia: string | null;
  cantidad: number | null; unidad: string | null; precio_unitario: number | null; subtotal: number; distancia_operativa: number;
  origen_registro: string | null; km_por_mapa: boolean | null;
  lugar_origen: { nombre: string } | null; lugar_destino: { nombre: string } | null;
  chofer: { nombre: string } | null; tracto: { placa: string } | null; cliente: { nombre: string } | null;
}

interface Disponible {
  id: string; fecha: string; remision: string | null; material: string | null; cantidad: number | null; unidad: string | null;
  subtotal: number; total: number | null; factura_id: string | null;
}

const corta = (d: string) => new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(d));

/** Viajes ligados a una factura: uno si viene de la Carta Porte del XML; varios si es una factura semanal (p. ej. La Purísima). */
export function ViajesFactura({ facturaId, compacto, sat, editable, onCambio }:
  { facturaId: string; compacto?: boolean; sat?: FacturaSat | null; editable?: boolean; onCambio?: () => void }) {
  const [viajes, setViajes] = useState<ViajeFila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const recargar = useCallback(() => { setVersion((v) => v + 1); onCambio?.(); }, [onCambio]);

  useEffect(() => {
    let vigente = true;
    setError(null);
    void createClient().from("viajes")
      .select("id, fecha, fecha_salida, remision, material, mercancia, cantidad, unidad, precio_unitario, subtotal, distancia_operativa, origen_registro, km_por_mapa, "
        + "lugar_origen:lugares!lugar_origen_id(nombre), lugar_destino:lugares!lugar_destino_id(nombre), chofer:choferes(nombre), tracto:tractocamiones(placa), cliente:clientes(nombre)")
      .eq("factura_id", facturaId).order("fecha").order("remision").limit(1000)
      .then(({ data, error: e }) => {
        if (!vigente) return;
        if (e) setError(e.message); else setViajes((data ?? []) as unknown as ViajeFila[]);
      });
    return () => { vigente = false; };
  }, [facturaId, version]);

  if (error) return <ErrorAlert where="viajes-factura" message={error} />;
  if (!viajes) return <p className="text-sm text-muted-foreground">Cargando viajes…</p>;
  if (!viajes.length) return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Esta factura no tiene viajes ligados.{editable ? " Elige abajo los que ampara este XML." : " Si es una factura semanal, lígala a su semana en Clientes → Semanas y facturas."}
      </p>
      {editable && <LigarViajes facturaId={facturaId} sat={sat ?? null} ligados={[]} onCambio={recargar} />}
    </div>
  );

  const fechas = viajes.map((v) => v.fecha_salida ?? v.fecha).sort();
  const subtotal = viajes.reduce((s, v) => s + Number(v.subtotal), 0);
  const cantidad = viajes.reduce((s, v) => s + Number(v.cantidad ?? 0), 0);
  const kms = viajes.reduce((s, v) => s + Number(v.distancia_operativa), 0);
  const clientes = [...new Set(viajes.map((v) => v.cliente?.nombre).filter(Boolean))];

  async function quitar(id: string) {
    setError(null);
    try {
      await postBackend(`facturas/${facturaId}/ligar-viajes`, JSON.stringify({ desligar: [id] }), "application/json");
      recargar();
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="grid gap-2">
      <p className="text-sm">
        <b>{viajes.length}</b> viaje{viajes.length === 1 ? "" : "s"}{clientes.length ? <> de <b>{clientes.join(", ")}</b></> : null}
        {viajes.length > 1 && <> · del {corta(fechas[0])} al {corta(fechas[fechas.length - 1])}</>}
        {cantidad > 0 && <> · {cantidad.toLocaleString("es-MX")} {viajes[0].unidad ?? ""}</>}
        {" "}· {km(kms)} · subtotal de viajes <b>{mxn(subtotal)}</b>
      </p>
      <Conciliacion sat={sat ?? null} subtotalViajes={subtotal} />
      <div className={`overflow-y-auto rounded-lg border ${compacto ? "max-h-72" : "max-h-[50vh]"}`}>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Fecha</TableHead><TableHead>Remisión</TableHead><TableHead>Origen → destino</TableHead>
              <TableHead>Chofer / tracto</TableHead><TableHead className="text-right">Cantidad</TableHead>
              <TableHead className="text-right">Km</TableHead><TableHead className="text-right">Subtotal</TableHead>
              {editable && <TableHead className="w-10" />}
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
                {editable && (
                  <TableCell>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Quitar este viaje de la factura" aria-label="Quitar este viaje de la factura"
                      onClick={() => void quitar(v.id)}><Unlink className="h-3.5 w-3.5" /></Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
          {viajes.length > 1 && (
            <tfoot className="border-t bg-secondary/50">
              <TableRow><TableCell colSpan={6} className="font-semibold">Total · {viajes.length} viajes</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold">{mxn(subtotal)}</TableCell>{editable && <TableCell />}</TableRow>
            </tfoot>
          )}
        </Table>
      </div>
      {editable && <LigarViajes facturaId={facturaId} sat={sat ?? null} ligados={viajes.map((v) => v.id)} onCambio={recargar} />}
    </div>
  );
}

/** Lo que dice el XML contra la suma de sus viajes. El Total del XML ya trae descontadas las retenciones de IVA e ISR. */
function Conciliacion({ sat, subtotalViajes }: { sat: FacturaSat | null; subtotalViajes: number }) {
  const d = sat?.datos;
  if (!d || d.subtotal == null || d.subtotal === "") return null;
  const sub = Number(d.subtotal), imp = impuestosDe(sat);
  const dif = sub - subtotalViajes;
  const cuadra = Math.abs(dif) <= 1;
  return (
    <div className="grid gap-1 rounded-md border bg-secondary/30 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span>Subtotal del XML <b>{mxn(sub)}</b> · suma de los viajes <b>{mxn(subtotalViajes)}</b></span>
        <span className={cuadra ? "font-medium text-emerald-700" : "font-semibold text-red-600"}>
          {cuadra ? "Cuadra" : `${dif > 0 ? "Faltan" : "Sobran"} ${mxn(Math.abs(dif))} en los viajes`}
        </span>
      </div>
      {imp && (
        <div className="text-xs text-muted-foreground">
          + IVA {mxn(Number(imp.iva_trasladado))} − retención IVA {mxn(Number(imp.retencion_iva))} − retención ISR {mxn(Number(imp.retencion_isr))}
          {" "}= total a cobrar <b className="text-foreground">{mxn(sub + Number(imp.total_trasladados) - Number(imp.total_retenidos) - Number(d.descuento ?? 0))}</b>
          {d.total != null && d.total !== "" && Math.abs(sub + Number(imp.total_trasladados) - Number(imp.total_retenidos) - Number(d.descuento ?? 0) - Number(d.total)) > 0.05
            && <> (el Total del XML es {mxn(Number(d.total))})</>}
        </div>
      )}
    </div>
  );
}

/** Viajes del cliente de la factura que aún no tienen factura: se eligen los que ampara este XML. */
function LigarViajes({ facturaId, sat, ligados, onCambio }: { facturaId: string; sat: FacturaSat | null; ligados: string[]; onCambio: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState<Disponible[] | null>(null);
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>([]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const r = await postBackend<{ clientes: { id: string; nombre: string }[]; viajes: Disponible[] }>(`facturas/${facturaId}/viajes-disponibles`, "{}", "application/json");
      setClientes(r.clientes); setLista(r.viajes);
    } catch (e) { setError(e as ApiError); }
  }, [facturaId]);
  useEffect(() => { if (abierto) void cargar(); }, [abierto, cargar, ligados.length]);

  const libres = (lista ?? []).filter((v) => v.factura_id == null);
  const elegidos = libres.filter((v) => marcados.has(v.id));
  const sumaElegidos = elegidos.reduce((s, v) => s + Number(v.subtotal), 0);
  const sumaLigados = (lista ?? []).filter((v) => v.factura_id != null).reduce((s, v) => s + Number(v.subtotal), 0);
  const subXml = sat?.datos?.subtotal ? Number(sat.datos.subtotal) : null;
  const falta = subXml != null ? subXml - sumaLigados - sumaElegidos : null;

  function alternar(id: string) { const n = new Set(marcados); if (n.has(id)) n.delete(id); else n.add(id); setMarcados(n); }

  async function ligar() {
    setBusy(true); setError(null); setAviso(null);
    try {
      const r = await postBackend<{ ligados: number; omitidos: number }>(`facturas/${facturaId}/ligar-viajes`, JSON.stringify({ ligar: elegidos.map((v) => v.id) }), "application/json");
      setAviso(`${r.ligados} viajes ligados a la factura.${r.omitidos ? ` ${r.omitidos} ya tenían otra factura y no se tocaron.` : ""}`);
      setMarcados(new Set());
      onCambio();
      await cargar();
    } catch (e) { setError(e as ApiError); } finally { setBusy(false); }
  }

  if (!abierto) {
    return (
      <div>
        <Button size="sm" variant="outline" onClick={() => setAbierto(true)}><Link2 className="h-4 w-4" /> Ligar viajes a esta factura</Button>
      </div>
    );
  }
  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Viajes sin factura{clientes.length ? ` de ${clientes.map((c) => c.nombre).join(", ")}` : ""}</h4>
        <Button size="sm" variant="ghost" onClick={() => setAbierto(false)}>Cerrar</Button>
      </div>
      {error && <ErrorAlert where="ligar-viajes" message={error.message} status={error.status} path={error.path} />}
      {aviso && <Alert variant="success">{aviso}</Alert>}
      {!lista ? <p className="text-sm text-muted-foreground">Cargando…</p>
        : !clientes.length ? <p className="text-sm text-muted-foreground">No hay un cliente que coincida con el receptor de esta factura (RFC o nombre). Dalo de alta en Clientes con ese nombre o RFC.</p>
        : !libres.length ? <p className="text-sm text-muted-foreground">No quedan viajes sin factura de este cliente.</p>
        : (
          <>
            <div className="max-h-64 overflow-y-auto rounded-md border">
              <Table>
                <TableBody>
                  {libres.map((v) => (
                    <TableRow key={v.id} className="cursor-pointer" onClick={() => alternar(v.id)}>
                      <TableCell className="w-8"><input type="checkbox" checked={marcados.has(v.id)} onChange={() => alternar(v.id)} onClick={(e) => e.stopPropagation()} aria-label={`Viaje ${v.remision ?? v.id}`} /></TableCell>
                      <TableCell className="whitespace-nowrap">{fechaMx(v.fecha)}</TableCell>
                      <TableCell>{v.remision ?? "—"}{v.material && <span className="block text-xs text-muted-foreground">{v.material}</span>}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">{v.cantidad != null ? `${Number(v.cantidad).toLocaleString("es-MX")} ${v.unidad ?? ""}` : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">{mxn(v.subtotal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                {elegidos.length} elegidos · <b>{mxn(sumaElegidos)}</b>
                {falta != null && <> · {Math.abs(falta) <= 1 ? <b className="text-emerald-700">cuadra con el XML</b> : <span className="text-red-600">{falta > 0 ? "faltan" : "sobran"} {mxn(Math.abs(falta))} contra el subtotal del XML</span>}</>}
              </span>
              <Button size="sm" disabled={busy || !elegidos.length} onClick={() => void ligar()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Ligar {elegidos.length || ""} viajes
              </Button>
            </div>
          </>
        )}
    </div>
  );
}
