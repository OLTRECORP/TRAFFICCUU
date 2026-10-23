"use client";

import { useState } from "react";
import type { Cliente } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ViajesPeriodoPanel } from "@/components/clientes/viajes-periodo";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const hoy = () => new Date();
const mes = (delta: number) => {
  const h = hoy();
  return { desde: iso(new Date(Date.UTC(h.getFullYear(), h.getMonth() + delta, 1))), hasta: iso(new Date(Date.UTC(h.getFullYear(), h.getMonth() + delta + 1, 0))) };
};

/** Viajes del cliente en un periodo (cualquier cliente, no solo los de factura semanal): ver, quitar duplicados y corregir. */
export function ViajesCliente({ cliente, onCambio }: { cliente: Cliente; onCambio?: () => void }) {
  const [rango, setRango] = useState(() => mes(0));
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1"><Label htmlFor="vc-desde" className="text-xs">Desde</Label><Input id="vc-desde" type="date" value={rango.desde} max={rango.hasta || undefined} onChange={(e) => setRango({ ...rango, desde: e.target.value })} /></div>
        <div className="grid gap-1"><Label htmlFor="vc-hasta" className="text-xs">Hasta</Label><Input id="vc-hasta" type="date" value={rango.hasta} min={rango.desde || undefined} onChange={(e) => setRango({ ...rango, hasta: e.target.value })} /></div>
        <Button size="sm" variant="outline" onClick={() => setRango(mes(0))}>Este mes</Button>
        <Button size="sm" variant="outline" onClick={() => setRango(mes(-1))}>Mes anterior</Button>
        <Button size="sm" variant="outline" onClick={() => { const h = hoy(); setRango({ desde: iso(new Date(h.getTime() - 89 * 86400000)), hasta: iso(h) }); }}>Últimos 90 días</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Viajes de {cliente.nombre} en el periodo. El lápiz corrige un viaje: los del Excel de remisiones por completo (fecha, remisión, material, cantidad, precio, ruta, chofer y tracto) y los de un XML solo cambian de tracto, góndola o chofer.
      </p>
      <ViajesPeriodoPanel cliente={cliente} desde={rango.desde} hasta={rango.hasta} onCambio={onCambio ?? (() => {})} />
    </div>
  );
}
