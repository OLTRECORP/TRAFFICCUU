"use client";

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { descargarPdfComisiones, nombreArchivoPdf, type ChoferPdf } from "@/lib/comisiones-pdf";
import { Button } from "@/components/ui/button";

/** Descarga el PDF de comisiones (una hoja por chofer con su lista de viajes). Lee los datos de la empresa al pulsar. */
export function BotonPdfComisiones({ choferes, periodo, etiqueta, soloIcono, variante = "outline", onError }: {
  choferes: ChoferPdf[]; periodo: string; etiqueta?: string; soloIcono?: boolean; variante?: "outline" | "ghost" | "default"; onError?: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const conViajes = choferes.filter((c) => c.viajes.length > 0);

  async function descargar() {
    setBusy(true);
    try {
      const { data } = await createClient().from("empresa_configuracion").select("razon_social, rfc").maybeSingle();
      const archivo = nombreArchivoPdf(conViajes.length === 1 ? conViajes[0].nombre : "todos los choferes", periodo);
      await descargarPdfComisiones(conViajes, { empresa: (data as { razon_social: string; rfc: string } | null) ?? null, periodo }, archivo);
    } catch (e) { onError?.(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }

  const texto = etiqueta ?? "Descargar PDF";
  return (
    <Button type="button" size={soloIcono ? "icon" : "sm"} variant={variante} disabled={busy || conViajes.length === 0}
      aria-label={texto} title={conViajes.length === 0 ? "Sin viajes en el periodo" : texto}
      onClick={(e) => { e.stopPropagation(); void descargar(); }}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}{!soloIcono && texto}
    </Button>
  );
}
