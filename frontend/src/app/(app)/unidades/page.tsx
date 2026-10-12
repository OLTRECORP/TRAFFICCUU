import { UnidadesPanel } from "@/components/unidades-panel";

export default function UnidadesPage() {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Tractos y góndolas: marca, modelo, año, placas, permiso SCT y seguro. El ID liga cada unidad con sus Cartas Porte y facturas.
      </p>
      <UnidadesPanel />
    </div>
  );
}
