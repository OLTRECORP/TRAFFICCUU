"use client";

import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { postBackend } from "@/lib/api";
import { Button } from "@/components/ui/button";

const ZIP_MAX_BYTES = 4 * 1024 * 1024;   // límite del cuerpo de petición en Vercel

export function UploadXml({ onResult }: { onResult: (r: { ok: number; zips: number; fallos: string[] }) => void }) {
  const [uploading, setUploading] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    let ok = 0, zips = 0;
    const fallos: string[] = [];
    for (const f of Array.from(files)) {
      const esZip = f.name.toLowerCase().endsWith(".zip");
      if (esZip && f.size > ZIP_MAX_BYTES) {
        fallos.push(`${f.name}: pesa ${(f.size / 1048576).toFixed(1)} MB; el máximo es 4 MB. Divídelo en varios .zip.`);
        continue;
      }
      const fd = new FormData();
      fd.append("file", f);
      try {
        // el navegador fija el boundary multipart; un .zip se descomprime y valida en el servidor
        await postBackend(esZip ? "xml/subir-zip" : "xml/procesar", fd);
        if (esZip) zips++; else ok++;
      } catch (e) {
        fallos.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    setUploading(false);
    if (ref.current) ref.current.value = "";
    onResult({ ok, zips, fallos });
  }

  return (
    <>
      <input ref={ref} type="file" accept=".xml,text/xml,.zip,application/zip" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      <Button onClick={() => ref.current?.click()} disabled={uploading}>
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        Subir XML o .zip
      </Button>
    </>
  );
}
