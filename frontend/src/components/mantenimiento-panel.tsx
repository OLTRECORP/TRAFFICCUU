"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, User, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { calcularAlertas, peorNivel, type Alerta, type Nivel } from "@/lib/mantenimiento";
import { tramos, type Carga, type ViajeRend } from "@/lib/combustible";
import type { Bitacora, Chofer, Regla, ServicioMant, Tracto } from "@/lib/types";
import { cn, fechaMx, km, mxn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { ErrorAlert } from "@/components/error-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ETIQUETA: Record<Nivel, string> = { rojo: "Vencido", amarillo: "Próximo", verde: "OK" };
const BARRA: Record<Nivel, string> = { rojo: "bg-red-500", amarillo: "bg-amber-400", verde: "bg-emerald-500" };

function Semaforo({ nivel }: { nivel: Nivel }) {
  return (
    <Badge variant={nivel}>
      <span className={cn("h-2 w-2 rounded-full", BARRA[nivel])} aria-hidden /> {ETIQUETA[nivel]}
    </Badge>
  );
}

const TRAZO: Record<Nivel, string> = { rojo: "stroke-red-500", amarillo: "stroke-amber-400", verde: "stroke-emerald-500" };

/** Anillo de porcentaje (0-100). `vacio` muestra "—" sin inventar un valor. */
function Anillo({ valor, nivel, etiqueta, detalle, vacio }: { valor: number | null; nivel: Nivel; etiqueta: string; detalle?: string; vacio?: boolean }) {
  const r = 38, c = 2 * Math.PI * r;
  const v = valor == null ? 0 : Math.max(0, Math.min(100, valor));
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <div className="relative h-24 w-24" role="img" aria-label={`${etiqueta}: ${vacio || valor == null ? "sin datos" : `${Math.round(v)}%`}`}>
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" strokeWidth="9" className="stroke-secondary" />
          {!vacio && valor != null && (
            <circle cx="50" cy="50" r={r} fill="none" strokeWidth="9" strokeLinecap="round" className={TRAZO[nivel]}
              strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} />
          )}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-lg font-semibold">
          {vacio || valor == null ? "—" : `${Math.round(v)}%`}
        </span>
      </div>
      <span className="text-sm font-medium leading-tight">{etiqueta}</span>
      {detalle && <span className="text-xs text-muted-foreground">{detalle}</span>}
    </div>
  );
}

async function todo<T>(q: (d: number, h: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let d = 0; ; d += 1000) {
    const { data, error } = await q(d, d + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) return out;
  }
}

type ChoferAsig = Pick<Chofer, "id" | "nombre" | "licencia"> & { tracto_asignado_id: string | null };

export function MantenimientoPanel() {
  const [tractos, setTractos] = useState<Tracto[]>([]);
  const [reglas, setReglas] = useState<Regla[]>([]);
  const [bitacora, setBitacora] = useState<Bitacora[]>([]);
  const [servicios, setServicios] = useState<ServicioMant[]>([]);
  const [choferes, setChoferes] = useState<ChoferAsig[]>([]);
  const [cargas, setCargas] = useState<Carga[]>([]);
  const [viajes, setViajes] = useState<ViajeRend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registro, setRegistro] = useState<{ tracto: Tracto; regla: Regla } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const sb = createClient();
    try {
      const [t, r, b, s, c, cg, v] = await Promise.all([
        todo<Tracto>((d, h) => sb.from("tractocamiones").select("*").order("placa").range(d, h)),
        todo<Regla>((d, h) => sb.from("reglas_mantenimiento").select("*").order("tipo_servicio").range(d, h)),
        todo<Bitacora>((d, h) => sb.from("bitacora_mantenimiento").select("*").order("id").range(d, h)),
        todo<ServicioMant>((d, h) => sb.from("servicios_mantenimiento").select("*").order("fecha", { ascending: false }).order("id").range(d, h)),
        todo<ChoferAsig>((d, h) => sb.from("choferes").select("id, nombre, licencia, tracto_asignado_id").order("nombre").range(d, h)),
        todo<Carga>((d, h) => sb.from("cargas_combustible").select("*").order("fecha", { ascending: false }).order("id").range(d, h)),
        todo<ViajeRend>((d, h) => sb.from("rendimiento_viajes").select("viaje_id, chofer_id, tracto_id, fecha_viaje, km").order("fecha_viaje").order("viaje_id").range(d, h)),
      ]);
      setTractos(t); setReglas(r); setBitacora(b); setServicios(s); setChoferes(c); setCargas(cg); setViajes(v); setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filas = useMemo(
    () => tractos.map((t) => ({ tracto: t, alertas: calcularAlertas(t, reglas, bitacora) })),
    [tractos, reglas, bitacora],
  );
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? filas.filter((f) => `${f.tracto.placa} ${f.tracto.modelo ?? ""}`.toLowerCase().includes(t)) : filas;
  }, [filas, q]);

  // rendimiento km/l por tracto (odómetro, tanque lleno a tanque lleno); sin dos cargas con odómetro no hay valor
  const rendimiento = useMemo(() => {
    const asignados = new Map(choferes.filter((c) => c.tracto_asignado_id).map((c) => [c.tracto_asignado_id!, c.id]));
    const acc = new Map<string, { km: number; litros: number }>();
    for (const t of tramos(cargas, viajes, asignados)) {
      const a = acc.get(t.tractoId) ?? { km: 0, litros: 0 };
      a.km += t.kmOdometro; a.litros += t.litros; acc.set(t.tractoId, a);
    }
    const out = new Map<string, number>();
    for (const [id, a] of acc) if (a.litros > 0) out.set(id, a.km / a.litros);
    return out;
  }, [cargas, viajes, choferes]);
  const mejorRend = useMemo(() => Math.max(0, ...rendimiento.values()), [rendimiento]);

  if (loading) return <p className="text-sm text-muted-foreground">Calculando alertas…</p>;
  if (error) return <ErrorAlert where="mantenimiento" message={error} />;
  if (!tractos.length)
    return <Alert variant="info">No hay tractocamiones. Se crean automáticamente al procesar el primer XML con Carta Porte.</Alert>;

  const actual = filas.find((f) => f.tracto.id === sel) ?? visibles[0] ?? filas[0];

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card className="rounded-xl">
        <CardHeader className="gap-3">
          <CardTitle className="text-base">Vehículos</CardTitle>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input className="pl-9" placeholder="Buscar placa o modelo" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent className="grid max-h-[70vh] gap-2 overflow-y-auto">
          {visibles.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Sin resultados.</p>}
          {visibles.map(({ tracto, alertas }) => {
            const chofer = choferes.find((c) => c.tracto_asignado_id === tracto.id);
            const activo = tracto.id === actual?.tracto.id;
            return (
              <button key={tracto.id} type="button" onClick={() => setSel(tracto.id)} aria-pressed={activo}
                className={cn("grid gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent",
                  activo && "border-primary bg-primary/10")}>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{tracto.placa}</span>
                  <Semaforo nivel={peorNivel(alertas)} />
                </span>
                <span className="text-xs text-muted-foreground">{tracto.modelo ?? "Modelo sin registrar"} · {km(tracto.kilometraje_actual)}</span>
                <span className="text-xs text-muted-foreground">Chofer: {chofer?.nombre ?? "—"}</span>
              </button>
            );
          })}
        </CardContent>
      </Card>
      {actual && (
        <Detalle
          tracto={actual.tracto} alertas={actual.alertas}
          chofer={choferes.find((c) => c.tracto_asignado_id === actual.tracto.id) ?? null}
          servicios={servicios.filter((s) => s.tracto_id === actual.tracto.id)}
          kmPorLitro={rendimiento.get(actual.tracto.id) ?? null} mejorKmPorLitro={mejorRend}
          ultimaCarga={cargas.find((c) => c.tracto_id === actual.tracto.id)?.fecha ?? null}
          onRegistrar={(regla) => setRegistro({ tracto: actual.tracto, regla })}
        />
      )}
      <RegistrarServicio registro={registro} onClose={() => setRegistro(null)} onSaved={() => { setRegistro(null); void load(); }} />
    </div>
  );
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span className="text-sm font-medium">{v}</span>
    </div>
  );
}

function Detalle({ tracto, alertas, chofer, servicios, kmPorLitro, mejorKmPorLitro, ultimaCarga, onRegistrar }: {
  tracto: Tracto; alertas: Alerta[]; chofer: ChoferAsig | null; servicios: ServicioMant[];
  kmPorLitro: number | null; mejorKmPorLitro: number; ultimaCarga: string | null; onRegistrar: (r: Regla) => void;
}) {
  const relativo = kmPorLitro != null && mejorKmPorLitro > 0 ? (kmPorLitro / mejorKmPorLitro) * 100 : null;
  return (
    <div className="grid content-start gap-4">
      <Card className="rounded-xl">
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle className="text-xl">{tracto.placa}</CardTitle>
            <p className="text-sm text-muted-foreground">{tracto.modelo ?? "Modelo sin registrar"}</p>
          </div>
          <Semaforo nivel={peorNivel(alertas)} />
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Dato k="Odómetro actual" v={km(tracto.kilometraje_actual)} />
          <Dato k="Odómetro inicial" v={km(tracto.kilometraje_inicial)} />
          <div className="grid gap-0.5">
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><User className="h-3 w-3" aria-hidden /> Chofer asignado</span>
            <span className="text-sm font-medium">{chofer?.nombre ?? "—"}</span>
            {chofer?.licencia && <span className="text-xs text-muted-foreground">Licencia {chofer.licencia}</span>}
          </div>
          <Dato k="Última carga de diésel" v={ultimaCarga ? fechaMx(ultimaCarga) : "—"} />
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader><CardTitle className="text-base">Estado por servicio (vida restante)</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {alertas.map((a) => (
            <Anillo key={a.regla.id} valor={100 - a.porcentaje} nivel={a.nivel} etiqueta={a.regla.tipo_servicio}
              detalle={a.restante >= 0 ? `faltan ${km(a.restante)}` : `excedido ${km(-a.restante)}`} />
          ))}
          <Anillo valor={relativo} vacio={relativo == null} nivel="verde" etiqueta="Rendimiento de combustible"
            detalle={kmPorLitro != null ? `${kmPorLitro.toFixed(2)} km/l (vs. mejor de la flota)` : "Sin cargas con odómetro"} />
          {alertas.length === 0 && <p className="col-span-full text-sm text-muted-foreground">No hay reglas de mantenimiento configuradas.</p>}
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader><CardTitle className="text-base">Intervalos y registro</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          {alertas.map((a) => <AlertaRow key={a.regla.id} a={a} onRegistrar={() => onRegistrar(a.regla)} />)}
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Wrench className="h-4 w-4" aria-hidden /> Historial de servicios</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {servicios.length === 0 ? <p className="text-sm text-muted-foreground">Sin servicios registrados.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Fecha</th><th className="py-1 pr-3 font-medium">Servicio</th>
                <th className="py-1 pr-3 text-right font-medium">Kilometraje</th><th className="py-1 text-right font-medium">Costo</th>
              </tr></thead>
              <tbody>
                {servicios.slice(0, 8).map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{fechaMx(s.fecha)}</td><td className="py-1.5 pr-3">{s.servicio}</td>
                    <td className="py-1.5 pr-3 text-right">{s.kilometraje != null ? km(s.kilometraje) : "—"}</td>
                    <td className="py-1.5 text-right">{mxn(Number(s.costo))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AlertaRow({ a, onRegistrar }: { a: Alerta; onRegistrar: () => void }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{a.regla.tipo_servicio}</span>
        <div className="flex items-center gap-2">
          <Semaforo nivel={a.nivel} />
          <Button variant="outline" size="sm" onClick={onRegistrar}><Wrench className="h-3.5 w-3.5" /> Registrar</Button>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={Math.round(a.porcentaje)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full", BARRA[a.nivel])} style={{ width: `${Math.min(100, a.porcentaje)}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {km(a.recorrido)} de {km(a.regla.intervalo_km)} ·{" "}
        {a.restante >= 0 ? `faltan ${km(a.restante)}` : `excedido por ${km(-a.restante)}`}
        {a.sinRegistro && " · sin servicio registrado (base: km inicial)"}
      </p>
    </div>
  );
}

function RegistrarServicio({
  registro, onClose, onSaved,
}: { registro: { tracto: Tracto; regla: Regla } | null; onClose: () => void; onSaved: () => void }) {
  const [kmServicio, setKmServicio] = useState("");
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (registro) { setKmServicio(String(registro.tracto.kilometraje_actual)); setObs(""); setError(null); }
  }, [registro]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!registro) return;
    const n = Number(kmServicio);
    if (!Number.isFinite(n) || n < 0) return setError("Kilometraje inválido");
    setSaving(true);
    const { error } = await createClient().from("bitacora_mantenimiento").insert({
      empresa_id: registro.tracto.empresa_id,
      tracto_id: registro.tracto.id,
      servicio_id: registro.regla.id,
      kilometraje_al_servicio: n,
      fecha,
      observaciones: obs || null,
    });
    setSaving(false);
    if (error) setError(error.message);
    else onSaved();
  }

  return (
    <Dialog open={!!registro} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <div>
          <DialogTitle className="text-lg font-semibold">Registrar servicio</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {registro?.regla.tipo_servicio} · {registro?.tracto.placa}
          </DialogDescription>
        </div>
        <form onSubmit={onSubmit} className="grid gap-4">
          {error && <ErrorAlert where="mantenimiento-registro" message={error} />}
          <div className="grid gap-2">
            <Label htmlFor="km">Kilometraje al servicio</Label>
            <Input id="km" type="number" min={0} step="0.1" required value={kmServicio} onChange={(e) => setKmServicio(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="fecha">Fecha</Label>
            <Input id="fecha" type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="obs">Observaciones</Label>
            <Input id="obs" value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
