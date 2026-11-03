"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { todo } from "@/lib/paginar";
import type { Carga, ViajeRend } from "@/lib/combustible";
import type { ServicioGan, ViajeGan } from "@/lib/ganancia";
import { METRICAS, metricasPorTracto, type ClaveMetrica, type MetricasTracto, type ViajeFactura } from "@/lib/metricas";
import { km as kmFmt, mxn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { ErrorAlert } from "@/components/error-alert";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Props {
  viajesGan: ViajeGan[]; cargas: Carga[]; servicios: ServicioGan[]; viajesKm: ViajeRend[];
  placa: Map<string, string>;
}

const nf = (n: number, d = 0) => new Intl.NumberFormat("es-MX", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
function valor(f: MetricasTracto, c: ClaveMetrica, tipo: string) {
  const n = f[c];
  return tipo === "mxn" ? mxn(n) : tipo === "km" ? kmFmt(n) : tipo === "litros" ? `${nf(n, 1)} l` : nf(n);
}

export function MetricasTracto({ viajesGan, cargas, servicios, viajesKm, placa }: Props) {
  const hoy = new Date();
  const [desde, setDesde] = useState(`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`);
  const [hasta, setHasta] = useState(hoy.toISOString().slice(0, 10));
  const [sel, setSel] = useState<Set<ClaveMetrica>>(new Set(METRICAS.map((m) => m.clave)));
  const [viajesFact, setViajesFact] = useState<ViajeFactura[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = createClient();
    todo<{ id: string; tracto_id: string | null; factura_id: string | null; fecha_salida: string | null; fecha: string; factura: { total: number; estado: string | null } | null }>(
      (d, h) => sb.from("viajes").select("id, tracto_id, factura_id, fecha_salida, fecha, factura:facturas!factura_id(total, estado)").not("factura_id", "is", null).order("id").range(d, h),
    ).then((rows) => {
      setViajesFact(rows.filter((r) => r.factura?.estado !== "cancelado").map((r) => ({
        viaje_id: r.id, tracto_id: r.tracto_id, factura_id: r.factura_id,
        fecha_viaje: (r.fecha_salida ?? r.fecha).slice(0, 10), factura_total: r.factura?.total ?? null,
      })));
      setError(null);
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const rangoInvalido = !!desde && !!hasta && desde > hasta;
  const res = useMemo(
    () => (rangoInvalido ? null : metricasPorTracto(desde, hasta, viajesGan, cargas, servicios, viajesKm, viajesFact)),
    [rangoInvalido, desde, hasta, viajesGan, cargas, servicios, viajesKm, viajesFact],
  );
  const cols = METRICAS.filter((m) => sel.has(m.clave));
  const todos = sel.size === METRICAS.length;
  const alternar = (c: ClaveMetrica) => setSel((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });

  return (
    <div className="grid gap-4">
      {error && <ErrorAlert where="facturas por tracto" message={error} />}
      <Card>
        <CardContent className="grid gap-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="mt-desde">Fecha de inicio</Label><Input id="mt-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="mt-hasta">Fecha de fin</Label><Input id="mt-hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Métricas a mostrar</legend>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={todos} onChange={() => setSel(new Set(todos ? [] : METRICAS.map((m) => m.clave)))} /> Todas juntas
            </label>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {METRICAS.map((m) => (
                <label key={m.clave} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={sel.has(m.clave)} onChange={() => alternar(m.clave)} /> {m.label}
                </label>
              ))}
            </div>
          </fieldset>
        </CardContent>
      </Card>

      {rangoInvalido && <Alert variant="error">La fecha de inicio es posterior a la de fin.</Alert>}
      {res && cols.length === 0 && <Alert variant="info">Selecciona al menos una métrica.</Alert>}
      {res && cols.length > 0 && (
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Tracto</TableHead>
                {cols.map((c) => <TableHead key={c.clave} className="text-right">{c.label}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {res.filas.length === 0 ? (
                <TableRow><TableCell colSpan={cols.length + 1} className="py-8 text-center text-muted-foreground">Sin viajes, cargas ni servicios en el periodo.</TableCell></TableRow>
              ) : res.filas.map((f) => (
                <TableRow key={f.id ?? "sin"}>
                  <TableCell className="font-medium">
                    {f.id ? placa.get(f.id) ?? "—" : "Sin tracto"}
                    {sel.has("costoCombustible") && f.cargasSinCosto > 0 && <span className="block text-xs font-normal text-amber-600">{f.cargasSinCosto} carga(s) sin costo, cuentan $0</span>}
                  </TableCell>
                  {cols.map((c) => <TableCell key={c.clave} className="whitespace-nowrap text-right">{valor(f, c.clave, c.tipo)}</TableCell>)}
                </TableRow>
              ))}
              {res.filas.length > 0 && (
                <TableRow className="bg-secondary/40 font-semibold hover:bg-secondary/40">
                  <TableCell>Total</TableCell>
                  {cols.map((c) => <TableCell key={c.clave} className="whitespace-nowrap text-right">{valor(res.total, c.clave, c.tipo)}</TableCell>)}
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}
      <div className="grid gap-1 text-xs text-muted-foreground">
        <p><b>Cómo se calcula:</b> todo por fecha inclusive. Viajes, facturas y km por la fecha de salida del viaje; combustible por la fecha de la carga; mantenimiento por la fecha del servicio. Mismo cálculo que la pestaña Ganancia; facturas canceladas excluidas. Los km son redondos (del mapa).</p>
        <p><b>Facturas</b> = facturas distintas ligadas a los viajes del tracto; <b>monto</b> = su total con IVA. Una factura semanal que cubre varios tractos se cuenta completa en cada uno, pero una sola vez en el Total. No incluye góndolas.</p>
      </div>
    </div>
  );
}
