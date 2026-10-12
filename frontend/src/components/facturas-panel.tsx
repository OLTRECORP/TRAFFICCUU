"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Factura } from "@/lib/types";
import { fechaMx, mxn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ImportExcel } from "@/components/import-excel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const TAM = 20;
const sel = "h-10 rounded-md border bg-background px-3 text-sm";

export function FacturasPanel({ ordenInicial = "" }: { ordenInicial?: string }) {
  const [rows, setRows] = useState<Factura[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [q, setQ] = useState(ordenInicial);
  const [estado, setEstado] = useState("");
  const [comp, setComp] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let query = createClient().from("facturas").select("*", { count: "exact" })
      .order("fecha_emision", { ascending: false, nullsFirst: false }).order("folio", { ascending: false })
      .range((pagina - 1) * TAM, pagina * TAM - 1);
    const t = q.trim().replace(/[,()%]/g, "");
    if (t) query = query.or(`folio.ilike.%${t}%,orden_compra.ilike.%${t}%`);
    if (estado) query = query.eq("estado", estado);
    if (comp) query = query.eq("complemento", comp);
    const { data, count, error: err } = await query;
    if (err) setError(err.message);
    else { setError(null); setRows((data ?? []) as Factura[]); setTotal(count ?? 0); }
    setLoading(false);
  }, [pagina, q, estado, comp]);

  useEffect(() => { void load(); }, [load]);
  const paginas = Math.max(1, Math.ceil(total / TAM));
  const filtro = (fn: () => void) => () => { fn(); setPagina(1); };

  return (
    <div className="grid gap-4">
      <ImportExcel onDone={load} />
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Buscar folio u orden" value={q} onChange={(e) => { setQ(e.target.value); setPagina(1); }} />
        <select className={sel} value={estado} onChange={(e) => { setEstado(e.target.value); setPagina(1); }} aria-label="Estado">
          <option value="">Todos los estados</option><option value="activado">Activado</option>
          <option value="pagado">Pagado</option><option value="cancelado">Cancelado</option>
        </select>
        <select className={sel} value={comp} onChange={(e) => { setComp(e.target.value); setPagina(1); }} aria-label="Complemento">
          <option value="">Todo complemento</option><option value="COMPLEMENTO LISTO">Complemento listo</option>
          <option value="SIN COMPLEMENTO">Sin complemento</option>
        </select>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Card className="rounded-xl">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Folio</TableHead><TableHead>Emisión</TableHead><TableHead>Estado</TableHead>
              <TableHead>Complemento</TableHead><TableHead>Orden de compra</TableHead>
              <TableHead>Pago</TableHead><TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Cargando facturas…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Sin facturas. Importa el Excel de administración de fletes.</TableCell></TableRow>
            ) : rows.map((f) => (
              <TableRow key={f.id} className="border-0 even:bg-secondary/70">
                <TableCell className="font-medium">{f.folio}</TableCell>
                <TableCell className="whitespace-nowrap">{f.fecha_emision ? fechaMx(f.fecha_emision) : "—"}</TableCell>
                <TableCell><Badge variant={f.estado === "cancelado" ? "rojo" : f.estado === "pagado" ? "verde" : "default"}>{f.estado ?? "—"}</Badge></TableCell>
                <TableCell><Badge variant={f.complemento === "COMPLEMENTO LISTO" ? "verde" : "amarillo"}>{f.complemento === "COMPLEMENTO LISTO" ? "Listo" : "Sin complemento"}</Badge></TableCell>
                <TableCell>{f.orden_compra ? <Link className="font-medium text-highlight hover:underline" href={`/ordenes?q=${f.orden_compra}`}>{f.orden_compra}</Link> : <span className="text-muted-foreground">Sin orden</span>}</TableCell>
                <TableCell className="whitespace-nowrap">{f.fecha_pago ? fechaMx(f.fecha_pago) : "—"}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{mxn(f.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t px-4 py-3 text-xs">
          <span>{total} facturas</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)} aria-label="Anterior"><ChevronLeft className="h-4 w-4" /></Button>
            <span>{pagina} / {paginas}</span>
            <Button variant="outline" size="sm" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)} aria-label="Siguiente"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
