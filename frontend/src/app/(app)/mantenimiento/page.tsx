import { MantenimientoPanel } from "@/components/mantenimiento-panel";

export default function MantenimientoPage() {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Kilómetros recorridos desde el último servicio frente al intervalo de cada regla.
      </p>
      <MantenimientoPanel />
    </div>
  );
}
