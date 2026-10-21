"use client";

import { useMemo, useState } from "react";
import { Copy, Pencil, Printer, Trash2 } from "lucide-react";
import { ESTADOS, ETIQUETA_ESTADO, folioTexto, type EstadoCotizacion, type UnidadCobro } from "@/lib/cotizador";
import { cn, fechaMx, km, mxn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface Guardada {
  id: string; folio: number | null; cliente: string | null; origen: string; destino: string; mercancia: string | null;
  unidad: UnidadCobro; cantidad: number; precio: number; precio_unidad: number; precio_minimo: number; km_ida: number; minutos_ida: number | null;
  vigencia_dias: number; condiciones: string | null; estado: EstadoCotizacion; created_at: string; updated_at: string | null;
  entrada: Record<string, unknown>;
}

type Agrupar = "ninguno" | "origen" | "destino";
const sel = "h-9 rounded-md border bg-background px-2 text-sm";
const unico = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b, "es"));
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Cotizaciones guardadas con filtros por origen, destino, estado y texto; se pueden agrupar por origen o destino. */
export function CotizacionesGuardadas({ items, editandoId, onEditar, onDuplicar, onImprimir, onBorrar, onEstado }: {
  items: Guardada[]; editandoId: string | null;
  onEditar: (c: Guardada) => void; onDuplicar: (c: Guardada) => void; onImprimir: (c: Guardada) => void;
  onBorrar: (c: Guardada) => void; onEstado: (c: Guardada, e: EstadoCotizacion) => void;
}) {
  const [origen, setOrigen] = useState("");
  const [destino, setDestino] = useState("");
  const [estado, setEstado] = useState("");
  const [texto, setTexto] = useState("");
  const [agrupar, setAgrupar] = useState<Agrupar>("ninguno");

  const origenes = useMemo(() => unico(items.map((c) => c.origen)), [items]);
  const destinos = useMemo(() => unico(items.map((c) => c.destino)), [items]);
  const visibles = useMemo(() => {
    const q = norm(texto.trim());
    return items.filter((c) => (!origen || c.origen === origen) && (!destino || c.destino === destino) && (!estado || c.estado === estado)
      && (!q || norm(`${c.cliente ?? ""} ${c.mercancia ?? ""} ${folioTexto(c.folio)} ${c.folio ?? ""}`).includes(q)));
  }, [items, origen, destino, estado, texto]);

  const grupos = useMemo(() => {
    if (agrupar === "ninguno") return [{ clave: "", filas: visibles }];
    const m = new Map<string, Guardada[]>();
    for (const c of visibles) m.set(c[agrupar], [...(m.get(c[agrupar]) ?? []), c]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "es")).map(([clave, filas]) => ({ clave, filas }));
  }, [visibles, agrupar]);

  if (!items.length) return null;
  return (
    <Card className="rounded-xl">
      <CardHeader className="gap-3">
        <CardTitle className="text-base">Cotizaciones guardadas ({visibles.length}{visibles.length !== items.length ? ` de ${items.length}` : ""})</CardTitle>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs font-medium">Origen
            <select className={sel} value={origen} onChange={(e) => setOrigen(e.target.value)}><option value="">Todos</option>{origenes.map((o) => <option key={o}>{o}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-medium">Destino
            <select className={sel} value={destino} onChange={(e) => setDestino(e.target.value)}><option value="">Todos</option>{destinos.map((o) => <option key={o}>{o}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-medium">Estado
            <select className={sel} value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todos</option>{ESTADOS.map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-medium">Cliente, mercancía o folio
            <input className={cn(sel, "w-52")} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar…" /></label>
          <label className="grid gap-1 text-xs font-medium">Agrupar por
            <select className={sel} value={agrupar} onChange={(e) => setAgrupar(e.target.value as Agrupar)}>
              <option value="ninguno">Sin agrupar</option><option value="origen">Origen</option><option value="destino">Destino</option></select></label>
          {(origen || destino || estado || texto) && <Button variant="ghost" size="sm" onClick={() => { setOrigen(""); setDestino(""); setEstado(""); setTexto(""); }}>Limpiar filtros</Button>}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {visibles.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Ninguna cotización coincide con los filtros.</p>}
        {grupos.map((g) => (
          <div key={g.clave || "todas"} className="overflow-x-auto">
            {agrupar !== "ninguno" && (
              <h3 className="mb-1 flex flex-wrap items-baseline gap-x-3 text-sm font-semibold">
                <span>{agrupar === "origen" ? "Origen" : "Destino"}: {g.clave}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {g.filas.length} cotización(es) · {mxn(Math.min(...g.filas.map((c) => Number(c.precio_unidad))))}
                  {g.filas.length > 1 && ` a ${mxn(Math.max(...g.filas.map((c) => Number(c.precio_unidad))))}`} por unidad
                </span>
              </h3>
            )}
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 font-medium">Folio</th><th className="py-1 font-medium">Fecha</th><th className="py-1 font-medium">Cliente</th>
                {agrupar !== "origen" && <th className="py-1 font-medium">Origen</th>}{agrupar !== "destino" && <th className="py-1 font-medium">Destino</th>}
                <th className="py-1 text-right font-medium">Cantidad</th><th className="py-1 text-right font-medium">Por unidad</th><th className="py-1 text-right font-medium">Flete</th>
                <th className="py-1 pl-3 font-medium">Estado</th><th />
              </tr></thead>
              <tbody>
                {g.filas.map((c) => (
                  <tr key={c.id} className={cn("border-t", c.id === editandoId && "bg-primary/10")}>
                    <td className="whitespace-nowrap py-1.5 font-medium">{folioTexto(c.folio)}</td>
                    <td className="whitespace-nowrap py-1.5">{fechaMx(c.created_at)}</td>
                    <td className="py-1.5">{c.cliente ?? "—"}{c.mercancia && <span className="block text-xs text-muted-foreground">{c.mercancia}</span>}</td>
                    {agrupar !== "origen" && <td className="py-1.5">{c.origen}</td>}
                    {agrupar !== "destino" && <td className="py-1.5">{c.destino}<span className="block text-xs text-muted-foreground">{km(Number(c.km_ida))} de ida</span></td>}
                    <td className="whitespace-nowrap py-1.5 text-right">{Number(c.cantidad)} {c.unidad === "tonelada" ? "t" : "m³"}</td>
                    <td className="whitespace-nowrap py-1.5 text-right">{mxn(Number(c.precio_unidad))}</td>
                    <td className="whitespace-nowrap py-1.5 text-right font-medium">{mxn(Number(c.precio))}</td>
                    <td className="py-1.5 pl-3">
                      <select aria-label={`Estado de la cotización ${folioTexto(c.folio)}`} className="h-8 rounded-md border bg-background px-1 text-xs" value={c.estado} onChange={(e) => onEstado(c, e.target.value as EstadoCotizacion)}>
                        {ESTADOS.map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
                      </select>
                    </td>
                    <td className="whitespace-nowrap py-1.5 text-right">
                      <Button variant="ghost" size="icon" aria-label="Editar cotización" title="Editar" onClick={() => onEditar(c)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label="Imprimir cotización" title="Imprimir / PDF" onClick={() => onImprimir(c)}><Printer className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label="Duplicar cotización" title="Duplicar como nueva" onClick={() => onDuplicar(c)}><Copy className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label="Eliminar cotización" title="Eliminar" onClick={() => onBorrar(c)}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
