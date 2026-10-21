import { CotizadorPanel } from "@/components/cotizador-panel";

export default function CotizadorPage() {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Cotiza un flete por tonelada o por m³: ruta y tiempo en camión de carga, y un precio sugerido que cubre diésel, comisión del chofer,
        desgaste del tracto y demás costos, más la ganancia que quieras.
      </p>
      <CotizadorPanel />
    </div>
  );
}
