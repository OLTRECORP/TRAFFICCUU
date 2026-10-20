"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { etiquetaPosicion, nivelLlanta, posiciones, resumenLlantas, type LlantaEstado, type Posicion, type ResumenLlantas, type TipoUnidad } from "@/lib/llantas";
import type { Nivel } from "@/lib/mantenimiento";
import { cn, fechaMx, km, mxn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ErrorAlert } from "@/components/error-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RELLENO: Record<Nivel, string> = { rojo: "fill-red-500", amarillo: "fill-amber-400", verde: "fill-emerald-500" };

export interface UnidadLlantas { tipo: TipoUnidad; id: string; placa: string; ejes: number; empresaId: string; odometro?: number }

/** Vista superior de la unidad (frente arriba): cada llanta pintada por su vida usada; gris punteado = sin registro. */
export function DiagramaLlantas({ unidad, llantas, onElegir }: { unidad: UnidadLlantas; llantas: LlantaEstado[]; onElegir: (p: Posicion) => void }) {
  const pos = posiciones(unidad.tipo, unidad.ejes);
  const W = 236, LL = 26, AL = 46, gap = 4;
  const yEje = (e: number) => (unidad.tipo === "tracto" ? (e === 1 ? 46 : 120 + (e - 2) * 64) : 40 + (e - 1) * 64);
  const H = yEje(unidad.ejes) + AL / 2 + 22;
  const xDe = (p: Posicion) => {
    if (!p.doble) return p.lado === "I" ? 28 : W - 28 - LL;
    if (p.lado === "I") return p.exterior ? 10 : 10 + LL + gap;
    return p.exterior ? W - 10 - LL : W - 10 - 2 * LL - gap;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto h-auto w-full max-w-[260px]" role="img" aria-label={`Llantas de ${unidad.placa}`}>
      {/* chasis */}
      <rect x={W / 2 - 34} y={8} width={68} height={H - 16} rx={unidad.tipo === "tracto" ? 18 : 6} className="fill-secondary stroke-border" strokeWidth={1.5} />
      {unidad.tipo === "tracto" && <rect x={W / 2 - 30} y={14} width={60} height={60} rx={12} className="fill-primary/20" />}
      <text x={W / 2} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">{unidad.tipo === "tracto" ? "frente ↑" : "frente (enganche) ↑"}</text>
      {Array.from({ length: unidad.ejes }, (_, i) => i + 1).map((e) => (
        <line key={e} x1={22} x2={W - 22} y1={yEje(e)} y2={yEje(e)} className="stroke-muted-foreground/50" strokeWidth={3} />
      ))}
      {pos.map((p) => {
        const l = llantas.find((x) => x.posicion === p.codigo);
        const n = l ? nivelLlanta(l) : null;
        const vida = l ? Math.max(0, 100 - Number(l.porcentaje)) : null;
        const x = xDe(p), y = yEje(p.eje) - AL / 2;
        return (
          <g key={p.codigo} role="button" tabIndex={0} className="cursor-pointer focus:outline-none [&:focus>rect]:stroke-ring [&:hover>rect]:opacity-80"
            onClick={() => onElegir(p)} onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && onElegir(p)}
            aria-label={`${etiquetaPosicion(p.codigo)}: ${l ? `${Math.round(vida!)}% de vida` : "sin registro"}`}>
            <title>{`${etiquetaPosicion(p.codigo)}${l ? ` · ${km(Number(l.km_recorridos))} de ${km(Number(l.vida_km))}` : " · sin registro"}`}</title>
            <rect x={x} y={y} width={LL} height={AL} rx={6} strokeWidth={2}
              className={n ? cn(RELLENO[n], "stroke-background") : "fill-transparent stroke-muted-foreground"} strokeDasharray={n ? undefined : "4 3"} />
            <text x={x + LL / 2} y={y + AL / 2 + 4} textAnchor="middle" className={cn("pointer-events-none text-[10px] font-semibold", n ? "fill-white" : "fill-muted-foreground")}>
              {vida == null ? "?" : `${Math.round(vida)}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function TextoResumen({ r }: { r: ResumenLlantas }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red-500" />{r.vencidas} cambiar ya</span>
      <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" />{r.proximas} próximas</span>
      <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />{r.bien} bien</span>
      {r.sinRegistro > 0 && <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full border border-dashed border-muted-foreground" />{r.sinRegistro} sin registro</span>}
    </span>
  );
}

/** Diagrama + resumen de una unidad, con selector de ejes y la ventana de cada llanta. */
export function LlantasUnidad({ unidad, llantas, vidaDefault, onChange }: { unidad: UnidadLlantas; llantas: LlantaEstado[]; vidaDefault: number; onChange: () => void }) {
  const [pos, setPos] = useState<Posicion | null>(null);
  const [ejes, setEjes] = useState(unidad.ejes);
  useEffect(() => setEjes(unidad.ejes), [unidad.ejes, unidad.id]);
  const r = useMemo(() => resumenLlantas(posiciones(unidad.tipo, ejes), llantas), [unidad.tipo, ejes, llantas]);

  async function cambiarEjes(n: number) {
    setEjes(n);
    await createClient().from(unidad.tipo === "tracto" ? "tractocamiones" : "gondolas").update({ ejes: n }).eq("id", unidad.id);
    onChange();
  }

  return (
    <div className="grid content-start gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{unidad.tipo === "tracto" ? "Tracto" : "Góndola"} {unidad.placa}</span>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">Ejes
          <select className="h-7 rounded-md border bg-background px-1 text-xs text-foreground" value={ejes} onChange={(e) => void cambiarEjes(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <DiagramaLlantas unidad={{ ...unidad, ejes }} llantas={llantas} onElegir={setPos} />
      <TextoResumen r={r} />
      <p className="text-xs text-muted-foreground">El número en cada llanta es su % de vida restante. Haz clic en una para ver su historial o instalar una nueva.</p>
      <LlantaDialogo unidad={unidad} pos={pos} vigente={pos ? llantas.find((l) => l.posicion === pos.codigo) ?? null : null}
        vidaDefault={vidaDefault} onClose={() => setPos(null)} onSaved={() => { setPos(null); onChange(); }} />
    </div>
  );
}

interface Historial { id: string; fecha_instalacion: string; fecha_retiro: string | null; motivo_retiro: string | null; marca: string | null; medida: string | null; km_instalacion: number | null; costo: number }

function LlantaDialogo({ unidad, pos, vigente, vidaDefault, onClose, onSaved }: {
  unidad: UnidadLlantas; pos: Posicion | null; vigente: LlantaEstado | null; vidaDefault: number; onClose: () => void; onSaved: () => void;
}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const col = unidad.tipo === "tracto" ? "tracto_id" : "gondola_id";
  const [f, setF] = useState({ fecha: hoy, km: "", vida: "", marca: "", medida: "", serie: "", costo: "", bitacora: true });
  const [hist, setHist] = useState<Historial[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pos) return;
    setError(null);
    setF({ fecha: hoy, km: unidad.odometro != null ? String(Math.round(unidad.odometro)) : "", vida: String(vigente?.vida_km ?? vidaDefault),
      marca: vigente?.marca ?? "", medida: vigente?.medida ?? "", serie: "", costo: "", bitacora: true });
    void createClient().from("llantas").select("id, fecha_instalacion, fecha_retiro, motivo_retiro, marca, medida, km_instalacion, costo")
      .eq(col, unidad.id).eq("posicion", pos.codigo).order("fecha_instalacion", { ascending: false }).limit(20)
      .then(({ data }) => setHist((data ?? []) as Historial[]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos?.codigo, unidad.id]);

  async function instalar(e: React.FormEvent) {
    e.preventDefault();
    if (!pos) return;
    const vida = Math.round(Number(f.vida)), costo = Number(f.costo || 0), kmN = unidad.tipo === "tracto" ? Number(f.km) : null;
    if (!(vida > 0)) return setError("Vida esperada inválida");
    if (!(costo >= 0)) return setError("Costo inválido");
    if (unidad.tipo === "tracto" && (f.km === "" || !(kmN! >= 0))) return setError("Captura el odómetro del tracto al instalarla");
    setBusy(true); setError(null);
    const sb = createClient();
    const { error: e1 } = await sb.from("llantas").insert({
      empresa_id: unidad.empresaId, [col]: unidad.id, posicion: pos.codigo, fecha_instalacion: f.fecha, km_instalacion: kmN,
      vida_km: vida, marca: f.marca.trim() || null, medida: f.medida.trim() || null, numero_serie: f.serie.trim() || null, costo,
    });
    if (!e1 && f.bitacora && costo > 0) {
      // el costo entra al costo de operación; en el tracto, su km también corrige el odómetro estimado
      await sb.from("servicios_mantenimiento").insert({
        empresa_id: unidad.empresaId, [col]: unidad.id, fecha: f.fecha, kilometraje: kmN, categoria: "llantas", costo,
        servicio: `Llanta ${etiquetaPosicion(pos.codigo).toLowerCase()}${f.marca.trim() ? ` (${f.marca.trim()})` : ""}`,
      });
    }
    setBusy(false);
    if (e1) setError(e1.message); else onSaved();
  }

  async function retirar() {
    if (!vigente) return;
    setBusy(true); setError(null);
    const { error: e } = await createClient().from("llantas").update({ fecha_retiro: hoy, motivo_retiro: "Retirada sin reemplazo" }).eq("id", vigente.id);
    setBusy(false);
    if (e) setError(e.message); else onSaved();
  }

  const n = vigente ? nivelLlanta(vigente) : null;
  return (
    <Dialog open={!!pos} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        {pos && (
          <>
            <div className="pr-6">
              <DialogTitle className="text-lg font-semibold">{etiquetaPosicion(pos.codigo)}</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">{unidad.tipo === "tracto" ? "Tracto" : "Góndola"} {unidad.placa}</DialogDescription>
            </div>
            {error && <ErrorAlert where="llantas" message={error} />}
            {vigente ? (
              <Alert variant={n === "rojo" ? "error" : n === "amarillo" ? "info" : "success"}>
                Vigente desde {fechaMx(vigente.fecha_instalacion)}{vigente.marca ? ` · ${vigente.marca}` : ""}{vigente.medida ? ` ${vigente.medida}` : ""}:{" "}
                <b>{km(Number(vigente.km_recorridos))}</b> de {km(Number(vigente.vida_km))} ({Math.round(Number(vigente.porcentaje))} % usado, {vigente.dias} días).
                {n === "rojo" ? " Recomendado cambiarla ya." : n === "amarillo" ? " Próxima a cambio." : ""}
              </Alert>
            ) : <Alert variant="info">Sin llanta registrada en esta posición. Registra la que tiene montada para empezar a medir su vida.</Alert>}

            <form onSubmit={instalar} className="grid gap-3 rounded-lg border p-3">
              <p className="text-sm font-medium">{vigente ? "Instalar llanta nueva (reemplaza la actual)" : "Registrar llanta montada"}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1"><Label htmlFor="ll-fecha">Fecha</Label><Input id="ll-fecha" type="date" required value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></div>
                {unidad.tipo === "tracto" && <div className="grid gap-1"><Label htmlFor="ll-km">Odómetro</Label><Input id="ll-km" type="number" min={0} value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} /></div>}
                <div className="grid gap-1"><Label htmlFor="ll-vida">Vida esperada (km)</Label><Input id="ll-vida" type="number" min={1} value={f.vida} onChange={(e) => setF({ ...f, vida: e.target.value })} /></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1"><Label htmlFor="ll-marca">Marca</Label><Input id="ll-marca" value={f.marca} onChange={(e) => setF({ ...f, marca: e.target.value })} /></div>
                <div className="grid gap-1"><Label htmlFor="ll-medida">Medida</Label><Input id="ll-medida" placeholder="11R22.5" value={f.medida} onChange={(e) => setF({ ...f, medida: e.target.value })} /></div>
                <div className="grid gap-1"><Label htmlFor="ll-serie">N.º de serie</Label><Input id="ll-serie" value={f.serie} onChange={(e) => setF({ ...f, serie: e.target.value })} /></div>
              </div>
              <div className="grid items-end gap-3 sm:grid-cols-2">
                <div className="grid gap-1"><Label htmlFor="ll-costo">Costo (MXN)</Label><Input id="ll-costo" type="number" min={0} step="0.01" value={f.costo} onChange={(e) => setF({ ...f, costo: e.target.value })} /></div>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={f.bitacora} onChange={(e) => setF({ ...f, bitacora: e.target.checked })} /> Registrar el costo en la bitácora de servicios</label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{vigente ? "Instalar nueva" : "Registrar"}</Button>
                {vigente && <Button type="button" variant="outline" disabled={busy} onClick={() => void retirar()}>Retirar sin reemplazo</Button>}
              </div>
            </form>

            {hist.length > 0 && (
              <div className="grid gap-1">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Historial de esta posición</h4>
                <ul className="divide-y rounded-md border text-sm">
                  {hist.map((h) => (
                    <li key={h.id} className="flex justify-between gap-2 px-3 py-1.5">
                      <span>{fechaMx(h.fecha_instalacion)} → {h.fecha_retiro ? fechaMx(h.fecha_retiro) : <b>vigente</b>}{h.marca ? ` · ${h.marca}` : ""}{h.medida ? ` ${h.medida}` : ""}
                        {h.km_instalacion != null && <span className="text-muted-foreground"> · a {km(Number(h.km_instalacion))}</span>}</span>
                      <span className="whitespace-nowrap text-muted-foreground">{Number(h.costo) ? mxn(Number(h.costo)) : ""}{h.motivo_retiro ? ` ${h.motivo_retiro}` : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
