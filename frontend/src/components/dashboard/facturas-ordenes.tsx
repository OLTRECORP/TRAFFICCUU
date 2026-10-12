"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FileText, FileWarning, HandCoins, Receipt, ShoppingCart, Scale } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Punto, Rebanada } from "@/lib/dashboard";
import type { FacturaEstadistica, FacturaMes, OrdenResumen } from "@/lib/types";
import { mxn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Donut } from "./charts";
import { KpiCard } from "./kpi-card";

const mesCorto = (iso: string) => new Intl.DateTimeFormat("es-MX", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(iso));
const suma = (xs: { total: number }[]) => xs.reduce((a, x) => a + Number(x.total), 0);

export function FacturasOrdenes() {
  const [est, setEst] = useState<FacturaEstadistica[]>([]);
  const [meses, setMeses] = useState<FacturaMes[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenResumen[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = createClient();
    void (async () => {
      const [e, m, o] = await Promise.all([
        sb.from("facturas_estadisticas").select("estado, complemento, con_orden, n, total"),
        sb.from("facturas_por_mes").select("mes, n, total").order("mes", { ascending: false }).limit(12),
        sb.from("ordenes_compra_resumen").select("*").limit(1000),
      ]);
      const err = e.error ?? m.error ?? o.error;
      if (err) { setError(err.message); return; }
      setEst((e.data ?? []) as FacturaEstadistica[]);
      setMeses(((m.data ?? []) as FacturaMes[]).reverse());
      setOrdenes((o.data ?? []) as OrdenResumen[]);
    })();
  }, []);

  const k = useMemo(() => {
    const vigentes = est.filter((r) => r.estado !== "cancelado");
    const por = (f: (r: FacturaEstadistica) => boolean) => vigentes.filter(f);
    const sinComp = por((r) => r.complemento !== "COMPLEMENTO LISTO");
    const porCobrar = por((r) => r.estado !== "pagado");
    const cancel = est.filter((r) => r.estado === "cancelado");
    const conDif = ordenes.filter((o) => Math.abs(o.diferencia) > 1);
    return {
      n: vigentes.reduce((a, r) => a + Number(r.n), 0), total: suma(vigentes),
      porCobrarN: porCobrar.reduce((a, r) => a + Number(r.n), 0), porCobrar: suma(porCobrar),
      sinCompN: sinComp.reduce((a, r) => a + Number(r.n), 0), sinComp: suma(sinComp),
      canceladas: cancel.reduce((a, r) => a + Number(r.n), 0),
      sinOrden: por((r) => !r.con_orden).reduce((a, r) => a + Number(r.n), 0),
      ordenesMonto: suma(ordenes.map((o) => ({ total: o.monto }))), conDif: conDif.length,
      difAbs: conDif.reduce((a, o) => a + Math.abs(o.diferencia), 0),
    };
  }, [est, ordenes]);

  const porEstado = useMemo<Rebanada[]>(() => {
    const m = new Map<string, number>();
    for (const r of est) m.set(r.estado, (m.get(r.estado) ?? 0) + Number(r.n));
    return [...m].map(([nombre, valor]) => ({ nombre, valor })).sort((a, b) => b.valor - a.valor);
  }, [est]);
  const serie = useMemo<Punto[]>(() => meses.map((x) => ({ label: mesCorto(x.mes), valor: Number(x.total) })), [meses]);

  return (
    <section className="grid gap-4" aria-label="Facturas y órdenes de compra">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-primary dark:text-foreground">Facturas y órdenes de compra</h3>
        <div className="flex gap-3 text-xs">
          <Link className="font-medium text-highlight hover:underline" href="/facturas">Ver facturas</Link>
          <Link className="font-medium text-highlight hover:underline" href="/ordenes">Ver órdenes</Link>
        </div>
      </div>
      {error && <Alert variant="error">No se pudieron cargar las estadísticas: {error}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard icon={FileText} label="Facturas vigentes" value={String(k.n)} hint={`${mxn(k.total)} · ${k.canceladas} canceladas`} />
        <KpiCard icon={HandCoins} label="Por cobrar" value={mxn(k.porCobrar)} hint={`${k.porCobrarN} facturas sin pagar`} />
        <KpiCard icon={FileWarning} label="Sin complemento de pago" value={String(k.sinCompN)} hint={`${mxn(k.sinComp)} · ${k.sinOrden} sin orden`} />
        <KpiCard icon={ShoppingCart} label="Órdenes de compra" value={String(ordenes.length)} hint={`Monto ${mxn(k.ordenesMonto)}`} />
        <KpiCard icon={Scale} label="Órdenes con diferencia" value={String(k.conDif)} hint={`${mxn(k.difAbs)} de diferencia acumulada`} />
        <KpiCard icon={Receipt} label="Facturado (sin canceladas)" value={mxn(k.total)} hint="Todas las facturas importadas" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <Card className="rounded-xl">
          <CardHeader><CardTitle className="text-sm text-primary dark:text-foreground">Facturación por mes (últimos 12)</CardTitle></CardHeader>
          <CardContent><AreaChart puntos={serie} /></CardContent>
        </Card>
        <Card className="rounded-xl">
          <CardHeader><CardTitle className="text-sm text-primary dark:text-foreground">Facturas por estado</CardTitle></CardHeader>
          <CardContent><Donut datos={porEstado} titulo="Estado" centro="Total de facturas" unidad="Facturas" /></CardContent>
        </Card>
      </div>
    </section>
  );
}
