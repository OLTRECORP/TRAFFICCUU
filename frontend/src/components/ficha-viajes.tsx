"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ubicacionLabel } from "@/lib/format";
import type { Factura, ViajeLigado } from "@/lib/types";
import { fechaMx, mxn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export type Relacion = "chofer_id" | "tracto_id" | "gondola_id";

// Viajes (Carta Porte) de una ficha y la factura de cada uno (viajes.folio_factura = facturas.folio).
export function FichaViajes({ relacion, id }: { relacion: Relacion; id: string }) {
  const [viajes, setViajes] = useState<ViajeLigado[]>([]);
  const [facturas, setFacturas] = useState<Record<string, Factura>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const sb = createClient();
      const v = await sb.from("viajes")
        .select("id, uuid, folio_factura, fecha, total, origen:ubicaciones!viajes_origen_id_fkey(*), destino:ubicaciones!viajes_destino_id_fkey(*)")
        .eq(relacion, id).order("fecha", { ascending: false }).limit(50);
      if (!vivo) return;
      if (v.error) { setError(v.error.message); setLoading(false); return; }
      const lista = (v.data ?? []) as unknown as ViajeLigado[];
      const folios = Array.from(new Set(lista.map((x) => x.folio_factura).filter((x): x is string => !!x)));
      const mapa: Record<string, Factura> = {};
      if (folios.length) {
        const f = await sb.from("facturas").select("*").in("folio", folios);
        (f.data ?? []).forEach((x) => { mapa[(x as Factura).folio] = x as Factura; });
      }
      if (!vivo) return;
      setViajes(lista); setFacturas(mapa); setLoading(false);
    })();
    return () => { vivo = false; };
  }, [relacion, id]);

  if (loading) return <p className="text-sm text-muted-foreground">Cargando viajes…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!viajes.length) return <p className="text-sm text-muted-foreground">Sin viajes (Carta Porte) ligados todavía.</p>;

  return (
    <ul className="grid gap-2">
      {viajes.map((v) => {
        const f = v.folio_factura ? facturas[v.folio_factura] : undefined;
        return (
          <li key={v.id} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{fechaMx(v.fecha)} · {ubicacionLabel(v.origen)} → {ubicacionLabel(v.destino)}</span>
              <span>{mxn(v.total)}</span>
            </div>
            <p className="mt-1 break-all text-xs text-muted-foreground">Carta Porte UUID: {v.uuid}</p>
            <p className="mt-1 text-xs">
              Factura:{" "}
              {v.folio_factura ? (
                <Link className="font-medium text-highlight hover:underline" href={`/facturas?q=${encodeURIComponent(v.folio_factura)}`}>{v.folio_factura}</Link>
              ) : <span className="text-muted-foreground">sin folio</span>}
              {f && <Badge className="ml-2" variant={f.estado === "cancelado" ? "rojo" : f.estado === "pagado" ? "verde" : "default"}>{f.estado ?? "—"}</Badge>}
              {v.folio_factura && !f && <span className="ml-2 text-muted-foreground">(aún no importada del Excel)</span>}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
