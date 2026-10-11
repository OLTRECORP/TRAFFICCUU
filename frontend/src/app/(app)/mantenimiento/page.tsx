import { MantenimientoPanel } from "@/components/mantenimiento-panel";

export default function MantenimientoPage() {
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-bold">Mantenimiento</h1>
        <p className="text-sm text-muted-foreground">
          Kilómetros recorridos desde el último servicio frente al intervalo de cada regla.
        </p>
      </div>
      <MantenimientoPanel />
    </div>
  );
}
