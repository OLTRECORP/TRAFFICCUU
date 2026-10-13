"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, MapPin, Route, Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { agrupar, kpis, RANGOS, resumenFacturas, serieFacturacion, type Rango } from "@/lib/dashboard";
import { destinoLabel } from "@/lib/format";
import type { FacturaDia, FacturaEstadistica, FacturaMes, OrdenResumen, Viaje } from "@/lib/types";
import { cn, km, mxn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTheme } from "@/components/theme-provider";
import { ViajeModal } from "@/components/viaje-modal";
import { ViajesTable } from "@/components/viajes-table";
import { BarChart, Donut } from "./charts";
import { FacturasOrdenes } from "./facturas-ordenes";
import { KpiCard } from "./kpi-card";
import { UploadXml } from "./upload-xml";

const SELECT =
  "*, origen:ubicaciones!origen_id(*), destino:ubicaciones!destino_id(*), chofer:choferes(*), lugar_origen:lugares!lugar_origen_id(nombre), lugar_destino:lugares!lugar_destino_id(nombre), tracto:tractocamiones(id,placa), gondola:gondolas(*)";

export function DashboardView() {
  const { empresa } = useTheme();
  const [viajes, setViajes] = useState<Viaje[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Viaje | null>(null);
  const [rango, setRango] = useState<Rango>("1M");
  const [est, setEst] = useState<FacturaEstadistica[]>([]);
  const [meses, setMeses] = useState<FacturaMes[]>([]);
  const [dias, setDias] = useState<FacturaDia[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenResumen[]>([]);
  const [errorFacturas, setErrorFacturas] = useState<string | null>(null);

  const load = useCallback(async () => {
    // PostgREST devuelve máx. 1000 filas por consulta: se pagina hasta traer todos los viajes.
    const sb = createClient();
    const todos: Viaje[] = [];
    for (let d = 0; ; d += 1000) {
      const { data, error } = await sb.from("viajes").select(SELECT)
        .order("fecha", { ascending: false }).order("id").range(d, d + 999);
      if (error) { setError(error.message); setLoading(false); return; }
      todos.push(...((data ?? []) as unknown as Viaje[]));
      if ((data?.length ?? 0) < 1000) break;
    }
    setViajes(todos);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const cargarFacturas = useCallback(async () => {
    const sb = createClient();
    const desde = new Date(Date.now() - 366 * 86_400_000).toISOString().slice(0, 10);
    const [e, m, d, o] = await Promise.all([
      sb.from("facturas_estadisticas").select("estado, complemento, con_orden, con_complemento, n, total"),
      sb.from("facturas_por_mes").select("mes, n, total").order("mes", { ascending: false }).limit(12),
      sb.from("facturas_por_dia").select("dia, n, total").gte("dia", desde).limit(1000),
      sb.from("ordenes_compra_resumen").select("*").limit(1000),
    ]);
    const err = e.error ?? m.error ?? d.error ?? o.error;
    if (err) { setErrorFacturas(err.message); return; }
    setErrorFacturas(null);
    setEst((e.data ?? []) as FacturaEstadistica[]);
    setMeses(((m.data ?? []) as FacturaMes[]).reverse());
    setDias((d.data ?? []) as FacturaDia[]);
    setOrdenes((o.data ?? []) as OrdenResumen[]);
  }, []);
  useEffect(() => { void cargarFacturas(); }, [cargarFacturas]);

  // Lo que baja el SAT (u otra pestaña) se refleja solo: al volver a esta pestaña y cada minuto mientras está visible.
  const recargar = useCallback(() => { void load(); void cargarFacturas(); }, [load, cargarFacturas]);
  useEffect(() => {
    const alVolver = () => { if (document.visibilityState === "visible") recargar(); };
    const t = setInterval(alVolver, 60_000);
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", alVolver); window.removeEventListener("focus", alVolver); };
  }, [recargar]);

  const diasRango = RANGOS.find((r) => r.id === rango)!.dias;
  const k = useMemo(() => kpis(viajes, diasRango), [viajes, diasRango]);
  const hintRango = `Últimos ${diasRango} días`;
  const fact = useMemo(() => resumenFacturas(est), [est]);
  const serie = useMemo(() => serieFacturacion(dias.map((x) => ({ fecha: x.dia, total: Number(x.total) })), rango), [dias, rango]);
  // Viajes por tramo del periodo (14 barritas), solo para el indicador visual.
  const serieViajes = useMemo(() => {
    const n = 14, fin = Date.now(), ms = diasRango * 86_400_000, out = Array<number>(n).fill(0);
    for (const v of viajes) {
      const t = new Date(v.fecha).getTime();
      if (t > fin || t < fin - ms) continue;
      out[Math.min(n - 1, Math.floor(((t - (fin - ms)) / ms) * n))]++;
    }
    return out;
  }, [viajes, diasRango]);
  const porChofer = useMemo(() => agrupar(viajes, (v) => v.chofer?.nombre ?? "Sin chofer"), [viajes]);
  const porDestino = useMemo(() => agrupar(viajes, (v) => destinoLabel(v)), [viajes]);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Resumen de tu operación</p>
          <h2 className="text-3xl font-bold tracking-tight text-primary dark:text-foreground">Bienvenido{empresa ? `, ${empresa}` : ""}</h2>
        </div>
        <UploadXml
          onResult={({ ok, zips, fallos }) => {
            const partes = [
              ok ? `${ok} XML procesado(s) correctamente.` : "",
              zips ? `${zips} .zip enviado(s): se procesan en segundo plano; el detalle de cada archivo está en la bitácora de Facturas.` : "",
            ].filter(Boolean);
            setNotice(partes.length ? partes.join(" ") : null);
            setError(fallos.length ? fallos.join("\n") : null);
            if (ok || zips) recargar();
          }}
        />
      </div>
      {notice && <Alert variant="success">{notice}</Alert>}
      {error && <Alert variant="error" className="whitespace-pre-line">{error}</Alert>}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-muted-foreground">Periodo:</span>
        <div className="flex gap-1 rounded-full border bg-card p-1 text-xs font-semibold" role="tablist" aria-label="Periodo">
          {RANGOS.map((r) => (
            <button key={r.id} role="tab" aria-selected={rango === r.id} onClick={() => setRango(r.id)}
              className={cn("rounded-full px-4 py-1.5 text-muted-foreground hover:text-foreground", rango === r.id && "bg-highlight text-white shadow-sm")}>
              {r.label === "1S" ? "1 semana" : r.label === "1M" ? "1 mes" : r.label === "3M" ? "3 meses" : "1 año"}
            </button>
          ))}
        </div>
      </div>

      <section aria-label="Indicadores" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard serie={serieViajes} icon={Truck} label="Viajes realizados" value={String(k.viajes)} hint={hintRango} />
        <KpiCard icon={Route} label="Km operativos (redondo)" value={km(k.km)} hint={hintRango} />
        <KpiCard serie={serie.map((x) => x.valor)} icon={Banknote} label="Facturación total" value={mxn(fact.total)} hint={`Suma de ${fact.n} facturas vigentes`} />
        <KpiCard icon={MapPin} label="Destino más frecuente" value={k.destinoTop} hint={hintRango} />
      </section>

      <FacturasOrdenes est={est} meses={meses} ordenes={ordenes} error={errorFacturas} />

      <section className="grid gap-4 xl:grid-cols-[1.7fr_1fr]" aria-label="Viajes">
        <div className="grid content-start gap-2">
          <h3 className="text-sm font-semibold text-primary dark:text-foreground">Historial de viajes</h3>
          <ViajesTable viajes={viajes} loading={loading} onSelect={setSelected} />
        </div>
        <div className="grid content-start gap-2">
          <h3 className="text-sm font-semibold text-primary dark:text-foreground">Facturación</h3>
          <Card>
            <CardContent><BarChart puntos={serie} /></CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2" aria-label="Distribución">
        <Card>
          <CardHeader><CardTitle className="text-sm text-primary dark:text-foreground">Viajes por chofer</CardTitle></CardHeader>
          <CardContent><Donut datos={porChofer} titulo="Chofer" centro="Total de viajes" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-primary dark:text-foreground">Viajes por destino</CardTitle></CardHeader>
          <CardContent><Donut datos={porDestino} titulo="Destino" centro="Total de viajes" /></CardContent>
        </Card>
      </section>

      <ViajeModal viaje={selected} onClose={() => setSelected(null)} onChanged={() => void load()} />
    </div>
  );
}
