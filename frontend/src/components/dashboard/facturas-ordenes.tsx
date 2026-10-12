"use client";

import Link from "next/link";
import { useMemo } from "react";
import { CircleCheck, FileText, FileWarning, HandCoins, ShoppingCart, Scale } from "lucide-react";
import { resumenFacturas, type Punto, type Rebanada } from "@/lib/dashboard";
import type { FacturaEstadistica, FacturaMes, OrdenResumen } from "@/lib/types";
import { mxn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Donut } from "./charts";
import { KpiCard } from "./kpi-card";

const mesCorto = (iso: string) => new Intl.DateTimeFormat("es-MX", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(iso));
const suma = (xs: { total: number }[]) => xs.reduce((a, x) => a + Number(x.total), 0);

export function FacturasOrdenes({ est, meses, ordenes, error }: {
  est: FacturaEstadistica[]; meses: FacturaMes[]; ordenes: OrdenResumen[]; error: string | null;
}) {
  const f = useMemo(() => resumenFacturas(est), [est]);
  const k = useMemo(() => {
    const conDif = ordenes.filter((o) => Math.abs(o.diferencia) > 1);
    return {
      ordenesMonto: suma(ordenes.map((o) => ({ total: o.monto }))), conDif: conDif.length,
      difAbs: conDif.reduce((a, o) => a + Math.abs(o.diferencia), 0),
    };
  }, [ordenes]);

  // Estado "visible": con complemento = pagado, aunque el Excel diga activado.
  const porEstado = useMemo<Rebanada[]>(() => {
    const m = new Map<string, number>();
    for (const r of est) {
      const nombre = r.estado !== "cancelado" && r.con_complemento ? "pagado" : r.estado;
      m.set(nombre, (m.get(nombre) ?? 0) + Number(r.n));
    }
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
        <KpiCard icon={FileText} label="Facturas vigentes" value={String(f.n)} hint={`${mxn(f.total)} · ${f.canceladas} canceladas`} />
        <KpiCard icon={CircleCheck} label="Pagadas" value={mxn(f.pagadas)} hint={`${f.pagadasN} facturas pagadas o con complemento`} />
        <KpiCard icon={HandCoins} label="Por cobrar" value={mxn(f.porCobrar)} hint={`${f.porCobrarN} facturas sin pagar ni complemento`} />
        <KpiCard icon={FileWarning} label="Sin complemento de pago" value={String(f.sinCompN)} hint={`${mxn(f.sinComp)} · ${f.sinOrden} sin orden`} />
        <KpiCard icon={ShoppingCart} label="Órdenes de compra" value={String(ordenes.length)} hint={`Monto ${mxn(k.ordenesMonto)}`} />
        <KpiCard icon={Scale} label="Órdenes con diferencia" value={String(k.conDif)} hint={`${mxn(k.difAbs)} de diferencia acumulada`} />
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
