"use client";

import { ErrorAlert } from "@/components/error-alert";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { OrdenResumen } from "@/lib/types";
import { fechaMx, mxn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { OrdenModal } from "@/components/orden-modal";
import { ImportExcel } from "@/components/import-excel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const TAM = 20;

export function OrdenesPanel({ qInicial = "" }: { qInicial?: string }) {
  const [rows, setRows] = useState<OrdenResumen[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [q, setQ] = useState(qInicial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<OrdenResumen | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let query = createClient().from("ordenes_compra_resumen").select("*", { count: "exact" })
      .order("fecha_creacion", { ascending: false, nullsFirst: false }).order("numero", { ascending: false })
      .range((pagina - 1) * TAM, pagina * TAM - 1);
    const t = q.trim().replace(/[,()%]/g, "");
    if (t) query = query.ilike("numero", `%${t}%`);
    const { data, count, error: err } = await query;
    if (err) setError(err.message);
    else { setError(null); setRows((data ?? []) as OrdenResumen[]); setTotal(count ?? 0); }
    setLoading(false);
  }, [pagina, q]);

  useEffect(() => { void load(); }, [load]);
  const paginas = Math.max(1, Math.ceil(total / TAM));

  return (
    <div className="grid gap-4">
      <ImportExcel onDone={load} />
      <Input className="max-w-xs" placeholder="Buscar N° de orden" value={q} onChange={(e) => { setQ(e.target.value); setPagina(1); }} />
      {error && <ErrorAlert where="ordenes" message={error} />}
      <Card className="rounded-xl">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Orden</TableHead><TableHead>Creación</TableHead><TableHead>Pago</TableHead>
              <TableHead className="text-right">Monto</TableHead><TableHead className="text-right">Facturas</TableHead>
              <TableHead className="text-right">Suma facturas</TableHead><TableHead className="text-right">Diferencia</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Cargando órdenes…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Sin órdenes. Importa el Excel de administración de fletes.</TableCell></TableRow>
            ) : rows.map((o) => (
              <TableRow key={o.id} className="cursor-pointer border-0 even:bg-secondary/70" onClick={() => setSelected(o)}>
                <TableCell className="font-medium">{o.numero}</TableCell>
                <TableCell className="whitespace-nowrap">{o.fecha_creacion ? fechaMx(o.fecha_creacion) : "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{o.fecha_pago ? fechaMx(o.fecha_pago) : "—"}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{mxn(o.monto)}</TableCell>
                <TableCell className="text-right"><Link onClick={(e) => e.stopPropagation()} className="font-medium text-highlight hover:underline" href={`/facturas?q=${o.numero}`}>{o.n_facturas}</Link></TableCell>
                <TableCell className="whitespace-nowrap text-right">{mxn(o.suma_facturas)}</TableCell>
                <TableCell className="text-right">
                  <Badge variant={Math.abs(o.diferencia) <= 1 ? "verde" : "amarillo"}>{mxn(o.diferencia)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t px-4 py-3 text-xs">
          <span>{total} órdenes</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)} aria-label="Anterior"><ChevronLeft className="h-4 w-4" /></Button>
            <span>{pagina} / {paginas}</span>
            <Button variant="outline" size="sm" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)} aria-label="Siguiente"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </Card>
      <OrdenModal orden={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
