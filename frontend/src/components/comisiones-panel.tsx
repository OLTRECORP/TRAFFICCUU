"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { comisionDe, estadisticas, TASA_COMISION, totales, type Periodo, type ViajeComision } from "@/lib/comisiones";
import type { Chofer } from "@/lib/types";
import { fechaMx, mxn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { ErrorAlert } from "@/components/error-alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const sel = "h-10 rounded-md border bg-background px-3 text-sm";
const PAG = 1000;

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card><CardContent className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </CardContent></Card>
  );
}

export function ComisionesPanel() {
  const [choferes, setChoferes] = useState<Pick<Chofer, "id" | "nombre">[]>([]);
  const [choferId, setChoferId] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [viajes, setViajes] = useState<ViajeComision[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void createClient().from("choferes").select("id, nombre").order("nombre").limit(1000)
      .then(({ data, error: e }) => { if (e) setError(e.message); else setChoferes((data ?? []) as Pick<Chofer, "id" | "nombre">[]); });
  }, []);

  // Todo el historial del chofer (en páginas de 1000): el rango filtra y las estadísticas usan todo.
  useEffect(() => {
    if (!choferId) { setViajes([]); return; }
    let vigente = true;
    setLoading(true);
    (async () => {
      const sb = createClient();
      const acum: ViajeComision[] = [];
      for (let desdeFila = 0; ; desdeFila += PAG) {
        const { data, error: e } = await sb.from("comisiones_viajes")
          .select("viaje_id, chofer_id, folio, fecha_viaje, subtotal, origen, destino, cliente")
          .eq("chofer_id", choferId)
          .order("fecha_viaje", { ascending: false }).order("viaje_id")
          .range(desdeFila, desdeFila + PAG - 1);
        if (!vigente) return;
        if (e) { setError(e.message); setLoading(false); return; }
        acum.push(...((data ?? []) as ViajeComision[]));
        if ((data?.length ?? 0) < PAG) break;
      }
      setError(null); setViajes(acum); setLoading(false);
    })();
    return () => { vigente = false; };
  }, [choferId]);

  // Viajes sin chofer asignado: se listan aparte y no generan comisión hasta asignarles chofer.
  const [sinChofer, setSinChofer] = useState<ViajeComision[]>([]);
  useEffect(() => {
    let vigente = true;
    (async () => {
      const sb = createClient();
      const acum: ViajeComision[] = [];
      for (let d = 0; ; d += PAG) {
        const { data, error: e } = await sb.from("comisiones_viajes")
          .select("viaje_id, chofer_id, folio, fecha_viaje, subtotal, origen, destino, cliente")
          .is("chofer_id", null)
          .order("fecha_viaje", { ascending: false }).order("viaje_id")
          .range(d, d + PAG - 1);
        if (!vigente) return;
        if (e) { setError(e.message); return; }
        acum.push(...((data ?? []) as ViajeComision[]));
        if ((data?.length ?? 0) < PAG) break;
      }
      setSinChofer(acum);
    })();
    return () => { vigente = false; };
  }, []);
  const sinChoferRango = useMemo(
    () => sinChofer.filter((v) => (!desde || v.fecha_viaje >= desde) && (!hasta || v.fecha_viaje <= hasta)),
    [sinChofer, desde, hasta],
  );

  const enRango = useMemo(
    () => viajes.filter((v) => (!desde || v.fecha_viaje >= desde) && (!hasta || v.fecha_viaje <= hasta)),
    [viajes, desde, hasta],
  );
  const tot = useMemo(() => totales(enRango), [enRango]);
  const rangoInvalido = !!desde && !!hasta && desde > hasta;

  return (
    <div className="grid gap-4">
      {error && <ErrorAlert where="comisiones" message={error} />}

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="com-chofer">Chofer</Label>
            <select id="com-chofer" className={sel} value={choferId} onChange={(e) => setChoferId(e.target.value)}>
              <option value="">Selecciona un chofer…</option>
              {choferes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="com-desde">Viajes desde</Label>
            <Input id="com-desde" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="com-hasta">Viajes hasta</Label>
            <Input id="com-hasta" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {!choferId ? (
        <Alert variant="info">Selecciona un chofer para ver sus facturas, destinos y comisiones.</Alert>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Calculando comisiones…</p>
      ) : (
        <Tabs defaultValue="calculo">
          <TabsList>
            <TabsTrigger value="calculo">Cálculo</TabsTrigger>
            <TabsTrigger value="estadisticas">Estadísticas e historial</TabsTrigger>
          </TabsList>

          <TabsContent value="calculo" className="grid gap-4">
            {rangoInvalido && <Alert variant="error">La fecha inicial es posterior a la final.</Alert>}
            <div className="grid gap-3 sm:grid-cols-3">
              <Kpi label="Viajes" value={String(tot.viajes)} />
              <Kpi label="Subtotal facturado (sin IVA)" value={mxn(tot.subtotal)} />
              <Kpi label={`Comisión ${TASA_COMISION * 100}%`} value={mxn(tot.comision)} />
            </div>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Fecha de salida</TableHead>
                    <TableHead>Factura</TableHead>
                    <TableHead>Origen</TableHead>
                    <TableHead>Destino</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                    <TableHead className="text-right">Comisión</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enRango.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Sin viajes en el rango seleccionado.</TableCell></TableRow>
                  ) : enRango.map((v) => (
                    <TableRow key={v.viaje_id}>
                      <TableCell className="whitespace-nowrap">{fechaMx(v.fecha_viaje)}</TableCell>
                      <TableCell className="whitespace-nowrap font-medium">{v.folio ?? "—"}</TableCell>
                      <TableCell>{v.origen ?? "—"}</TableCell>
                      <TableCell>{v.destino ?? "—"}{v.cliente && <span className="block text-xs text-muted-foreground">{v.cliente}</span>}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">{mxn(v.subtotal)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium">{mxn(comisionDe(v.subtotal))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {enRango.length > 0 && (
                  <tfoot className="border-t bg-secondary/50">
                    <TableRow>
                      <TableCell colSpan={4} className="font-semibold">Total · {tot.viajes} viajes</TableCell>
                      <TableCell className="text-right font-semibold">{mxn(tot.subtotal)}</TableCell>
                      <TableCell className="text-right font-semibold">{mxn(tot.comision)}</TableCell>
                    </TableRow>
                  </tfoot>
                )}
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="estadisticas">
            <Historial viajes={viajes} />
          </TabsContent>
        </Tabs>
      )}

      {sinChoferRango.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Viajes sin chofer asignado ({sinChoferRango.length})</CardTitle>
            <p className="text-sm text-muted-foreground">Sin comisión hasta que se les asigne un chofer. Respetan el rango de fechas.</p>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Fecha de salida</TableHead>
                <TableHead>Factura</TableHead>
                <TableHead>Origen</TableHead>
                <TableHead>Destino</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sinChoferRango.map((v) => (
                <TableRow key={v.viaje_id}>
                  <TableCell className="whitespace-nowrap">{fechaMx(v.fecha_viaje)}</TableCell>
                  <TableCell className="whitespace-nowrap font-medium">{v.folio ?? "—"}</TableCell>
                  <TableCell>{v.origen ?? "—"}</TableCell>
                  <TableCell>{v.destino ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{mxn(v.subtotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function Historial({ viajes }: { viajes: ViajeComision[] }) {
  const general = useMemo(() => totales(viajes), [viajes]);
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Viajes (historial completo)" value={String(general.viajes)} />
        <Kpi label="Subtotal facturado" value={mxn(general.subtotal)} />
        <Kpi label="Comisión acumulada" value={mxn(general.comision)} />
      </div>
      <Tabs defaultValue="mes">
        <TabsList>
          <TabsTrigger value="mes">Por mes</TabsTrigger>
          <TabsTrigger value="semana">Por semana</TabsTrigger>
          <TabsTrigger value="anio">Por año</TabsTrigger>
        </TabsList>
        {(["mes", "semana", "anio"] as Periodo[]).map((p) => (
          <TabsContent key={p} value={p}><TablaPeriodo viajes={viajes} periodo={p} /></TabsContent>
        ))}
      </Tabs>
      <p className="text-xs text-muted-foreground">Semanas ISO (inicio en lunes). Fecha del viaje = salida del origen en la Carta Porte. No incluye facturas canceladas.</p>
    </div>
  );
}

function TablaPeriodo({ viajes, periodo }: { viajes: ViajeComision[]; periodo: Periodo }) {
  const filas = useMemo(() => estadisticas(viajes, periodo), [viajes, periodo]);
  const max = Math.max(1, ...filas.map((f) => f.comision));
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{periodo === "mes" ? "Mes" : periodo === "semana" ? "Semana" : "Año"}</TableHead>
            <TableHead className="text-right">Viajes</TableHead>
            <TableHead className="text-right">Subtotal</TableHead>
            <TableHead className="text-right">Comisión</TableHead>
            <TableHead className="w-40" aria-hidden />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filas.length === 0 ? (
            <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Este chofer aún no tiene viajes con factura.</TableCell></TableRow>
          ) : filas.map((f) => (
            <TableRow key={f.clave}>
              <TableCell className="whitespace-nowrap font-medium">{f.etiqueta}</TableCell>
              <TableCell className="text-right">{f.viajes}</TableCell>
              <TableCell className="whitespace-nowrap text-right">{mxn(f.subtotal)}</TableCell>
              <TableCell className="whitespace-nowrap text-right font-medium">{mxn(f.comision)}</TableCell>
              <TableCell>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-primary" style={{ width: `${(f.comision / max) * 100}%` }} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
