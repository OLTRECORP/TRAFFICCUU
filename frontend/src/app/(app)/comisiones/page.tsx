import { ComisionesPanel } from "@/components/comisiones-panel";

export default function ComisionesPage() {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Comisión por viaje sobre el subtotal (antes de IVA): 12 % general, o la tasa del cliente o de la ruta (ver Clientes). La fecha es la salida del origen en la Carta Porte.
      </p>
      <ComisionesPanel />
    </div>
  );
}
