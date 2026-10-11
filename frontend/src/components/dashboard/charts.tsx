import type { Punto, Rebanada } from "@/lib/dashboard";

const compacto = (n: number) =>
  new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export const PALETA = ["hsl(var(--primary))", "hsl(var(--highlight))", "#107090", "#8ec3d6", "#9ca3af"];

/** Gráfica de área simple en SVG (sin dependencias). */
export function AreaChart({ puntos }: { puntos: Punto[] }) {
  const W = 420, H = 240, L = 44, R = 10, T = 12, B = 28;
  const max = Math.max(...puntos.map((p) => p.valor), 0);
  if (!puntos.length || max === 0)
    return <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">Sin facturación en este periodo</div>;

  const techo = niceMax(max);
  const x = (i: number) => L + (puntos.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (puntos.length - 1));
  const y = (v: number) => T + (1 - v / techo) * (H - T - B);
  const linea = puntos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(" ");
  const area = `${linea} L${x(puntos.length - 1).toFixed(1)},${H - B} L${x(0).toFixed(1)},${H - B} Z`;
  const cada = Math.ceil(puntos.length / 7);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-64 w-full" role="img" aria-label="Facturación por periodo">
      <defs>
        <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.55" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={L} x2={W - R} y1={y(techo * f)} y2={y(techo * f)} stroke="hsl(var(--border))" strokeWidth="1" />
          <text x={L - 6} y={y(techo * f) + 4} textAnchor="end" fontSize="11" fill="hsl(var(--muted-foreground))">${compacto(techo * f)}</text>
        </g>
      ))}
      <path d={area} fill="url(#areaFill)" />
      <path d={linea} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinejoin="round" />
      {puntos.map((p, i) => p.valor > 0 && <circle key={i} cx={x(i)} cy={y(p.valor)} r="3" fill="hsl(var(--highlight))"><title>{`${p.label}: $${Math.round(p.valor).toLocaleString("es-MX")}`}</title></circle>)}
      {puntos.map((p, i) => i % cada === 0 && (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="hsl(var(--muted-foreground))">{p.label}</text>
      ))}
    </svg>
  );
}

function niceMax(v: number) {
  const mag = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / mag) * mag;
}

/** Dona con total al centro y leyenda en tabla. */
export function Donut({ datos, titulo, centro }: { datos: Rebanada[]; titulo: string; centro: string }) {
  const total = datos.reduce((s, d) => s + d.valor, 0);
  const R = 62, C = 2 * Math.PI * R;
  let acum = 0;
  if (!total) return <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">Sin datos</div>;

  return (
    <div className="grid items-center gap-4 sm:grid-cols-[170px_1fr]">
      <div className="relative mx-auto h-[170px] w-[170px]">
        <svg viewBox="0 0 170 170" className="-rotate-90" role="img" aria-label={titulo}>
          <circle cx="85" cy="85" r={R} fill="none" stroke="hsl(var(--secondary))" strokeWidth="26" />
          {datos.map((d, i) => {
            const len = (d.valor / total) * C;
            const el = (
              <circle key={d.nombre} cx="85" cy="85" r={R} fill="none" stroke={PALETA[i % PALETA.length]} strokeWidth="26"
                strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acum}><title>{`${d.nombre}: ${d.valor}`}</title></circle>
            );
            acum += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[11px] leading-tight text-muted-foreground">{centro}</span>
          <span className="text-2xl font-bold">{total}</span>
        </div>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left text-muted-foreground"><th className="pb-1.5 font-medium">{titulo}</th><th className="pb-1.5 text-right font-medium">Viajes</th><th className="pb-1.5 text-right font-medium">%</th></tr>
        </thead>
        <tbody>
          {datos.map((d, i) => (
            <tr key={d.nombre}>
              <td className="py-1.5"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: PALETA[i % PALETA.length] }} />{d.nombre}</td>
              <td className="py-1.5 text-right tabular-nums">{d.valor}</td>
              <td className="py-1.5 text-right tabular-nums">{((d.valor / total) * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
