"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { RotateCcw } from "lucide-react";
import { postBackend } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Registro { id: string; accion: string; referencia: string | null; motivo: string | null; created_at: string; restaurada_at?: string | null }
const ACCION: Record<string, string> = {
  factura_eliminada: "Factura eliminada", factura_restaurada: "Factura restaurada", viaje_excel_eliminado: "Viaje quitado", viaje_excel_restaurado: "Viaje restaurado", viaje_excel_corregido: "Viaje corregido", viaje_reasignado: "Viaje reasignado", tracto_unificado: "Tractos unificados", gondola_unificada: "Góndolas unificadas",
};

/** Últimas eliminaciones y unificaciones, con respaldo completo guardado en la base (auditoria_eliminaciones). */
export function AuditoriaEliminaciones({ acciones, refrescar = 0, onRestaurada }: { acciones: string[]; refrescar?: number; onRestaurada?: (mensaje: string) => void }) {
  const [filas, setFilas] = useState<Registro[]>([]);
  const [restaurando, setRestaurando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clave = acciones.join(",");
  const cargar = useCallback(async () => {
    const { data } = await createClient().from("auditoria_eliminaciones").select("id, accion, referencia, motivo, created_at, restaurada_at")
      .in("accion", clave.split(",")).order("created_at", { ascending: false }).limit(15);
    setFilas((data ?? []) as Registro[]);
  }, [clave]);
  useEffect(() => { void cargar(); }, [cargar, refrescar]);
  async function restaurar(f: Registro) {
    setRestaurando(f.id); setError(null);
    try {
      const r = await postBackend<{ facturas: number; viajes: number; xml: number; completadas?: number }>("facturas/restaurar", JSON.stringify({ ids: [f.id] }), "application/json");
      const detalle = `${r.viajes} viajes y ${r.xml} XML`;
      onRestaurada?.(r.completadas
        ? `La factura ${f.referencia ?? ""} ya existía; se completó con ${detalle} del respaldo. Vuelve a contar en dashboard y reportes.`
        : `Factura ${f.referencia ?? ""} restaurada (${detalle}). Vuelve a contar en dashboard y reportes.`);
      await cargar();
    } catch (e) { setError((e as Error).message); } finally { setRestaurando(null); }
  }
  if (filas.length === 0) return null;
  return (
    <Card className="rounded-xl">
      <CardHeader><CardTitle className="text-sm">Bitácora de depuración</CardTitle></CardHeader>
      <CardContent className="grid gap-1 text-xs">
        {error && <p className="text-destructive">{error}</p>}
        {filas.map((f) => (
          <div key={f.id} className="flex flex-wrap justify-between gap-2 border-b pb-1 last:border-0">
            <span><b>{ACCION[f.accion] ?? f.accion}</b> {f.referencia}{f.motivo ? ` — ${f.motivo}` : ""}</span>
            <span className="flex items-center gap-2 text-muted-foreground">
              {f.accion === "factura_eliminada" && (f.restaurada_at
                ? <span>Restaurada {new Date(f.restaurada_at).toLocaleDateString("es-MX")}</span>
                : <Button size="sm" variant="outline" disabled={restaurando !== null} onClick={() => void restaurar(f)}><RotateCcw className="h-3.5 w-3.5" /> Sacar de la bitácora</Button>)}
              {new Date(f.created_at).toLocaleString("es-MX")}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
