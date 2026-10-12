"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Alert } from "@/components/ui/alert";

/** Hash corto y estable (no criptográfico) para identificar el mismo error. */
function hash(text: string) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
}

/**
 * Error en rojo junto al problema, con un código copiable para pegarlo en el chat de soporte.
 * `where` = módulo o acción (ej. "importar-excel"); `status` y `path` ayudan a ubicar la causa.
 */
export function ErrorAlert({ message, where, status, path }: { message: string; where: string; status?: number; path?: string }) {
  const [copied, setCopied] = useState(false);
  const at = useMemo(() => new Date().toISOString(), [message]);
  const code = `ERR-${where.toUpperCase()}-${hash(`${where}|${status ?? ""}|${message}`)}`;
  const report = [
    `Código: ${code}`,
    `Dónde: ${where}${path ? ` (${path})` : ""}`,
    status ? `HTTP: ${status}` : null,
    `Mensaje: ${message}`,
    `Hora: ${at}`,
    `Página: ${typeof window !== "undefined" ? window.location.pathname : ""}`,
  ].filter(Boolean).join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sin permiso de portapapeles: el texto sigue visible para copiarlo a mano */
    }
  }

  return (
    <Alert variant="error" className="grid gap-2">
      <p className="font-medium">{message}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <code className="select-all rounded bg-red-100 px-1.5 py-0.5 dark:bg-red-900/60">{code}</code>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded border border-current px-2 py-0.5 hover:bg-red-100 dark:hover:bg-red-900/60">
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copiado" : "Copiar detalle"}
        </button>
        <span className="opacity-75">Pega el detalle en el chat para solucionarlo.</span>
      </div>
    </Alert>
  );
}
