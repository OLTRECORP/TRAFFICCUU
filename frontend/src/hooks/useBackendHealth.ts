"use client";

import { useEffect, useState } from "react";

export type HealthStatus = "idle" | "checking" | "online";

/**
 * Hace polling a /api/health (proxy server-side hacia RENDER_API_URL/health)
 * cada `intervalMs` hasta recibir 200 OK. Útil para despertar el cold-start de Render.
 */
export function useBackendHealth(enabled: boolean, intervalMs = 5000) {
  const [status, setStatus] = useState<HealthStatus>("idle");
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      setStatus("checking");
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (res.ok) {
          if (!cancelled) setStatus("online");
          return; // detiene el polling
        }
      } catch {
        /* red caída o servidor dormido: reintentar */
      }
      if (cancelled) return;
      setAttempts((n) => n + 1);
      timer = setTimeout(tick, intervalMs);
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, intervalMs]);

  return { status, attempts };
}
