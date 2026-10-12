"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, MapPin, Route, Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { agrupar, kpis, RANGOS, serieFacturacion, type Rango } from "@/lib/dashboard";
import { ubicacionLabel } from "@/lib/format";
import type { Viaje } from "@/lib/types";
import { cn, km, mxn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTheme } from "@/components/theme-provider";
import { ViajeModal } from "@/components/viaje-modal";
import { ViajesTable } from "@/components/viajes-table";
import { AreaChart, Donut } from "./charts";
import { FacturasOrdenes } from "./facturas-ordenes";
import { KpiCard } from "./kpi-card";
import { UploadXml } from "./upload-xml";

const SELECT =
  "*, origen:ubicaciones!origen_id(*), destino:ubicaciones!destino_id(*), chofer:choferes(*), tracto:tractocamiones(id,placa), gondola:gondolas(*)";

export function DashboardView() {
  const { empresa } = useTheme();
  const [viajes, setViajes] = useState<Viaje[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Viaje | null>(null);
  const [rango, setRango] = useState<Rango>("1M");

  const load = useCallback(async () => {
    const { data, error } = await createClient().from("viajes").select(SELECT).order("fecha", { ascending: false }).limit(1000);
    if (error) setError(error.message);
    else setViajes((data ?? []) as unknown as Viaje[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const k = useMemo(() => kpis(viajes), [viajes]);
  const serie = useMemo(() => serieFacturacion(viajes, rango), [viajes, rango]);
  const porChofer = useMemo(() => agrupar(viajes, (v) => v.chofer?.nombre ?? "Sin chofer"), [viajes]);
  const porDestino = useMemo(() => agrupar(viajes, (v) => ubicacionLabel(v.destino)), [viajes]);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-primary dark:text-foreground">Bienvenido{empresa ? `, ${empresa}` : ""}</h2>
        <UploadXml
          onResult={({ ok, fallos }) => {
            setNotice(ok ? `${ok} XML procesado(s) correctamente.` : null);
            setError(fallos.length ? fallos.join("\n") : null);
            if (ok) load();
          }}
        />
      </div>
      {notice && <Alert variant="success">{notice}</Alert>}
      {error && <Alert variant="error" className="whitespace-pre-line">{error}</Alert>}

      <section aria-label="Indicadores" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Truck} label="Viajes realizados" value={String(k.viajes)} hint="Últimos 30 días" />
        <KpiCard icon={Route} label="Km operativos (redondo)" value={km(k.km)} hint="Últimos 30 días" />
        <KpiCard icon={Banknote} label="Facturación total" value={mxn(k.facturacion)} hint="Últimos 30 días" />
        <KpiCard icon={MapPin} label="Destino más frecuente" value={k.destinoTop} hint="Últimos 30 días" />
      </section>

      <FacturasOrdenes />

      <section className="grid gap-4 xl:grid-cols-[1.7fr_1fr]" aria-label="Viajes">
        <div className="grid content-start gap-2">
          <h3 className="text-sm font-semibold text-primary dark:text-foreground">Historial de viajes</h3>
          <ViajesTable viajes={viajes} loading={loading} onSelect={setSelected} />
        </div>
        <div className="grid content-start gap-2">
          <h3 className="text-sm font-semibold text-primary dark:text-foreground">Facturación</h3>
          <Card className="rounded-xl">
            <CardHeader className="flex-row items-center justify-end pb-0">
              <div className="flex gap-1 text-xs font-semibold" role="tablist" aria-label="Periodo">
                {RANGOS.map((r) => (
                  <button key={r.id} role="tab" aria-selected={rango === r.id} onClick={() => setRango(r.id)}
                    className={cn("rounded px-2 py-1 text-muted-foreground hover:text-foreground", rango === r.id && "bg-highlight/15 text-highlight")}>
                    {r.label}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent><AreaChart puntos={serie} /></CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2" aria-label="Distribución">
        <Card className="rounded-xl">
          <CardHeader><CardTitle className="text-sm text-primary dark:text-foreground">Viajes por chofer</CardTitle></CardHeader>
          <CardContent><Donut datos={porChofer} titulo="Chofer" centro="Total de viajes" /></CardContent>
        </Card>
        <Card className="rounded-xl">
          <CardHeader><CardTitle className="text-sm text-primary dark:text-foreground">Viajes por destino</CardTitle></CardHeader>
          <CardContent><Donut datos={porDestino} titulo="Destino" centro="Total de viajes" /></CardContent>
        </Card>
      </section>

      <ViajeModal viaje={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
