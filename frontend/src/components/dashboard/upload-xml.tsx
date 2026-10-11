"use client";

import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { postBackend } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function UploadXml({ onResult }: { onResult: (r: { ok: number; fallos: string[] }) => void }) {
  const [uploading, setUploading] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
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
    if (ref.current) ref.current.value = "";
    onResult({ ok, fallos });
  }

  return (
    <>
      <input ref={ref} type="file" accept=".xml,text/xml" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      <Button onClick={() => ref.current?.click()} disabled={uploading}>
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        Subir XML (CFDI)
      </Button>
    </>
  );
}
