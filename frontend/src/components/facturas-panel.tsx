"use client";

import { ErrorAlert } from "@/components/error-alert";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Chofer, Factura, FacturaMes, Lugar } from "@/lib/types";
import { fechaMx, mxn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FacturaModal } from "@/components/factura-modal";
import { DescargaMasiva } from "@/components/descarga-masiva";
import { ImportExcel } from "@/components/import-excel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const TAM = 20;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const sel = "h-10 rounded-md border bg-background px-3 text-sm";

export function FacturasPanel({ ordenInicial = "" }: { ordenInicial?: string }) {
  const [rows, setRows] = useState<Factura[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [q, setQ] = useState(ordenInicial);
  const [estado, setEstado] = useState("");
  const [comp, setComp] = useState("");
  const [mes, setMes] = useState("");          // "YYYY-MM" (mes de emisión)
  const [chofer, setChofer] = useState("");
  const [lugar, setLugar] = useState("");        // origen o destino del viaje
  const [meses, setMeses] = useState<string[]>([]);
  const [choferes, setChoferes] = useState<Pick<Chofer, "id" | "nombre">[]>([]);
  const [lugares, setLugares] = useState<Pick<Lugar, "id" | "nombre">[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Factura | null>(null);

  // Opciones de los filtros: meses con facturas, choferes y lugares (catálogos de la Carta Porte)
  useEffect(() => {
    const sb = createClient();
    void sb.from("facturas_por_mes").select("mes").order("mes", { ascending: false }).limit(120)
      .then(({ data }) => setMeses(((data ?? []) as Pick<FacturaMes, "mes">[]).map((m) => m.mes.slice(0, 7))));
    void sb.from("choferes").select("id, nombre").order("nombre").limit(1000)
      .then(({ data }) => setChoferes((data ?? []) as Pick<Chofer, "id" | "nombre">[]));
    void sb.from("lugares").select("id, nombre").order("nombre").limit(1000)
      .then(({ data }) => setLugares((data ?? []) as Pick<Lugar, "id" | "nombre">[]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    // El chofer y el origen/destino salen del viaje (Carta Porte) ligado a la factura: join interno solo si se filtra.
    const porViaje = !!(chofer || lugar);
    let query = createClient().from("facturas")
      .select(`*, sat:facturas_sat(estado, actualizado_en)${porViaje ? ", viajes!inner(chofer_id, lugar_origen_id, lugar_destino_id)" : ""}`, { count: "exact" })
      .order("fecha_emision", { ascending: false, nullsFirst: false }).order("folio", { ascending: false })
      .range((pagina - 1) * TAM, pagina * TAM - 1);
    const t = q.trim().replace(/[,()%]/g, "");
    if (t) query = query.or(`folio.ilike.%${t}%,orden_compra.ilike.%${t}%,uuid_texto.ilike.%${t}%`);
    if (estado) query = query.eq("estado", estado);
    if (comp) query = query.eq("complemento", comp);
    if (mes) {
      const [a, m] = mes.split("-").map(Number);
      const sig = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
      query = query.gte("fecha_emision", `${mes}-01`).lt("fecha_emision", `${sig}-01`);
    }
    if (chofer) query = query.eq("viajes.chofer_id", chofer);
    if (lugar) query = query.or(`lugar_origen_id.eq.${lugar},lugar_destino_id.eq.${lugar}`, { referencedTable: "viajes" });
    const { data, count, error: err } = await query;
    if (err) setError(err.message);
    else { setError(null); setRows((data ?? []) as unknown as Factura[]); setTotal(count ?? 0); }
    setLoading(false);
  }, [pagina, q, estado, comp, mes, chofer, lugar]);

  useEffect(() => { void load(); }, [load]);
  const paginas = Math.max(1, Math.ceil(total / TAM));

  return (
    <div className="grid gap-4">
      <ImportExcel onDone={load} />
      <DescargaMasiva onDone={load} />
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Buscar folio, UUID u orden" value={q} onChange={(e) => { setQ(e.target.value); setPagina(1); }} />
        <select className={sel} value={estado} onChange={(e) => { setEstado(e.target.value); setPagina(1); }} aria-label="Estado">
          <option value="">Todos los estados</option><option value="activado">Activado</option>
          <option value="pagado">Pagado</option><option value="cancelado">Cancelado</option>
        </select>
        <select className={sel} value={comp} onChange={(e) => { setComp(e.target.value); setPagina(1); }} aria-label="Complemento">
          <option value="">Todo complemento</option><option value="COMPLEMENTO LISTO">Complemento listo</option>
          <option value="SIN COMPLEMENTO">Sin complemento</option>
        </select>
        <select className={sel} value={mes} onChange={(e) => { setMes(e.target.value); setPagina(1); }} aria-label="Mes de emisión">
          <option value="">Todos los meses</option>
          {meses.map((m) => <option key={m} value={m}>{nombreMes(m)}</option>)}
        </select>
        <select className={sel} value={chofer} onChange={(e) => { setChofer(e.target.value); setPagina(1); }} aria-label="Chofer">
          <option value="">Todos los choferes</option>
          {choferes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select className={sel} value={lugar} onChange={(e) => { setLugar(e.target.value); setPagina(1); }} aria-label="Origen o destino">
          <option value="">Todas las ubicaciones</option>
          {lugares.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
        </select>
      </div>
      {error && <ErrorAlert where="facturas" message={error} />}
      <Card className="rounded-xl">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Folio</TableHead><TableHead>Folio fiscal (UUID)</TableHead><TableHead>Emisión</TableHead><TableHead>Estado</TableHead>
              <TableHead>Complemento</TableHead><TableHead>Orden de compra</TableHead>
              <TableHead>XML</TableHead><TableHead>Pago</TableHead><TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground">Cargando facturas…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground">Sin facturas. Importa el Excel de administración de fletes.</TableCell></TableRow>
            ) : rows.map((f) => (
              <TableRow key={f.id} className="cursor-pointer border-0 even:bg-secondary/70" onClick={() => setSelected(f)}>
                <TableCell className="font-medium">{f.folio}</TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs" title={f.uuid ?? undefined}>{f.uuid ? f.uuid.toUpperCase() : <span className="font-sans text-muted-foreground">Sin UUID</span>}</TableCell>
                <TableCell className="whitespace-nowrap">{f.fecha_emision ? fechaMx(f.fecha_emision) : "—"}</TableCell>
                <TableCell><Badge variant={f.estado === "cancelado" ? "rojo" : f.estado === "pagado" ? "verde" : "default"}>{f.estado ?? "—"}</Badge></TableCell>
                <TableCell><Badge variant={f.complemento === "COMPLEMENTO LISTO" ? "verde" : "amarillo"}>{f.complemento === "COMPLEMENTO LISTO" ? "Listo" : "Sin complemento"}</Badge></TableCell>
                <TableCell>{f.orden_compra ? <Link onClick={(e) => e.stopPropagation()} className="font-medium text-highlight hover:underline" href={`/ordenes?q=${f.orden_compra}`}>{f.orden_compra}</Link> : <span className="text-muted-foreground">Sin orden</span>}</TableCell>
                <TableCell><Badge variant={f.sat?.estado === "ok" && f.sat.actualizado_en ? "verde" : "default"}>{f.sat?.estado === "ok" && f.sat.actualizado_en ? "Descargado" : "Pendiente"}</Badge></TableCell>
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
      <FacturaModal factura={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
