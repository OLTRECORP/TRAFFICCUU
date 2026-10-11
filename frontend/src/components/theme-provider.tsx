"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_BRANDING, themeVars, type Branding, type Mode } from "@/lib/theme";

interface ThemeCtx {
  mode: Mode;
  toggleMode: () => void;
  empresa: string | null;
  logoUrl: string | null;
  /** Vista previa temporal (settings); null la descarta. */
  preview: (b: Branding | null) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<ThemeCtx | null>(null);
export const useTheme = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTheme fuera de ThemeProvider");
  return c;
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>("light");
  const [saved, setSaved] = useState<Branding>(DEFAULT_BRANDING);
  const [draft, setDraft] = useState<Branding | null>(null);
  const [empresa, setEmpresa] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  // El script inline del layout ya fijó la clase `dark` antes de hidratar.
  useEffect(() => {
    setMode(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const refresh = useCallback(async () => {
    const sb = createClient();
    const { data } = await sb
      .from("empresa_configuracion")
      .select("razon_social,logo_path,color_primario,color_base,updated_at")
      .maybeSingle();
    if (!data) return;
    setSaved({ color_primario: data.color_primario, color_base: data.color_base });
    setEmpresa(data.razon_social);
    setLogoUrl(
      data.logo_path
        ? `${sb.storage.from("logos").getPublicUrl(data.logo_path).data.publicUrl}?v=${encodeURIComponent(data.updated_at)}`
        : null,
    );
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const active = draft ?? saved;
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", mode === "dark");
    for (const [k, v] of Object.entries(themeVars(active, mode))) root.style.setProperty(k, v);
  }, [active, mode]);

  const toggleMode = useCallback(() => {
    setMode((m) => {
      const next = m === "dark" ? "light" : "dark";
      try { localStorage.setItem("theme", next); } catch { /* modo privado */ }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ mode, toggleMode, empresa, logoUrl, preview: setDraft, refresh }),
    [mode, toggleMode, empresa, logoUrl, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
