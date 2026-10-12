import { OrdenesPanel } from "@/components/ordenes-panel";

export default function OrdenesPage({ searchParams }: { searchParams: { q?: string } }) {
  return <OrdenesPanel qInicial={searchParams.q ?? ""} />;
}
