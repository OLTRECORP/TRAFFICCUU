"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Viaje } from "@/lib/types";
import { destinoLabel, origenLabel } from "@/lib/format";
import { cn, fechaMx, km } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const TAMANOS = [5, 10, 20];

export function ViajesTable({ viajes, loading, onSelect }: { viajes: Viaje[]; loading: boolean; onSelect: (v: Viaje) => void }) {
  const [tam, setTam] = useState(5);
  const [pagina, setPagina] = useState(1);
  const paginas = Math.max(1, Math.ceil(viajes.length / tam));

  useEffect(() => { if (pagina > paginas) setPagina(paginas); }, [pagina, paginas]);

  const visibles = viajes.slice((pagina - 1) * tam, pagina * tam);
  const numeros = ventana(pagina, paginas);

  return (
    <Card className="flex flex-col">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Fecha</TableHead>
            <TableHead>Folio</TableHead>
            <TableHead>Chofer</TableHead>
            <TableHead>Origen</TableHead>
            <TableHead>Destino</TableHead>
            <TableHead className="text-right">Km operativos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Cargando viajes…</TableCell></TableRow>
          ) : viajes.length === 0 ? (
            <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Aún no hay viajes. Sube un XML con Carta Porte para comenzar.</TableCell></TableRow>
          ) : (
            visibles.map((v) => (
              <TableRow
                key={v.id}
                tabIndex={0}
                className="cursor-pointer border-0 even:bg-secondary/70"
                onClick={() => onSelect(v)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(v)}
              >
                <TableCell className="whitespace-nowrap first:rounded-l-lg">{fechaMx(v.fecha)}</TableCell>
                <TableCell className="whitespace-nowrap font-medium">{v.folio_factura ?? "—"}</TableCell>
                <TableCell>{v.chofer?.nombre ?? "—"}</TableCell>
                <TableCell>{origenLabel(v)}</TableCell>
                <TableCell>{destinoLabel(v)}</TableCell>
                <TableCell className="whitespace-nowrap text-right last:rounded-r-lg" title={v.km_por_mapa ? (v.km_operativos != null ? "Del mapa (ida x 2)" : "Pendiente del mapa") : v.km_operativos != null ? `Del XML (ida x 2). Por mapa: ${km(v.km_operativos)}` : "Del XML (ida x 2)"}>
                  {km(v.distancia_operativa)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs">
        <nav className="flex items-center gap-1" aria-label="Paginación">
          <PageBtn onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina === 1} label="Anterior"><ChevronLeft className="h-3.5 w-3.5" /></PageBtn>
          {numeros.map((n, i) =>
            n === "…" ? <span key={`e${i}`} className="px-1 text-muted-foreground">…</span> : (
              <PageBtn key={n} onClick={() => setPagina(n)} active={n === pagina} label={`Página ${n}`}>{n}</PageBtn>
            ))}
          <PageBtn onClick={() => setPagina((p) => Math.min(paginas, p + 1))} disabled={pagina === paginas} label="Siguiente"><ChevronRight className="h-3.5 w-3.5" /></PageBtn>
        </nav>
        <label className="flex items-center gap-2 text-muted-foreground">
          Mostrando
          <select value={tam} onChange={(e) => { setTam(Number(e.target.value)); setPagina(1); }}
            className="h-7 rounded-md border border-input bg-card px-1.5 text-foreground">
            {TAMANOS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>
    </Card>
  );
}

function PageBtn({ children, onClick, active, disabled, label }: { children: React.ReactNode; onClick: () => void; active?: boolean; disabled?: boolean; label: string }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} aria-current={active ? "page" : undefined}
      className={cn("flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 font-medium hover:bg-accent disabled:opacity-40",
        active && "bg-primary text-primary-foreground hover:bg-primary")}>
      {children}
    </button>
  );
}

/** 1 2 3 … N con la página actual en medio. */
function ventana(actual: number, total: number): (number | "…")[] {
  if (total <= 6) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, actual - 1, actual, actual + 1].filter((n) => n >= 1 && n <= total));
  const orden = [...set].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  orden.forEach((n, i) => { if (i && n - orden[i - 1] > 1) out.push("…"); out.push(n); });
  return out;
}
