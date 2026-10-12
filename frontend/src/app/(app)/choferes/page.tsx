import { ChoferesPanel } from "@/components/choferes-panel";

export default function ChoferesPage() {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Datos y licencia de cada chofer. El ID liga al chofer con sus viajes, Cartas Porte y facturas.
      </p>
      <ChoferesPanel />
    </div>
  );
}
