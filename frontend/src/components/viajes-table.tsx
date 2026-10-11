"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { postBackend } from "@/lib/api";
import type { Ubicacion, Viaje } from "@/lib/types";
import { fechaMx } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ViajeModal } from "@/components/viaje-modal";

export const ubicacionLabel = (u: Ubicacion | null) =>
  !u ? "—" : u.nombre || [u.municipio, u.estado].filter(Boolean).join(", ") || u.id_ubicacion;

const SELECT =
  "*, origen:ubicaciones!origen_id(*), destino:ubicaciones!destino_id(*), chofer:choferes(*), tracto:tractocamiones(id,placa), gondola:gondolas(*)";

export function ViajesTable() {
  const [viajes, setViajes] = useState<Viaje[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<Viaje | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error } = await createClient().from("viajes").select(SELECT).order("fecha", { ascending: false }).limit(500);
    if (error) setError(error.message);
    else setViajes((data ?? []) as unknown as Viaje[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    let ok = 0;
    const fallos: string[] = [];
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", f);
      try {
        await postBackend("xml/procesar", fd); // el navegador fija el boundary multipart
        ok++;
      } catch (e) {
        fallos.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (ok) setNotice(`${ok} XML procesado(s) correctamente.`);
    if (fallos.length) setError(fallos.join("\n"));
    if (ok) load();
  }

  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <input ref={fileRef} type="file" accept=".xml,text/xml" multiple hidden onChange={(e) => onFiles(e.target.files)} />
        <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Subir XML (CFDI)
        </Button>
      </div>
      {notice && <Alert variant="success">{notice}</Alert>}
      {error && <Alert variant="error" className="whitespace-pre-line">{error}</Alert>}

      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Fecha</TableHead>
              <TableHead>Folio</TableHead>
              <TableHead>Chofer</TableHead>
              <TableHead>Origen</TableHead>
              <TableHead>Destino</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">Cargando viajes…</TableCell></TableRow>
            ) : viajes.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">Aún no hay viajes. Sube un XML con Carta Porte para comenzar.</TableCell></TableRow>
            ) : (
              viajes.map((v) => (
                <TableRow
                  key={v.id}
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => setSelected(v)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelected(v)}
                >
                  <TableCell>{fechaMx(v.fecha)}</TableCell>
                  <TableCell className="font-medium">{v.folio_factura ?? "—"}</TableCell>
                  <TableCell>{v.chofer?.nombre ?? "—"}</TableCell>
                  <TableCell>{ubicacionLabel(v.origen)}</TableCell>
                  <TableCell>{ubicacionLabel(v.destino)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <ViajeModal viaje={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
