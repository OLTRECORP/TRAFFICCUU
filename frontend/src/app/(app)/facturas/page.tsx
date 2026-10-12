import { FacturasPanel } from "@/components/facturas-panel";

export default function FacturasPage({ searchParams }: { searchParams: { q?: string } }) {
  return <FacturasPanel ordenInicial={searchParams.q ?? ""} />;
}
