"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { ApiError, postBackend } from "@/lib/api";
import type { Cliente, FacturaCliente, SemanaCliente } from "@/lib/types";
import { mxn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorAlert } from "@/components/error-alert";
import { ViajesPeriodo } from "@/components/clientes/viajes-periodo";
import { AuditoriaEliminaciones } from "@/components/auditoria-eliminaciones";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const sel = "h-8 w-full min-w-40 rounded-md border bg-background px-2 text-xs";
const corta = (d: string) => new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/** Semanas (lunes a domingo) del cliente y la factura que agrupa los viajes de cada una. */
export function SemanasCliente({ cliente }: { cliente: Cliente }) {
  const [semanas, setSemanas] = useState<SemanaCliente[]>([]);
  const [facturas, setFacturas] = useState<FacturaCliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [eleccion, setEleccion] = useState<Record<string, string>>({});
  const [detalle, setDetalle] = useState<SemanaCliente | null>(null);
  const [version, setVersion] = useState(0);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const r = await postBackend<{ semanas: SemanaCliente[]; facturas: FacturaCliente[] }>(`clientes/${cliente.id}/semanas`, "{}", "application/json");
      setSemanas(r.semanas); setFacturas(r.facturas);
      // por omisión: la factura ya ligada o la sugerida por monto
      setEleccion(Object.fromEntries(r.semanas.map((s) => [s.semana, Object.keys(s.facturas)[0] ?? s.sugerida ?? ""])));
    } catch (e) { setError(e as ApiError); } finally { setLoading(false); }
  }, [cliente.id]);
  useEffect(() => { void cargar(); }, [cargar]);

  const porId = useMemo(() => new Map(facturas.map((f) => [f.id, f])), [facturas]);
  const usadas = useMemo(() => new Set(semanas.flatMap((s) => Object.keys(s.facturas))), [semanas]);

  async function ligar(semana: string, facturaId: string | null) {
    setBusy(semana); setError(null); setAviso(null);
    try {
      const r = await postBackend<{ viajes: number }>(`clientes/${cliente.id}/ligar-semana`, JSON.stringify({ semana, factura_id: facturaId }), "application/json");
      setAviso(facturaId ? `${r.viajes} viajes ligados a la factura ${porId.get(facturaId)?.folio ?? ""}.` : `${r.viajes} viajes quedaron sin factura.`);
      await cargar();
    } catch (e) { setError(e as ApiError); } finally { setBusy(null); }
  }

  async function auto() {
    setBusy("auto"); setError(null); setAviso(null);
    try {
      const r = await postBackend<{ ligadas: { folio: string; semana: string; viajes: number }[]; facturas: number }>(`clientes/${cliente.id}/ligar-auto`, "{}", "application/json");
      setAviso(r.ligadas.length
        ? `Ligadas por monto: ${r.ligadas.map((l) => `${l.folio} → semana del ${corta(l.semana)} (${l.viajes} viajes)`).join("; ")}.`
        : `Ninguna factura nueva cuadró por monto (${r.facturas} facturas del cliente con XML).`);
      await cargar();
    } catch (e) { setError(e as ApiError); } finally { setBusy(null); }
  }

  const sinFactura = semanas.filter((s) => s.sin_factura > 0).length;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Cada factura de {cliente.nombre} agrupa los viajes de lunes a domingo, sin importar chofer, tracto o destino. Se reconoce por el RFC o el
          nombre del receptor en su XML y se liga sola si su subtotal es igual al de la semana; si no cuadra, elígela aquí.
          {" "}{facturas.length} facturas con XML · {sinFactura} semanas sin factura.
        </p>
        <Button size="sm" onClick={() => void auto()} disabled={busy !== null}>
          {busy === "auto" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Ligar por monto
        </Button>
      </div>
      {error && <ErrorAlert where="semanas-cliente" message={error.message} status={error.status} path={error.path} />}
      {aviso && <Alert variant="success">{aviso}</Alert>}
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Semana (lun – dom)</TableHead><TableHead className="text-right">Viajes</TableHead>
              <TableHead className="text-right">Cantidad</TableHead><TableHead className="text-right">Subtotal</TableHead>
              <TableHead>Factura</TableHead><TableHead className="text-right">Diferencia</TableHead><TableHead className="w-64">Ligar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Cargando semanas…</TableCell></TableRow>
            ) : semanas.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Sin viajes de este cliente. Importa su Excel de remisiones.</TableCell></TableRow>
            ) : semanas.map((s) => {
              const ligadas = Object.keys(s.facturas).map((id) => porId.get(id)).filter(Boolean) as FacturaCliente[];
              const fac = ligadas[0];
              const dif = fac?.subtotal != null ? fac.subtotal - s.subtotal : null;
              const elegida = eleccion[s.semana] ?? "";
              const ef = elegida ? porId.get(elegida) : undefined;
              return (
                <TableRow key={s.semana} className="cursor-pointer" onClick={() => setDetalle(s)}>
                  <TableCell className="whitespace-nowrap font-medium">{corta(s.semana)} – {corta(s.fin)} {s.fin.slice(0, 4)}</TableCell>
                  <TableCell className="text-right">{s.viajes}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{s.cantidad.toLocaleString("es-MX")}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{mxn(s.subtotal)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {fac ? <span className="font-medium">{fac.folio}</span>
                      : Object.keys(s.facturas).length ? <span>Factura sin XML</span>
                      : <Badge variant="amarillo">Sin factura</Badge>}
                    {s.sin_factura > 0 && Object.keys(s.facturas).length > 0 && <span className="block text-xs text-amber-700">{s.sin_factura} viajes sin factura</span>}
                  </TableCell>
                  <TableCell className={`whitespace-nowrap text-right ${dif != null && Math.abs(dif) > 1 ? "font-semibold text-red-600" : ""}`}>
                    {dif == null ? "—" : Math.abs(dif) <= 1 ? "Cuadra" : mxn(dif)}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <select className={sel} value={elegida} onChange={(e) => setEleccion({ ...eleccion, [s.semana]: e.target.value })}
                        aria-label={`Factura para la semana del ${corta(s.semana)}`}>
                        <option value="">{fac ? "Quitar factura" : "Elegir factura…"}</option>
                        {facturas.filter((f) => !usadas.has(f.id) || s.facturas[f.id]).map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.id === s.sugerida ? "★ " : ""}{f.folio} · {f.fecha ? corta(f.fecha) : "s/f"} · {f.subtotal != null ? mxn(f.subtotal) : "s/subtotal"}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" variant="outline" disabled={busy !== null || (!elegida && !Object.keys(s.facturas).length) || (!!elegida && s.facturas[elegida] === s.viajes)}
                        onClick={() => void ligar(s.semana, elegida || null)}>
                        {busy === s.semana ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : !elegida && Object.keys(s.facturas).length ? "Quitar" : "Ligar"}
                      </Button>
                    </div>
                    {ef?.subtotal != null && !s.facturas[ef.id] && Math.abs(ef.subtotal - s.subtotal) > 1 && (
                      <span className="text-xs text-red-600">No cuadra por {mxn(ef.subtotal - s.subtotal)}</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      <AuditoriaEliminaciones acciones={["viaje_excel_eliminado", "viaje_excel_restaurado", "viaje_excel_corregido"]} refrescar={version} />
      <ViajesPeriodo cliente={cliente} semana={detalle} onClose={() => setDetalle(null)} onCambio={() => { setVersion((v) => v + 1); void cargar(); }} />
    </div>
  );
}
