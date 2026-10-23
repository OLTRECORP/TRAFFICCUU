"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AsignarViajeDialog } from "@/components/asignar-viaje-dialog";
import { CorregirViaje, SELECT_FILA, type Fila } from "@/components/clientes/viajes-periodo";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * Edición de un viaje por su id, desde Facturas o Clientes: los viajes del Excel de remisiones se corrigen por completo
 * (fecha, remisión, material, cantidad, precio, ruta, chofer y tracto) y los de un XML cambian de tracto, góndola o chofer.
 */
export function EditarViaje({ viajeId, onClose, onCambio }: { viajeId: string | null; onClose: () => void; onCambio: () => void }) {
  const [fila, setFila] = useState<Fila | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFila(null); setError(null);
    if (!viajeId) return;
    let vigente = true;
    void createClient().from("viajes").select(SELECT_FILA).eq("id", viajeId).maybeSingle().then(({ data, error: e }) => {
      if (!vigente) return;
      if (e || !data) setError(e?.message ?? "No se encontró el viaje"); else setFila(data as unknown as Fila);
    });
    return () => { vigente = false; };
  }, [viajeId]);

  if (error) return (
    <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="max-w-md">
      <DialogTitle className="text-lg font-semibold">Editar viaje</DialogTitle><Alert variant="error">{error}</Alert>
    </DialogContent></Dialog>
  );
  if (!fila) return null;
  if (fila.origen_registro === "excel")
    return <CorregirViaje viaje={fila} onClose={onClose} onGuardado={() => { onClose(); onCambio(); }} />;
  return (
    <AsignarViajeDialog onClose={onClose} onCambio={onCambio}
      viaje={{ id: fila.id, folio: fila.folio_factura, subtotal: Number(fila.subtotal), distancia_operativa: Number(fila.distancia_operativa),
        tracto_id: fila.tracto_id, gondola_id: fila.gondola_id, chofer_id: fila.chofer_id }} />
  );
}
