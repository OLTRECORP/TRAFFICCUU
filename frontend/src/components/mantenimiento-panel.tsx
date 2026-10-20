"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleDot, Loader2, Search, User, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { todo } from "@/lib/paginar";
import { calcularAlertas, peorNivel, textoRestante, type Alerta, type Medida, type Nivel } from "@/lib/mantenimiento";
import { tramos, type Carga, type ViajeRend } from "@/lib/combustible";
import type { Bitacora, Chofer, OdometroTracto, Regla, ServicioMant, Tracto } from "@/lib/types";
import { cn, fechaMx, km, mxn } from "@/lib/utils";
import { CATEGORIAS_SERVICIO, FichaServicios } from "@/components/ficha-servicios";
import { Alert } from "@/components/ui/alert";
import { ErrorAlert } from "@/components/error-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarraVida, FlotaMantenimiento, rubro, TEXTO } from "@/components/mantenimiento/flota";
import { ReglasMantenimiento } from "@/components/mantenimiento/reglas";
import { LlantasUnidad } from "@/components/mantenimiento/llantas";
import { alertaConLlantas, posiciones, resumenLlantas, sumarResumen, type LlantaEstado, type ResumenLlantas } from "@/lib/llantas";

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

type GondolaLl = { id: string; placa: string; ejes: number | null };
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
  const [vista, setVista] = useState<"flota" | "vehiculo">("flota");
  const [odometros, setOdometros] = useState<Map<string, OdometroTracto>>(new Map());
  const [llantas, setLlantas] = useState<LlantaEstado[]>([]);
  const [gondolas, setGondolas] = useState<Map<string, GondolaLl>>(new Map());
  const [gondolaDe, setGondolaDe] = useState<Map<string, string>>(new Map());

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
      // Cómo se estimó cada odómetro (migración 026); sin ella el detalle solo muestra el número
      const od = await sb.from("tractos_odometro").select("*").limit(5000);
      setOdometros(new Map(((od.data ?? []) as OdometroTracto[]).map((o) => [o.tracto_id, o])));
      // Llantas vigentes y góndola actual de cada tracto (migración 027)
      const [ll, g, ga] = await Promise.all([
        sb.from("llantas_estado").select("*").limit(20000),
        sb.from("gondolas").select("id, placa, ejes").limit(5000),
        sb.from("tractos_gondola_actual").select("tracto_id, gondola_id").limit(5000),
      ]);
      setLlantas(ll.error ? [] : ((ll.data ?? []) as LlantaEstado[]));
      setGondolas(new Map(((g.data ?? []) as GondolaLl[]).map((x) => [x.id, x])));
      setGondolaDe(new Map(((ga.data ?? []) as { tracto_id: string; gondola_id: string }[]).map((x) => [x.tracto_id, x.gondola_id])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // la regla de llantas se mide con las llantas vigentes del tracto, no con el último servicio del rubro
  const filas = useMemo(
    () => tractos.map((t) => {
      const propias = llantas.filter((l) => l.tracto_id === t.id);
      return { tracto: t, alertas: calcularAlertas(t, reglas, bitacora, servicios).map((a) => alertaConLlantas(a, propias)) };
    }),
    [tractos, reglas, bitacora, servicios, llantas],
  );
  // cuántas llantas conviene cambiar por tracto: las suyas más las de la góndola que jala hoy
  const resumenLl = useMemo(() => {
    const out = new Map<string, ResumenLlantas>();
    for (const t of tractos) {
      let r = resumenLlantas(posiciones("tracto", t.ejes ?? 3), llantas.filter((l) => l.tracto_id === t.id));
      const g = gondolas.get(gondolaDe.get(t.id) ?? "");
      if (g) r = sumarResumen(r, resumenLlantas(posiciones("gondola", g.ejes ?? 2), llantas.filter((l) => l.gondola_id === g.id)));
      out.set(t.id, r);
    }
    return out;
  }, [tractos, llantas, gondolas, gondolaDe]);
  const vidaLlanta = Number(reglas.find((r) => r.categoria === "llantas" && r.intervalo_km)?.intervalo_km ?? 120000);
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? filas.filter((f) => `${f.tracto.placa} ${f.tracto.modelo ?? ""}`.toLowerCase().includes(t)) : filas;
  }, [filas, q]);

  // rendimiento km/l por tracto: km de Carta Porte entre cargas ÷ litros (tanque lleno a tanque lleno); sin tramos con litros no hay valor
  const rendimiento = useMemo(() => {
    const asignados = new Map(choferes.filter((c) => c.tracto_asignado_id).map((c) => [c.tracto_asignado_id!, c.id]));
    const acc = new Map<string, { km: number; litros: number }>();
    for (const t of tramos(cargas, viajes, asignados)) {
      const a = acc.get(t.tractoId) ?? { km: 0, litros: 0 };
      if (t.litros != null) { a.km += t.km; a.litros += t.litros; acc.set(t.tractoId, a); }
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
    <Tabs value={vista} onValueChange={(v) => setVista(v as "flota" | "vehiculo")} className="grid gap-4">
      <TabsList className="w-fit">
        <TabsTrigger value="flota">Toda la flota</TabsTrigger>
        <TabsTrigger value="vehiculo">Por vehículo</TabsTrigger>
      </TabsList>
      <TabsContent value="flota" className="mt-0 grid gap-4">
        <FlotaMantenimiento filas={filas} reglas={reglas} odometros={odometros} llantas={resumenLl} onElegir={(id) => { setSel(id); setVista("vehiculo"); }} />
        <ReglasMantenimiento reglas={reglas} empresaId={tractos[0]?.empresa_id ?? null} onChange={() => void load()} />
      </TabsContent>
      <TabsContent value="vehiculo" className="mt-0">
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
          cargas={cargas.filter((c) => c.tracto_id === actual.tracto.id)}
          kmViajes={viajes.filter((v) => v.tracto_id === actual.tracto.id).reduce((t, v) => t + Number(v.km), 0)}
          onServiciosChange={() => void load()}
          kmPorLitro={rendimiento.get(actual.tracto.id) ?? null} mejorKmPorLitro={mejorRend}
          ultimaCarga={cargas.find((c) => c.tracto_id === actual.tracto.id)?.fecha ?? null}
          onRegistrar={(regla) => setRegistro({ tracto: actual.tracto, regla })}
          odometro={odometros.get(actual.tracto.id) ?? null} reglas={reglas}
          llantas={llantas} gondola={gondolas.get(gondolaDe.get(actual.tracto.id) ?? "") ?? null} vidaLlanta={vidaLlanta}
          resumenLlantas={resumenLl.get(actual.tracto.id) ?? null}
        />
      )}
      <RegistrarServicio registro={registro} onClose={() => setRegistro(null)} onSaved={() => { setRegistro(null); void load(); }} />
    </div>
      </TabsContent>
    </Tabs>
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

function Detalle({ tracto, alertas, chofer, servicios, cargas, kmViajes, onServiciosChange, kmPorLitro, mejorKmPorLitro, ultimaCarga, onRegistrar, odometro, reglas, llantas, gondola, vidaLlanta, resumenLlantas: rl }: {
  tracto: Tracto; alertas: Alerta[]; chofer: ChoferAsig | null; servicios: ServicioMant[]; cargas: Carga[];
  kmViajes: number; onServiciosChange: () => void;
  kmPorLitro: number | null; mejorKmPorLitro: number; ultimaCarga: string | null; onRegistrar: (r: Regla) => void;
  odometro: OdometroTracto | null; reglas: Regla[];
  llantas: LlantaEstado[]; gondola: GondolaLl | null; vidaLlanta: number; resumenLlantas: ResumenLlantas | null;
}) {
  const porRubro = new Map<string, Alerta[]>();
  for (const a of alertas) porRubro.set(rubro(a.regla.categoria), [...(porRubro.get(rubro(a.regla.categoria)) ?? []), a]);
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
          <div className="grid gap-0.5 sm:col-span-2">
            <span className="text-xs text-muted-foreground">Odómetro {odometro?.fuente === "servicio" ? "estimado" : "actual"}</span>
            <span className="text-lg font-semibold">{km(tracto.kilometraje_actual)}</span>
            {odometro && (
              <span className="text-xs text-muted-foreground">
                {odometro.fuente === "servicio"
                  ? <>Último servicio con kilometraje: {km(Number(odometro.km_base))} el {fechaMx(odometro.fecha_base!)} + {km(Number(odometro.km_viajes))} de {odometro.viajes} viaje{odometro.viajes === 1 ? "" : "s"} posteriores. Se corrige al registrar el siguiente servicio con su km.</>
                  : <>Kilometraje inicial {km(Number(odometro.kilometraje_inicial))} + {km(Number(odometro.km_viajes))} de {odometro.viajes} viajes. Registra un servicio con el km del tablero para fijarlo.</>}
              </span>
            )}
          </div>
          <div className="grid gap-0.5">
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><User className="h-3 w-3" aria-hidden /> Chofer asignado</span>
            <span className="text-sm font-medium">{chofer?.nombre ?? "—"}</span>
            {chofer?.licencia && <span className="text-xs text-muted-foreground">Licencia {chofer.licencia}</span>}
          </div>
          <Dato k="Última carga de diésel" v={ultimaCarga ? fechaMx(ultimaCarga) : "—"} />
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader><CardTitle className="text-base">Siguiente servicio por rubro (vida restante)</CardTitle></CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
            {[...porRubro.entries()].sort((a, b) => a[0].localeCompare(b[0])).flatMap(([r, lista]) => lista.map((a) => (
              <div key={a.regla.id} className="grid justify-items-center gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{r}</span>
                <Anillo valor={100 - a.porcentaje} vacio={!a.km && !a.dias} nivel={a.nivel} etiqueta={a.regla.tipo_servicio} detalle={textoRestante(a, km)} />
              </div>
            )))}
            <div className="grid justify-items-center gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Combustible</span>
              <Anillo valor={relativo} vacio={relativo == null} nivel="verde" etiqueta="Rendimiento"
                detalle={kmPorLitro != null ? `${kmPorLitro.toFixed(2)} km/l (vs. mejor de la flota)` : "Sin dos cargas con litros"} />
            </div>
          </div>
          {alertas.length === 0 && <p className="text-sm text-muted-foreground">No hay servicios programados. Agrégalos en «Toda la flota».</p>}
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader className="gap-1">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2"><CircleDot className="h-4 w-4" aria-hidden /> Llantas vigentes</span>
            {rl && (
              <Badge variant={rl.vencidas ? "rojo" : rl.proximas ? "amarillo" : "verde"}>
                {rl.recomendadas ? `Recomendado cambiar ${rl.recomendadas} de ${rl.total}` : `Ninguna por cambiar (${rl.total})`}
              </Badge>
            )}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Cada llanta se mide desde su instalación: en el tracto con su odómetro, en la góndola con los km de sus viajes posteriores.
            {gondola ? ` Góndola actual (último viaje): ${gondola.placa}.` : " Sin góndola en sus viajes."}
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <LlantasUnidad unidad={{ tipo: "tracto", id: tracto.id, placa: tracto.placa, ejes: tracto.ejes ?? 3, empresaId: tracto.empresa_id, odometro: Number(tracto.kilometraje_actual) }}
            llantas={llantas.filter((l) => l.tracto_id === tracto.id)} vidaDefault={vidaLlanta} onChange={onServiciosChange} />
          {gondola && (
            <LlantasUnidad unidad={{ tipo: "gondola", id: gondola.id, placa: gondola.placa, ejes: gondola.ejes ?? 2, empresaId: tracto.empresa_id }}
              llantas={llantas.filter((l) => l.gondola_id === gondola.id)} vidaDefault={vidaLlanta} onChange={onServiciosChange} />
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader><CardTitle className="text-base">Intervalos y registro</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          {alertas.map((a) => <AlertaRow key={a.regla.id} a={a} onRegistrar={() => onRegistrar(a.regla)} />)}
        </CardContent>
      </Card>

      <CostoOperacion servicios={servicios} cargas={cargas} kmViajes={kmViajes} />

      <Card className="rounded-xl">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Wrench className="h-4 w-4" aria-hidden /> Servicios y reparaciones</CardTitle></CardHeader>
        <CardContent>
          <FichaServicios tipo="tracto" unidadId={tracto.id} empresaId={tracto.empresa_id} kmActual={tracto.kilometraje_actual} onChange={onServiciosChange} reglas={reglas} />
        </CardContent>
      </Card>
    </div>
  );
}

/** Costo de operación del tracto: servicios por tipo + diésel registrado, y costo por km de Carta Porte. */
function CostoOperacion({ servicios, cargas, kmViajes }: { servicios: ServicioMant[]; cargas: Carga[]; kmViajes: number }) {
  const porTipo = new Map<string, number>();
  for (const s of servicios) {
    const k = CATEGORIAS_SERVICIO.find((c) => c.value === s.categoria)?.label ?? "Sin tipo";
    porTipo.set(k, (porTipo.get(k) ?? 0) + Number(s.costo));
  }
  const filas = [...porTipo.entries()].sort((a, b) => b[1] - a[1]);
  const mant = filas.reduce((t, [, v]) => t + v, 0);
  const diesel = cargas.reduce((t, c) => t + Number(c.costo ?? 0), 0);
  const total = mant + diesel;
  const max = Math.max(1, ...filas.map(([, v]) => v));
  return (
    <Card className="rounded-xl">
      <CardHeader><CardTitle className="text-base">Costo de operación (historial)</CardTitle></CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-4">
          <Dato k="Mantenimiento" v={mxn(mant)} />
          <Dato k="Diésel (costo registrado)" v={mxn(diesel)} />
          <Dato k="Total" v={mxn(total)} />
          <Dato k="Costo por km (Carta Porte)" v={kmViajes > 0 ? `${mxn(total / kmViajes)} / km` : "—"} />
        </div>
        {filas.length > 0 && (
          <ul className="grid gap-1.5">
            {filas.map(([tipo, v]) => (
              <li key={tipo} className="grid grid-cols-[110px_1fr_auto] items-center gap-2 text-sm">
                <span>{tipo}</span>
                <span className="h-2 overflow-hidden rounded-full bg-secondary"><span className="block h-full bg-primary" style={{ width: `${(v / max) * 100}%` }} /></span>
                <span className="whitespace-nowrap text-right font-medium">{mxn(v)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">El costo por km usa los km (redondo) de todos los viajes del tracto; el diésel solo suma las cargas con costo capturado.</p>
      </CardContent>
    </Card>
  );
}

function Linea({ m, unidad }: { m: Medida; unidad: "km" | "días" }) {
  const txt = unidad === "km"
    ? `${km(m.usado)} de ${km(m.intervalo)} · ${m.restante >= 0 ? `faltan ${km(m.restante)}` : `excedido ${km(-m.restante)}`}`
    : `${m.usado} de ${m.intervalo} días · ${m.restante >= 0 ? `faltan ${m.restante} días` : `vencido hace ${-m.restante} días`}`;
  return <p className={cn("text-xs", TEXTO[m.nivel])}>{txt}</p>;
}

function AlertaRow({ a, onRegistrar }: { a: Alerta; onRegistrar: () => void }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{a.regla.tipo_servicio} <span className="text-xs font-normal text-muted-foreground">· {rubro(a.regla.categoria)}</span></span>
        <div className="flex items-center gap-2">
          <Semaforo nivel={a.nivel} />
          <Button variant="outline" size="sm" onClick={onRegistrar}><Wrench className="h-3.5 w-3.5" /> Registrar</Button>
        </div>
      </div>
      <BarraVida a={a} />
      {a.km && <Linea m={a.km} unidad="km" />}
      {a.dias && <Linea m={a.dias} unidad="días" />}
      <p className="text-xs text-muted-foreground">
        {a.ultimo ? `Último: ${a.ultimo.servicio} el ${fechaMx(a.ultimo.fecha)}${a.ultimo.km != null ? ` a ${km(a.ultimo.km)}` : ""}`
          : `Sin servicio registrado${a.km ? " (km desde el kilometraje inicial)" : ""}${a.regla.intervalo_dias ? "; los días empiezan a contar al registrarlo" : ""}`}
      </p>
    </div>
  );
}

function RegistrarServicio({
  registro, onClose, onSaved,
}: { registro: { tracto: Tracto; regla: Regla } | null; onClose: () => void; onSaved: () => void }) {
  const [kmServicio, setKmServicio] = useState("");
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [costo, setCosto] = useState("");
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (registro) { setKmServicio(String(Math.round(Number(registro.tracto.kilometraje_actual)))); setCosto(""); setObs(""); setError(null); }
  }, [registro]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!registro) return;
    const n = Number(kmServicio), c = Number(costo || 0);
    if (!Number.isFinite(n) || n < 0) return setError("Kilometraje inválido");
    if (!Number.isFinite(c) || c < 0) return setError("Costo inválido");
    setSaving(true);
    // Se guarda en la bitácora de servicios del tracto (con su costo); el km capturado se vuelve el nuevo punto de partida del odómetro.
    const { error } = await createClient().from("servicios_mantenimiento").insert({
      empresa_id: registro.tracto.empresa_id, tracto_id: registro.tracto.id, regla_id: registro.regla.id,
      servicio: registro.regla.tipo_servicio, categoria: registro.regla.categoria ?? "otro",
      kilometraje: n, fecha, costo: c, notas: obs || null,
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
            {registro?.regla.tipo_servicio} · {rubro(registro?.regla.categoria ?? null)} · {registro?.tracto.placa}
          </DialogDescription>
        </div>
        <form onSubmit={onSubmit} className="grid gap-4">
          {error && <ErrorAlert where="mantenimiento-registro" message={error} />}
          <div className="grid gap-2">
            <Label htmlFor="km">Kilometraje del tablero al servicio</Label>
            <Input id="km" type="number" min={0} step="0.1" required value={kmServicio} onChange={(e) => setKmServicio(e.target.value)} />
            <span className="text-xs text-muted-foreground">Viene sugerido el odómetro estimado; corrígelo con el real. Desde aquí se vuelve a calcular el odómetro del tracto.</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="fecha">Fecha</Label>
              <Input id="fecha" type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="costo">Costo (MXN)</Label>
              <Input id="costo" type="number" min={0} step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="0" />
            </div>
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
