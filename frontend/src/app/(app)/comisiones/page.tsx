import { ComisionesPanel } from "@/components/comisiones-panel";

export default function ComisionesPage() {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Comisión del 12 % sobre el subtotal de la factura (antes de IVA) por viaje. La fecha es la salida del origen en la Carta Porte.
      </p>
      <ComisionesPanel />
    </div>
  );
}
