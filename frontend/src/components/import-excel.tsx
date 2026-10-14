"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { ApiError, postBackend } from "@/lib/api";
import type { ImportExcelResult } from "@/lib/types";
import { Alert } from "@/components/ui/alert";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";

/** Sube el Excel de administración de fletes; el backend crea o actualiza sin duplicar. */
export function ImportExcel({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; status?: number; path?: string } | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  async function onFile(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await postBackend<ImportExcelResult>("importar/excel", fd);
      const parte = (n: string, x: ImportExcelResult["facturas"]) => `${n}: ${x.nuevas} nuevas, ${x.actualizadas} actualizadas`;
      setMsg({
        ok: true,
        text: [parte("Facturas", r.facturas), parte("Órdenes", r.ordenes_compra),
          r.uuid_danados ? `${r.uuid_danados} facturas traen el UUID dañado en el Excel (se identifican por folio).` : ""].filter(Boolean).join(" · "),
      });
      onDone();
    } catch (e) {
      const a = e as ApiError;
      setMsg({ ok: false, text: a.message, status: a.status, path: a.path });
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <div className="grid gap-2">
      <input ref={ref} type="file" accept=".xlsx,.xlsm" hidden onChange={(e) => onFile(e.target.files)} />
      <div>
        <Button onClick={() => ref.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
          Importar Excel
        </Button>
      </div>
      {msg && (msg.ok ? <Alert variant="success">{msg.text}</Alert>
        : msg.text.startsWith("REMISIONES:") ? (
          // Excel de La Purísima (u otro de remisiones) subido aquí por error: se manda a su importador
          <Alert variant="info">
            {msg.text.replace("REMISIONES: ", "")}{" "}
            <Link href="/clientes" className="font-semibold underline">Ir a Clientes</Link>
          </Alert>
        ) : <ErrorAlert where="importar-excel" message={msg.text} status={msg.status} path={msg.path} />)}
    </div>
  );
}
