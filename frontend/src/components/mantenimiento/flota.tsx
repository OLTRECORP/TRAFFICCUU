"use client";

import { useMemo } from "react";
import type { Alerta, Nivel } from "@/lib/mantenimiento";
import { textoRestante } from "@/lib/mantenimiento";
import type { OdometroTracto, Regla, Tracto } from "@/lib/types";
import { cn, km } from "@/lib/utils";
import type { ResumenLlantas } from "@/lib/llantas";
import { CATEGORIAS_SERVICIO } from "@/components/ficha-servicios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const COLOR: Record<Nivel, string> = { rojo: "bg-red-500", amarillo: "bg-amber-400", verde: "bg-emerald-500" };
export const TEXTO: Record<Nivel, string> = { rojo: "text-red-600 dark:text-red-400", amarillo: "text-amber-600 dark:text-amber-400", verde: "text-emerald-700 dark:text-emerald-400" };
export const rubro = (v: string | null) => CATEGORIAS_SERVICIO.find((c) => c.value === v)?.label ?? "Sin rubro";

/** Barra de vida restante de un servicio: se vacía conforme se acerca el siguiente y cambia de color. */
export function BarraVida({ a, delgada }: { a: Alerta; delgada?: boolean }) {
  const vida = Math.max(0, 100 - a.porcentaje);
  if (!a.km && !a.dias) return <div className={cn("rounded-full border border-dashed", delgada ? "h-1.5" : "h-2.5")} aria-label={`${a.regla.tipo_servicio}: sin datos`} />;
  return (
    <div className={cn("overflow-hidden rounded-full bg-secondary", delgada ? "h-1.5" : "h-2.5")} role="progressbar"
      aria-label={`${a.regla.tipo_servicio}: ${Math.round(vida)}% de vida`} aria-valuenow={Math.round(vida)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full", COLOR[a.nivel])} style={{ width: `${a.porcentaje >= 100 ? 100 : Math.max(4, vida)}%` }} />
    </div>
  );
}

/** Todos los tractos contra todos los servicios programados (agrupados por rubro), del más urgente al menos urgente. */
export function FlotaMantenimiento({ filas, reglas, odometros, llantas, onElegir }: {
  filas: { tracto: Tracto; alertas: Alerta[] }[]; reglas: Regla[]; odometros: Map<string, OdometroTracto>;
  llantas: Map<string, ResumenLlantas>; onElegir: (id: string) => void;
}) {
  const orden = useMemo(() => {
    const peso = (f: { alertas: Alerta[] }) => Math.max(0, ...f.alertas.map((a) => a.porcentaje));
    return [...filas].sort((a, b) => peso(b) - peso(a));
  }, [filas]);
  const columnas = useMemo(() => [...reglas].sort((a, b) => rubro(a.categoria).localeCompare(rubro(b.categoria)) || a.tipo_servicio.localeCompare(b.tipo_servicio)), [reglas]);
  const conteo = useMemo(() => {
    const c = { rojo: 0, amarillo: 0, verde: 0 };
    for (const f of filas) for (const a of f.alertas) c[a.nivel]++;
    return c;
  }, [filas]);

  return (
    <Card className="rounded-xl">
      <CardHeader className="gap-2">
        <CardTitle className="text-base">Toda la flota: tiempo y kilometraje para el siguiente servicio</CardTitle>
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-full", COLOR.rojo)} /> {conteo.rojo} vencidos</span>
          <span className="flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-full", COLOR.amarillo)} /> {conteo.amarillo} próximos (≥ 90 %)</span>
          <span className="flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-full", COLOR.verde)} /> {conteo.verde} al día</span>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="sticky left-0 bg-card px-2 pb-1 font-medium">Tracto</th>
              {columnas.map((r) => (
                <th key={r.id} className="px-2 pb-1 font-medium">
                  <span className="block text-[11px] uppercase tracking-wide">{rubro(r.categoria)}</span>
                  <span className="text-foreground">{r.tipo_servicio}</span>
                  <span className="block font-normal">{[r.intervalo_km ? km(r.intervalo_km) : null, r.intervalo_dias ? `${r.intervalo_dias} días` : null].filter(Boolean).join(" o ")}</span>
                </th>
              ))}
              <th className="px-2 pb-1 font-medium">
                <span className="block text-[11px] uppercase tracking-wide">Llantas</span>
                <span className="text-foreground">Por cambiar</span>
                <span className="block font-normal">tracto + góndola</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {orden.map(({ tracto, alertas }) => {
              const o = odometros.get(tracto.id);
              return (
                <tr key={tracto.id} className="cursor-pointer rounded-lg hover:bg-accent" onClick={() => onElegir(tracto.id)}>
                  <td className="sticky left-0 rounded-l-lg bg-card px-2 py-2 align-top">
                    <span className="font-semibold">{tracto.placa}</span>
                    <span className="block text-xs text-muted-foreground">{km(tracto.kilometraje_actual)}{o?.fuente === "servicio" ? " est." : ""}</span>
                  </td>
                  {columnas.map((r) => {
                    const a = alertas.find((x) => x.regla.id === r.id);
                    if (!a) return <td key={r.id} />;
                    return (
                      <td key={r.id} className="px-2 py-2 align-top last:rounded-r-lg">
                        <BarraVida a={a} />
                        <span className={cn("mt-1 block text-xs", !a.km && !a.dias ? "text-muted-foreground" : TEXTO[a.nivel])}>{textoRestante(a, km)}</span>
                      </td>
                    );
                  })}
                  <td className="px-2 py-2 align-top last:rounded-r-lg"><ConteoLlantas r={llantas.get(tracto.id)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">
          La barra es la vida que le queda al servicio (por km o por días, lo que llegue primero). «est.» = odómetro estimado con el último
          servicio registrado más los km de los viajes posteriores. «Llantas por cambiar» cuenta las vencidas y las que pasan del 90 % de
          su vida, del tracto y de la góndola de su último viaje. Haz clic en un tracto para ver su detalle.
        </p>
      </CardContent>
    </Card>
  );
}

/** Mini barra apilada de las llantas de un tracto (y su góndola) por nivel, con cuántas conviene cambiar. */
function ConteoLlantas({ r }: { r?: ResumenLlantas }) {
  if (!r || r.sinRegistro === r.total) return <span className="text-xs text-muted-foreground">sin registro</span>;
  const seg: [number, string][] = [[r.vencidas, COLOR.rojo], [r.proximas, COLOR.amarillo], [r.bien, COLOR.verde], [r.sinRegistro, "bg-secondary"]];
  return (
    <div className="grid gap-1" aria-label={`${r.recomendadas} de ${r.total} llantas por cambiar`}>
      <div className="flex h-2.5 gap-px overflow-hidden rounded-full">
        {seg.filter(([n]) => n > 0).map(([n, c], i) => <span key={i} className={c} style={{ flexGrow: n }} />)}
      </div>
      <span className={cn("text-xs", r.vencidas ? TEXTO.rojo : r.proximas ? TEXTO.amarillo : TEXTO.verde)}>
        {r.recomendadas ? `${r.recomendadas} de ${r.total}` : "ninguna"}{r.vencidas ? ` (${r.vencidas} ya)` : ""}
      </span>
    </div>
  );
}
