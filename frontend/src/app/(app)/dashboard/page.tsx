import { ViajesTable } from "@/components/viajes-table";

export default function DashboardPage() {
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-bold">Viajes</h1>
        <p className="text-sm text-muted-foreground">Historial de fletes con Carta Porte. Haz clic en una fila para ver el detalle.</p>
      </div>
      <ViajesTable />
    </div>
  );
}
