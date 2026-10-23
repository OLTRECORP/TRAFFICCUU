"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Registro { id: string; accion: string; referencia: string | null; motivo: string | null; created_at: string }
const ACCION: Record<string, string> = {
  factura_eliminada: "Factura eliminada", viaje_excel_eliminado: "Viaje quitado", viaje_excel_restaurado: "Viaje restaurado", viaje_excel_corregido: "Viaje corregido", tracto_unificado: "Tractos unificados", gondola_unificada: "Góndolas unificadas",
};

/** Últimas eliminaciones y unificaciones, con respaldo completo guardado en la base (auditoria_eliminaciones). */
export function AuditoriaEliminaciones({ acciones, refrescar = 0 }: { acciones: string[]; refrescar?: number }) {
  const [filas, setFilas] = useState<Registro[]>([]);
  const clave = acciones.join(",");
  const cargar = useCallback(async () => {
    const { data } = await createClient().from("auditoria_eliminaciones").select("id, accion, referencia, motivo, created_at")
      .in("accion", clave.split(",")).order("created_at", { ascending: false }).limit(8);
    setFilas((data ?? []) as Registro[]);
  }, [clave]);
  useEffect(() => { void cargar(); }, [cargar, refrescar]);
  if (filas.length === 0) return null;
  return (
    <Card className="rounded-xl">
      <CardHeader><CardTitle className="text-sm">Bitácora de depuración</CardTitle></CardHeader>
      <CardContent className="grid gap-1 text-xs">
        {filas.map((f) => (
          <div key={f.id} className="flex flex-wrap justify-between gap-2 border-b pb-1 last:border-0">
            <span><b>{ACCION[f.accion] ?? f.accion}</b> {f.referencia}{f.motivo ? ` — ${f.motivo}` : ""}</span>
            <span className="text-muted-foreground">{new Date(f.created_at).toLocaleString("es-MX")}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
