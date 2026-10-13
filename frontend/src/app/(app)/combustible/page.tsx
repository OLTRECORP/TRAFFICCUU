import { CombustiblePanel } from "@/components/combustible-panel";

export default function CombustiblePage() {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Cargas de diésel por tracto y rendimiento de cada chofer: km/l y viajes por litro, con filtro de fechas.
      </p>
      <CombustiblePanel />
    </div>
  );
}
