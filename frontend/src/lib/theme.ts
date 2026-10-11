export interface Branding { color_primario: string; color_base: string }
export type Mode = "light" | "dark";

export const DEFAULT_BRANDING: Branding = { color_primario: "#1d4ed8", color_base: "#f1f5f9" };
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const hsl = (h: number, s: number, l: number) => `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;

/** Variables CSS (formato shadcn: "H S% L%") derivadas del color principal y el color base. */
export function themeVars(b: Branding, mode: Mode): Record<string, string> {
  const safe = {
    color_primario: HEX_RE.test(b.color_primario) ? b.color_primario : DEFAULT_BRANDING.color_primario,
    color_base: HEX_RE.test(b.color_base) ? b.color_base : DEFAULT_BRANDING.color_base,
  };
  const [ph, ps, pl0] = hexToHsl(safe.color_primario);
  const [bh, bs0, bl] = hexToHsl(safe.color_base);
  const bs = Math.min(bs0, mode === "dark" ? 35 : 70);

  // En oscuro el principal se aclara para conservar contraste; el texto sobre él se elige por luminosidad.
  const pl = mode === "dark" ? clamp(pl0, 52, 72) : pl0;
  const primaryFg = pl >= 60 ? "222 47% 11%" : "0 0% 100%";

  if (mode === "dark") {
    return {
      "--background": hsl(bh, bs, 8), "--foreground": hsl(bh, 20, 95),
      "--card": hsl(bh, bs, 11), "--card-foreground": hsl(bh, 20, 95),
      "--primary": hsl(ph, ps, pl), "--primary-foreground": primaryFg,
      "--secondary": hsl(bh, bs, 17), "--secondary-foreground": hsl(bh, 20, 95),
      "--muted": hsl(bh, bs, 15), "--muted-foreground": hsl(bh, 12, 68),
      "--accent": hsl(bh, bs, 18), "--accent-foreground": hsl(bh, 20, 95),
      "--border": hsl(bh, bs, 21), "--input": hsl(bh, bs, 25), "--ring": hsl(ph, ps, pl),
    };
  }
  const bg = clamp(bl, 92, 98); // el fondo claro nunca es tan oscuro que rompa la legibilidad
  return {
    "--background": hsl(bh, bs, bg), "--foreground": hsl(bh, 35, 11),
    "--card": "0 0% 100%", "--card-foreground": hsl(bh, 35, 11),
    "--primary": hsl(ph, ps, pl), "--primary-foreground": primaryFg,
    "--secondary": hsl(bh, bs, bg - 4), "--secondary-foreground": hsl(bh, 35, 11),
    "--muted": hsl(bh, bs, bg - 2), "--muted-foreground": hsl(bh, 14, 38),
    "--accent": hsl(bh, bs, bg - 4), "--accent-foreground": hsl(bh, 35, 11),
    "--border": hsl(bh, bs, bg - 8), "--input": hsl(bh, bs, bg - 12), "--ring": hsl(ph, ps, pl),
  };
}
