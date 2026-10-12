"use client";

import { useEffect, useState } from "react";
import { Truck } from "lucide-react";
import { useBackendHealth } from "@/hooks/useBackendHealth";

const EXPECTED_MS = 60_000; // arranque en frío típico de Render

// Barra de progreso estimada: sube rápido y se aproxima a 95% sin llegar hasta que el backend responde.
function useEstimatedProgress(done: boolean) {
  const [pct, setPct] = useState(5);
  useEffect(() => {
    if (done) return setPct(100);
    const start = Date.now();
    const id = setInterval(() => {
      const t = (Date.now() - start) / EXPECTED_MS;
      setPct(Math.min(95, 5 + 90 * (1 - Math.exp(-2.5 * t))));
    }, 300);
    return () => clearInterval(id);
  }, [done]);
  return pct;
}

/**
 * Se monta dentro del portal (ya autenticado por el middleware): muestra "iniciando"
 * con barra de progreso hasta que el backend responde y entonces abre la sesión.
 */
export function BackendGate({ children }: { children: React.ReactNode }) {
  const { status, attempts } = useBackendHealth(true, 4000);
  const online = status === "online";
  const pct = useEstimatedProgress(online);

  if (online) return <>{children}</>;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center" role="status" aria-live="polite">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Truck className="h-6 w-6" />
        </span>
        <h1 className="text-xl font-semibold">Iniciando el motor logístico…</h1>
        <p className="text-sm text-muted-foreground">
          El servidor estaba en reposo y puede tardar hasta un minuto en despertar. Abriremos tu sesión en cuanto esté en línea.
        </p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">{Math.round(pct)}%{attempts > 0 ? ` · reintentando (${attempts + 1})` : ""}</p>
      </div>
    </main>
  );
}
