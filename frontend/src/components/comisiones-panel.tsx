"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { comisionViaje, estadisticas, etiquetaSemanaPago, etiquetaTasas, semanaPago, semanaPagoDesplazada, tasaDe, totales, type Periodo, type ViajeComision } from "@/lib/comisiones";
import type { Chofer } from "@/lib/types";
import { fechaMx, mxn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ComisionesDetalle, type DetalleComision } from "@/components/comisiones-detalle";
import { ErrorAlert } from "@/components/error-alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const sel = "h-10 rounded-md border bg-background px-3 text-sm";

/** Hoy en hora local (YYYY-MM-DD). */
const hoyLocal = () => new Date().toLocaleDateString("en-CA");
const PAG = 1000;

function Kpi({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  const cuerpo = (
    <CardContent className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
      {onClick && <p className="mt-1 text-xs font-medium text-highlight">Ver facturas y viajes incluidos →</p>}
    </CardContent>
  );
  if (!onClick) return <Card>{cuerpo}</Card>;
  return (
    <button type="button" onClick={onClick} className="rounded-[inherit] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="h-full cursor-pointer transition-shadow hover:shadow-md">{cuerpo}</Card>
    </button>
  );
}

export function ComisionesPanel() {
  const [choferes, setChoferes] = useState<Pick<Chofer, "id" | "nombre">[]>([]);
  const [choferId, setChoferId] = useState("");
  // Por defecto: semana de pago (vie–jue) más reciente ya cerrada, la que se paga este viernes o el último.
  const [modo, setModo] = useState<"semana" | "rango">("semana");
  const [semana, setSemana] = useState(() => semanaPagoDesplazada(hoyLocal(), -1));
  const [desdeLibre, setDesdeLibre] = useState("");
  const [hastaLibre, setHastaLibre] = useState("");
  const desde = modo === "semana" ? semana.desde : desdeLibre;
  const hasta = modo === "semana" ? semana.hasta : hastaLibre;
  const setDesde = setDesdeLibre, setHasta = setHastaLibre;
  const hoy = hoyLocal();
  const semanaEnCurso = modo === "semana" && hoy >= semana.desde && hoy <= semana.hasta;
  const moverSemana = (delta: number) => setSemana((s) => semanaPagoDesplazada(s.desde, delta));
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
          .select("viaje_id, chofer_id, folio, fecha_viaje, subtotal, origen, destino, cliente, remision, tasa_comision")
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
          .select("viaje_id, chofer_id, folio, fecha_viaje, subtotal, origen, destino, cliente, remision, tasa_comision")
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

  // Detalle (ventana) de las facturas/viajes que componen una comisión.
  const [detalle, setDetalle] = useState<DetalleComision | null>(null);
  const nombreChofer = choferes.find((c) => c.id === choferId)?.nombre ?? "chofer";
  const tituloPeriodo = modo === "semana" ? etiquetaSemanaPago(semana)
    : desde || hasta ? `${desde ? fechaMx(desde) : "inicio"} – ${hasta ? fechaMx(hasta) : "hoy"}` : "Todo el historial";

  return (
    <div className="grid gap-4">
      {error && <ErrorAlert where="comisiones" message={error} />}

      <Card>
        <CardContent className="grid gap-3 p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
            <div className="grid gap-1.5">
              <Label htmlFor="com-chofer">Chofer</Label>
              <select id="com-chofer" className={sel} value={choferId} onChange={(e) => setChoferId(e.target.value)}>
                <option value="">Selecciona un chofer…</option>
                {choferes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="com-modo">Periodo</Label>
              <select id="com-modo" className={sel} value={modo} onChange={(e) => setModo(e.target.value as "semana" | "rango")}>
                <option value="semana">Semanal (viernes a jueves)</option>
                <option value="rango">Rango personalizado</option>
              </select>
            </div>
          </div>

          {modo === "semana" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="icon" onClick={() => moverSemana(-1)} aria-label="Semana anterior"><ChevronLeft className="h-4 w-4" /></Button>
              <p className="min-w-0 flex-1 text-center text-sm font-medium sm:flex-none sm:px-2">{etiquetaSemanaPago(semana)}</p>
              <Button type="button" variant="outline" size="icon" onClick={() => moverSemana(1)} aria-label="Semana siguiente"><ChevronRight className="h-4 w-4" /></Button>
              {semanaEnCurso && <Badge variant="amarillo">En curso: aún no se cierra</Badge>}
              <Button type="button" variant="ghost" size="sm" onClick={() => setSemana(semanaPagoDesplazada(hoy, -1))}>Última cerrada</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSemana(semanaPago(hoy))}>En curso</Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="com-desde">Viajes desde</Label>
                <Input id="com-desde" type="date" value={desdeLibre} max={hastaLibre || undefined} onChange={(e) => setDesde(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="com-hasta">Viajes hasta</Label>
                <Input id="com-hasta" type="date" value={hastaLibre} min={desdeLibre || undefined} onChange={(e) => setHasta(e.target.value)} />
              </div>
            </div>
          )}
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
              <Kpi label="Viajes" value={String(tot.viajes)} onClick={() => setDetalle({ titulo: tituloPeriodo, chofer: nombreChofer, viajes: enRango })} />
              <Kpi label="Subtotal facturado (sin IVA)" value={mxn(tot.subtotal)} onClick={() => setDetalle({ titulo: tituloPeriodo, chofer: nombreChofer, viajes: enRango })} />
              <Kpi label={`Comisión ${etiquetaTasas(enRango)}`} value={mxn(tot.comision)} onClick={() => setDetalle({ titulo: tituloPeriodo, chofer: nombreChofer, viajes: enRango })} />
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
                    <TableHead className="text-right">%</TableHead>
                    <TableHead className="text-right">Comisión</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enRango.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Sin viajes en el rango seleccionado.</TableCell></TableRow>
                  ) : enRango.map((v) => (
                    <TableRow key={v.viaje_id}>
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
                {enRango.length > 0 && (
                  <tfoot className="border-t bg-secondary/50">
                    <TableRow>
                      <TableCell colSpan={4} className="font-semibold">Total · {tot.viajes} viajes</TableCell>
                      <TableCell className="text-right font-semibold">{mxn(tot.subtotal)}</TableCell>
                      <TableCell />
                      <TableCell className="text-right font-semibold">{mxn(tot.comision)}</TableCell>
                    </TableRow>
                  </tfoot>
                )}
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="estadisticas">
            <Historial viajes={viajes} onDetalle={(titulo, v) => setDetalle({ titulo, chofer: nombreChofer, viajes: v })} />
          </TabsContent>
        </Tabs>
      )}

      <ComisionesDetalle detalle={detalle} onClose={() => setDetalle(null)} />

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
                  <TableCell className="whitespace-nowrap font-medium">{v.folio ?? (v.remision ? `Rem. ${v.remision}` : "—")}{v.folio && v.remision && <span className="block text-xs font-normal text-muted-foreground">Rem. {v.remision}</span>}</TableCell>
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

function Historial({ viajes, onDetalle }: { viajes: ViajeComision[]; onDetalle: (titulo: string, v: ViajeComision[]) => void }) {
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
          <TabsContent key={p} value={p}><TablaPeriodo viajes={viajes} periodo={p} onDetalle={onDetalle} /></TabsContent>
        ))}
      </Tabs>
      <p className="text-xs text-muted-foreground">Haz clic en una fila para ver sus facturas y viajes. Semanas de pago: de viernes a jueves; se pagan el viernes siguiente al cierre. Fecha del viaje = salida del origen en la Carta Porte. No incluye facturas canceladas.</p>
    </div>
  );
}

function TablaPeriodo({ viajes, periodo, onDetalle }: { viajes: ViajeComision[]; periodo: Periodo; onDetalle: (titulo: string, v: ViajeComision[]) => void }) {
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
            <TableRow key={f.clave} tabIndex={0} className="cursor-pointer" aria-label={`Ver facturas de ${f.etiqueta}`}
              onClick={() => onDetalle(f.etiqueta, f.detalle)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onDetalle(f.etiqueta, f.detalle)}>
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
