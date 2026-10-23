"use client";

import { AsignacionViaje, type ViajeAsignable } from "@/components/asignacion-viaje";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/** Ventana para cambiar el tracto, la góndola o el chofer de un viaje (p. ej. por un error de timbrado). */
export function AsignarViajeDialog({ viaje, onClose, onCambio }: { viaje: ViajeAsignable | null; onClose: () => void; onCambio: () => void }) {
  return (
    <Dialog open={!!viaje} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <div className="pr-6">
          <DialogTitle className="text-lg font-semibold">Editar viaje {viaje?.folio ?? ""}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Este viaje viene de un XML con Carta Porte: su fecha, ruta, importe y material salen del timbrado. Aquí se corrige a quién se asigna.
          </DialogDescription>
        </div>
        {viaje && <AsignacionViaje viaje={viaje} onAsignado={onCambio} />}
      </DialogContent>
    </Dialog>
  );
}
