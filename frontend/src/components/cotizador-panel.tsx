"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, Clock, FilePlus2, Loader2, Printer, Route as RouteIcon, Save, Truck, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ApiError, postBackend } from "@/lib/api";
import { todo } from "@/lib/paginar";
import { tramos, type Carga, type ViajeRend } from "@/lib/combustible";
import { condicionesBase, cotizar, ESTADOS, ETIQUETA_ESTADO, evaluarOferta, IVA, parametrosDesdeHistorial, PARAMETROS_BASE, RETENCION_IVA, validar, VIGENCIA_BASE, type DocumentoCotizacion, type EntradaCotizacion, type EstadoCotizacion, type Parametros, type ParametrosSugeridos, type UnidadCobro } from "@/lib/cotizador";
import { decodificarPolilinea, duracionTexto, FUENTE_RUTA } from "@/lib/rutas";
import type { Lugar } from "@/lib/types";
import { cn, fechaMx, km, mxn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert } from "@/components/error-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mapa } from "@/components/mapa-dinamico";
import { CotizacionesGuardadas, type Guardada } from "@/components/cotizaciones-guardadas";
import { ImprimirCotizacion } from "@/components/cotizacion-documento";

const sel = "h-10 w-full rounded-md border bg-background px-3 text-sm";
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
const hoyLocal = () => new Date().toLocaleDateString("en-CA");
const unidadTexto = (u: UnidadCobro) => (u === "tonelada" ? "t" : "m³");

interface Punto { texto: string; lat: number | null; lng: number | null }
interface RutaCot { origen: { lat: number | null; lng: number | null; nombre: string | null }; destino: { lat: number | null; lng: number | null; nombre: string | null }; km: number; minutos: number; geometria: string | null; fuente: string }

const CAMPOS: { k: keyof Parametros; label: string; sufijo: string; paso?: string }[] = [
  { k: "diesel_precio_litro", label: "Precio del diésel", sufijo: "$/L", paso: "0.01" },
  { k: "rendimiento_km_l", label: "Rendimiento del tracto", sufijo: "km/l", paso: "0.01" },
  { k: "mant_por_km", label: "Desgaste: mantenimiento y llantas", sufijo: "$/km", paso: "0.01" },
  { k: "depreciacion_por_km", label: "Depreciación y financiamiento", sufijo: "$/km", paso: "0.01" },
  { k: "costo_dia", label: "Costos fijos por día (seguros, GPS…)", sufijo: "$/día" },
  { k: "horas_carga_descarga", label: "Carga y descarga", sufijo: "h", paso: "0.5" },
  { k: "horas_jornada", label: "Horas de jornada", sufijo: "h", paso: "0.5" },
  { k: "indirectos_pct", label: "Indirectos (administración)", sufijo: "% de costos directos", paso: "0.1" },
  { k: "comision_pct", label: "Comisión del chofer", sufijo: "% del precio", paso: "0.1" },
  { k: "ganancia_pct", label: "Ganancia deseada", sufijo: "% del precio", paso: "0.1" },
];

function PuntoInput({ id, label, valor, lugares, onChange }: { id: string; label: string; valor: Punto; lugares: Lugar[]; onChange: (p: Punto) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} placeholder="Calle, colonia, municipio y estado (o elige un lugar guardado)" value={valor.texto}
        onChange={(e) => onChange({ texto: e.target.value, lat: null, lng: null })} />
      <select aria-label={`${label}: lugar guardado`} className={cn(sel, "h-8 text-xs")} value=""
        onChange={(e) => { const l = lugares.find((x) => x.id === e.target.value); if (l) onChange({ texto: l.nombre, lat: Number(l.lat), lng: Number(l.lng) }); }}>
        <option value="">Usar un lugar guardado…</option>
        {lugares.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
      </select>
    </div>
  );
}

export function CotizadorPanel() {
  const [lugares, setLugares] = useState<Lugar[]>([]);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [sugeridos, setSugeridos] = useState<ParametrosSugeridos>({ params: PARAMETROS_BASE, origen: {} });
  const [params, setParams] = useState<Parametros>(PARAMETROS_BASE);
  const [guardados, setGuardados] = useState(false);          // hay supuestos guardados de la empresa
  const [historial, setHistorial] = useState<Guardada[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number; path?: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [origen, setOrigen] = useState<Punto>({ texto: "", lat: null, lng: null });
  const [destino, setDestino] = useState<Punto>({ texto: "", lat: null, lng: null });
  const [ruta, setRuta] = useState<RutaCot | null>(null);
  const [calculando, setCalculando] = useState(false);

  const [cliente, setCliente] = useState("");
  const [unidad, setUnidad] = useState<UnidadCobro>("tonelada");
  const [cantidad, setCantidad] = useState("30");
  const [casetas, setCasetas] = useState("0");
  const [otros, setOtros] = useState("0");
  const [redondo, setRedondo] = useState(true);
  const [guardando, setGuardando] = useState(false);

  // Datos del documento y edición
  const [mercancia, setMercancia] = useState("");
  const [vigencia, setVigencia] = useState(String(VIGENCIA_BASE));
  const [condiciones, setCondiciones] = useState(() => condicionesBase(PARAMETROS_BASE.horas_carga_descarga));
  const [estado, setEstado] = useState<EstadoCotizacion>("borrador");
  const [precioOfertado, setPrecioOfertado] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [folio, setFolio] = useState<number | null>(null);
  const [fechaDoc, setFechaDoc] = useState(hoyLocal());
  const [imprimir, setImprimir] = useState<DocumentoCotizacion | null>(null);

  const cargar = useCallback(async () => {
    const sb = createClient();
    try {
      const hace1a = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
      const [lug, emp, par, cot, cargas, viajes, serv, chof] = await Promise.all([
        sb.from("lugares").select("*").eq("activo", true).not("lat", "is", null).order("nombre").limit(2000),
        sb.from("empresa_configuracion").select("id").maybeSingle(),
        sb.from("cotizador_parametros").select("parametros").maybeSingle(),
        sb.from("cotizaciones").select("*").order("created_at", { ascending: false }).limit(300),
        todo<Carga>((d, h) => sb.from("cargas_combustible").select("*").order("fecha", { ascending: false }).order("id").range(d, h)),
        todo<ViajeRend>((d, h) => sb.from("rendimiento_viajes").select("viaje_id, chofer_id, tracto_id, fecha_viaje, km").order("fecha_viaje").order("viaje_id").range(d, h)),
        todo<{ fecha: string; costo: number; tracto_id: string | null }>((d, h) => sb.from("servicios_mantenimiento").select("id, fecha, costo, tracto_id").gte("fecha", hace1a).order("id").range(d, h)),
        todo<{ id: string; tracto_asignado_id: string | null }>((d, h) => sb.from("choferes").select("id, tracto_asignado_id").order("id").range(d, h)),
      ]);
      setLugares((lug.data ?? []) as Lugar[]);
      setEmpresaId((emp.data as { id: string } | null)?.id ?? null);
      // Las tablas del cotizador existen desde la migración 030; sin ella solo se pierde guardar
      setHistorial(cot.error ? [] : ((cot.data ?? []) as Guardada[]));
      const asignados = new Map(chof.filter((c) => c.tracto_asignado_id).map((c) => [c.tracto_asignado_id!, c.id]));
      const sug = parametrosDesdeHistorial({
        cargas, servicios: serv, viajes,
        tramos: tramos(cargas, viajes, asignados).map((t) => ({ km: t.km, litros: t.litros })),
      });
      setSugeridos(sug);
      const guardado = par.error ? null : (par.data as { parametros: Partial<Parametros> } | null)?.parametros;
      setGuardados(!!guardado && Object.keys(guardado).length > 0);
      setParams({ ...sug.params, ...(guardado ?? {}) });
      setCondiciones(condicionesBase({ ...sug.params, ...(guardado ?? {}) }.horas_carga_descarga));
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e) });
    }
    setCargando(false);
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const refrescarHistorial = useCallback(async () => {
    const { data, error: e } = await createClient().from("cotizaciones").select("*").order("created_at", { ascending: false }).limit(300);
    if (!e) setHistorial((data ?? []) as Guardada[]);
  }, []);

  async function calcularRuta() {
    setCalculando(true); setError(null); setAviso(null);
    const punto = (p: Punto) => (p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng, direccion: p.texto || undefined } : { direccion: p.texto.trim() });
    try {
      setRuta(await postBackend<RutaCot>("cotizador/ruta", JSON.stringify({ origen: punto(origen), destino: punto(destino) }), "application/json"));
    } catch (e) { const a = e as ApiError; setRuta(null); setError({ message: a.message, status: a.status, path: a.path }); }
    setCalculando(false);
  }

  const entrada: EntradaCotizacion | null = ruta ? {
    km_ida: ruta.km, minutos_ida: ruta.minutos, redondo, cantidad: num(cantidad), unidad,
    casetas: num(casetas), otros: num(otros), params,
  } : null;
  const problema = entrada ? validar(entrada) : null;
  const r = useMemo(() => (entrada && !validar(entrada) ? cotizar(entrada) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ruta, redondo, cantidad, unidad, casetas, otros, params]);
  const trazo = useMemo(() => (ruta?.geometria ? decodificarPolilinea(ruta.geometria) : undefined), [ruta?.geometria]);
  const puntos = ruta && ruta.origen.lat != null && ruta.origen.lng != null && ruta.destino.lat != null && ruta.destino.lng != null
    ? [{ lat: ruta.origen.lat, lng: ruta.origen.lng, etiqueta: origen.texto || "Origen" }, { lat: ruta.destino.lat, lng: ruta.destino.lng, etiqueta: destino.texto || "Destino" }] : [];
  // Lo que se cobra: el precio sugerido o el propio que se capture
  const propio = num(precioOfertado);
  const oferta = useMemo(() => (r && entrada ? evaluarOferta(r, params, entrada.cantidad, propio > 0 ? propio : undefined) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [r, params, precioOfertado]);
  const vigenciaDias = Math.round(num(vigencia));
  const documento: DocumentoCotizacion | null = r && oferta && entrada && ruta ? {
    folio, fecha: fechaDoc, vigencia_dias: vigenciaDias > 0 ? vigenciaDias : VIGENCIA_BASE, cliente: cliente.trim() || null,
    origen: origen.texto || ruta.origen.nombre || "Origen", destino: destino.texto || ruta.destino.nombre || "Destino", mercancia: mercancia.trim() || null,
    km_ida: ruta.km, minutos_ida: ruta.minutos, redondo, cantidad: entrada.cantidad, unidad, precio_unidad: oferta.precioPorUnidad, condiciones,
  } : null;
  const etiquetaUnidad = unidad === "tonelada" ? "tonelada" : "m³";

  async function guardarSupuestos() {
    if (!empresaId) return setError({ message: "No se encontró la empresa" });
    const { error: e } = await createClient().from("cotizador_parametros").upsert({ empresa_id: empresaId, parametros: params }, { onConflict: "empresa_id" });
    if (e) setError({ message: e.message.includes("cotizador_parametros") ? "Ejecuta la migración 030 en Supabase" : e.message });
    else { setGuardados(true); setAviso("Supuestos guardados: se usarán en las próximas cotizaciones."); }
  }

  const errorMigracion = (m: string) => (/folio|mercancia|vigencia|condiciones|estado|updated_at/.test(m) ? "Ejecuta la migración 032 en Supabase" : /cotizaciones/.test(m) ? "Ejecuta las migraciones 030 y 032 en Supabase" : m);

  /** Guarda la cotización (nueva) o los cambios de la que se está editando. */
  async function guardarCotizacion(comoNueva = false) {
    if (!r || !entrada || !empresaId || !ruta || !oferta) return;
    if (!(vigenciaDias > 0)) return setError({ message: "La vigencia debe ser de al menos 1 día" });
    setGuardando(true); setError(null); setAviso(null);
    const fila = {
      cliente: cliente.trim() || null, origen: origen.texto || ruta.origen.nombre || "Origen", destino: destino.texto || ruta.destino.nombre || "Destino",
      mercancia: mercancia.trim() || null, km_ida: ruta.km, minutos_ida: ruta.minutos, unidad, cantidad: entrada.cantidad,
      precio: oferta.precio, precio_unidad: oferta.precioPorUnidad, precio_minimo: r.precioMinimo,
      vigencia_dias: vigenciaDias, condiciones: condiciones.trim() || null, estado,
      entrada: { ...entrada, fuente_ruta: ruta.fuente, ruta }, resultado: { ...r, total: oferta.total, oferta },
    };
    const sb = createClient();
    const { data, error: e } = editId && !comoNueva
      ? await sb.from("cotizaciones").update(fila).eq("id", editId).select("id, folio").single()
      : await sb.from("cotizaciones").insert({ ...fila, empresa_id: empresaId }).select("id, folio").single();
    setGuardando(false);
    if (e) return setError({ message: errorMigracion(e.message) });
    const g = data as { id: string; folio: number };
    setEditId(g.id); setFolio(g.folio);
    setAviso(editId && !comoNueva ? `Cambios guardados en la cotización ${String(g.folio).padStart(5, "0")}.` : `Cotización ${String(g.folio).padStart(5, "0")} guardada.`);
    void refrescarHistorial();
  }

  function nueva() {
    setEditId(null); setFolio(null); setFechaDoc(hoyLocal()); setRuta(null); setOrigen({ texto: "", lat: null, lng: null }); setDestino({ texto: "", lat: null, lng: null });
    setCliente(""); setMercancia(""); setPrecioOfertado(""); setEstado("borrador"); setVigencia(String(VIGENCIA_BASE));
    setCondiciones(condicionesBase(params.horas_carga_descarga)); setError(null); setAviso(null);
  }

  /** Carga una cotización guardada en el formulario para editarla (o, con `copia`, para guardarla como una nueva). */
  function cargarCotizacion(c: Guardada, copia = false) {
    const en = (c.entrada ?? {}) as { redondo?: boolean; casetas?: number; otros?: number; params?: Partial<Parametros>; ruta?: RutaCot; fuente_ruta?: string };
    const rt = en.ruta ?? { origen: { lat: null, lng: null, nombre: c.origen }, destino: { lat: null, lng: null, nombre: c.destino }, km: Number(c.km_ida), minutos: c.minutos_ida ?? 0, geometria: null, fuente: en.fuente_ruta ?? "osrm-auto" };
    setOrigen({ texto: c.origen, lat: rt.origen.lat, lng: rt.origen.lng });
    setDestino({ texto: c.destino, lat: rt.destino.lat, lng: rt.destino.lng });
    setRuta({ ...rt, km: Number(c.km_ida), minutos: c.minutos_ida ?? rt.minutos });
    setCliente(c.cliente ?? ""); setMercancia(c.mercancia ?? ""); setUnidad(c.unidad); setCantidad(String(Number(c.cantidad)));
    setCasetas(String(en.casetas ?? 0)); setOtros(String(en.otros ?? 0)); setRedondo(en.redondo ?? true);
    if (en.params) setParams((p) => ({ ...p, ...en.params }));
    setVigencia(String(c.vigencia_dias ?? VIGENCIA_BASE)); setCondiciones(c.condiciones ?? condicionesBase(params.horas_carga_descarga));
    setPrecioOfertado(String(Number(c.precio_unidad)));   // se conserva el precio que se cotizó aunque hoy los costos den otro
    setError(null);
    if (copia) { setEditId(null); setFolio(null); setEstado("borrador"); setFechaDoc(hoyLocal()); setAviso("Copia lista: ajusta lo que necesites y guárdala como cotización nueva."); }
    else { setEditId(c.id); setFolio(c.folio); setEstado(c.estado); setFechaDoc(c.created_at.slice(0, 10)); setAviso(null); }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function documentoDe(c: Guardada): DocumentoCotizacion {
    const en = (c.entrada ?? {}) as { redondo?: boolean };
    return {
      folio: c.folio, fecha: c.created_at.slice(0, 10), vigencia_dias: c.vigencia_dias ?? VIGENCIA_BASE, cliente: c.cliente, origen: c.origen, destino: c.destino,
      mercancia: c.mercancia, km_ida: Number(c.km_ida), minutos_ida: c.minutos_ida, redondo: en.redondo ?? true, cantidad: Number(c.cantidad), unidad: c.unidad,
      precio_unidad: Number(c.precio_unidad), condiciones: c.condiciones ?? condicionesBase(params.horas_carga_descarga),
    };
  }

  async function cambiarEstado(c: Guardada, e: EstadoCotizacion) {
    const { error: err } = await createClient().from("cotizaciones").update({ estado: e }).eq("id", c.id);
    if (err) return setError({ message: errorMigracion(err.message) });
    setHistorial((h) => h.map((x) => (x.id === c.id ? { ...x, estado: e } : x)));
    if (c.id === editId) setEstado(e);
  }

  async function borrar(c: Guardada) {
    if (!window.confirm(`¿Eliminar la cotización ${String(c.folio ?? "").padStart(5, "0")} de ${c.origen} a ${c.destino}?`)) return;
    const { error: e } = await createClient().from("cotizaciones").delete().eq("id", c.id);
    if (e) return setError({ message: e.message });
    setHistorial((h) => h.filter((x) => x.id !== c.id));
    if (c.id === editId) nueva();
  }

  if (cargando) return <p className="text-sm text-muted-foreground">Cargando datos de la flota…</p>;
  const set = (k: keyof Parametros, v: string) => setParams((p) => ({ ...p, [k]: num(v) }));
  const maximo = r ? Math.max(...r.desglose.map((d) => d.monto), r.comision, r.ganancia, 1) : 1;

  return (
    <div className="grid gap-4">
      {editId && (
        <Alert variant="info" className="flex flex-wrap items-center justify-between gap-2">
          <span>Editando la cotización <b>{String(folio ?? "").padStart(5, "0")}</b>. «Guardar cambios» la actualiza; «Guardar como nueva» deja la original intacta.</span>
          <Button size="sm" variant="outline" onClick={nueva}><X className="h-4 w-4" /> Dejar de editar</Button>
        </Alert>
      )}
      {error && <ErrorAlert where="cotizador" message={error.message} status={error.status} path={error.path} />}
      {aviso && <Alert variant="success">{aviso}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card className="rounded-xl">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><RouteIcon className="h-4 w-4" aria-hidden /> Ruta</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <PuntoInput id="cot-origen" label="Origen" valor={origen} lugares={lugares} onChange={(p) => { setOrigen(p); setRuta(null); }} />
            <PuntoInput id="cot-destino" label="Destino" valor={destino} lugares={lugares} onChange={(p) => { setDestino(p); setRuta(null); }} />
            <div>
              <Button onClick={() => void calcularRuta()} disabled={calculando || !origen.texto.trim() || !destino.texto.trim()}>
                {calculando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />} Calcular ruta para camión
              </Button>
            </div>
            {ruta && (
              <>
                <Mapa puntos={puntos} linea={!trazo} trazo={trazo} alto={260} />
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="flex items-center gap-1"><RouteIcon className="h-4 w-4" aria-hidden /> Ida <b>{km(ruta.km)}</b></span>
                  <span className="flex items-center gap-1"><Clock className="h-4 w-4" aria-hidden /> <b>{duracionTexto(ruta.minutos)}</b> · ida y vuelta {duracionTexto(ruta.minutos * 2)}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground"><Truck className="h-3.5 w-3.5" aria-hidden /> {FUENTE_RUTA[ruta.fuente] ?? ruta.fuente}</span>
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Calculator className="h-4 w-4" aria-hidden /> Carga y cobro</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label htmlFor="cot-cliente">Cliente (opcional)</Label><Input id="cot-cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="cot-mercancia">Mercancía (opcional)</Label><Input id="cot-mercancia" placeholder="Triturado de roca, arena…" value={mercancia} onChange={(e) => setMercancia(e.target.value)} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="cot-unidad">Cobrar por</Label>
                <select id="cot-unidad" className={sel} value={unidad} onChange={(e) => setUnidad(e.target.value as UnidadCobro)}>
                  <option value="tonelada">Tonelada</option><option value="m3">Metro cúbico (m³)</option>
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cot-cantidad">Cantidad ({unidad === "tonelada" ? "toneladas" : "m³"})</Label>
                <Input id="cot-cantidad" type="number" min={0} step="0.1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
              </div>
              <div className="grid gap-1.5"><Label htmlFor="cot-casetas">Casetas y peajes (total, MXN)</Label><Input id="cot-casetas" type="number" min={0} value={casetas} onChange={(e) => setCasetas(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="cot-otros">Maniobras y otros (MXN)</Label><Input id="cot-otros" type="number" min={0} value={otros} onChange={(e) => setOtros(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="cot-ganancia">Ganancia deseada (% del precio)</Label>
                <Input id="cot-ganancia" type="number" min={0} max={90} step="0.5" value={Number.isNaN(params.ganancia_pct) ? "" : params.ganancia_pct} onChange={(e) => set("ganancia_pct", e.target.value)} /></div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" checked={redondo} onChange={(e) => setRedondo(e.target.checked)} /> La unidad regresa vacía (km y tiempo × 2)
              </label>
            </div>

            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">Documento: vigencia, estado y condiciones</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1"><Label htmlFor="cot-vigencia" className="text-xs">Vigencia (días)</Label><Input id="cot-vigencia" type="number" min={1} value={vigencia} onChange={(e) => setVigencia(e.target.value)} /></div>
                <div className="grid gap-1"><Label htmlFor="cot-estado" className="text-xs">Estado</Label>
                  <select id="cot-estado" className={sel} value={estado} onChange={(e) => setEstado(e.target.value as EstadoCotizacion)}>{ESTADOS.map((x) => <option key={x} value={x}>{ETIQUETA_ESTADO[x]}</option>)}</select></div>
                <div className="grid gap-1 sm:col-span-2"><Label htmlFor="cot-condiciones" className="text-xs">Condiciones (una por renglón; salen impresas)</Label>
                  <textarea id="cot-condiciones" rows={6} className="rounded-md border bg-background px-3 py-2 text-sm" value={condiciones} onChange={(e) => setCondiciones(e.target.value)} />
                  <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={() => setCondiciones(condicionesBase(params.horas_carga_descarga))}>Restablecer condiciones</Button></div>
              </div>
            </details>

            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">Supuestos de costos {guardados ? <Badge variant="verde" className="ml-2">guardados</Badge> : <Badge variant="amarillo" className="ml-2">sin guardar</Badge>}</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {CAMPOS.filter((c) => c.k !== "ganancia_pct").map((c) => {
                  const o = sugeridos.origen[c.k];
                  return (
                    <div key={c.k} className="grid gap-1">
                      <Label htmlFor={`par-${c.k}`} className="text-xs">{c.label} <span className="font-normal text-muted-foreground">({c.sufijo})</span></Label>
                      <Input id={`par-${c.k}`} type="number" min={0} step={c.paso ?? "1"} value={Number.isNaN(params[c.k]) ? "" : params[c.k]} onChange={(e) => set(c.k, e.target.value)} />
                      <span className="text-[11px] text-muted-foreground">{o ? `De tu historial: ${o.nota}` : c.k === "comision_pct" ? "General de Comisiones (ajusta si cotizas con otra tasa)" : "Valor de referencia: ajústalo a tu operación"}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void guardarSupuestos()}><Save className="h-4 w-4" /> Guardar como supuestos de la empresa</Button>
                <Button size="sm" variant="ghost" onClick={() => setParams(sugeridos.params)}>Usar los de mi historial</Button>
              </div>
            </details>
          </CardContent>
        </Card>
      </div>

      {!ruta ? (
        <Alert variant="info">Escribe el origen y el destino (o elige lugares guardados) y calcula la ruta para ver el precio sugerido.</Alert>
      ) : problema ? (
        <Alert variant="error">{problema}</Alert>
      ) : r && oferta && (
        <Card className="rounded-xl border-primary/40">
          <CardHeader className="gap-3">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span>{propio > 0 ? "Cotización con precio propio" : "Cotización sugerida"}</span>
              <span className="flex items-center gap-2 text-sm font-normal">
                <Label htmlFor="cot-oferta" className="text-xs">Precio ofertado por {etiquetaUnidad}</Label>
                <Input id="cot-oferta" type="number" min={0} step="0.5" className="h-8 w-28" placeholder={String(r.precioPorUnidad)} value={precioOfertado} onChange={(e) => setPrecioOfertado(e.target.value)} />
                {precioOfertado && <Button size="sm" variant="ghost" onClick={() => setPrecioOfertado("")}>Usar sugerido</Button>}
              </span>
            </CardTitle>
            {oferta.bajoMinimo && <Alert variant="error">Este precio está por debajo del mínimo sin pérdida ({mxn(r.precioMinimoPorUnidad)} por {etiquetaUnidad}): el viaje dejaría una pérdida de {mxn(-oferta.ganancia)}.</Alert>}
            {!oferta.bajoMinimo && oferta.bajoDeseado && <Alert variant="info">Este precio cubre los costos y la comisión, pero deja {oferta.gananciaPct.toFixed(1)} % de ganancia, menos que el {params.ganancia_pct} % deseado.</Alert>}
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-primary/10 p-3 sm:col-span-2">
                <p className="text-xs text-muted-foreground">Precio por {etiquetaUnidad}</p>
                <p className="text-3xl font-bold">{mxn(oferta.precioPorUnidad)}</p>
                <p className="text-sm">Flete total <b>{mxn(oferta.precio)}</b> antes de IVA · {entrada!.cantidad} {unidadTexto(unidad)}</p>
                {propio > 0 && <p className="text-xs text-muted-foreground">Sugerido: {mxn(r.precioPorUnidad)} por {etiquetaUnidad}</p>}
              </div>
              <div className="rounded-lg bg-secondary/60 p-3">
                <p className="text-xs text-muted-foreground">Mínimo sin pérdida</p>
                <p className="text-xl font-bold">{mxn(r.precioMinimoPorUnidad)}<span className="text-xs font-normal"> /{etiquetaUnidad}</span></p>
                <p className="text-xs text-muted-foreground">{mxn(r.precioMinimo)} en total</p>
              </div>
              <div className="rounded-lg bg-secondary/60 p-3">
                <p className="text-xs text-muted-foreground">Ganancia</p>
                <p className={cn("text-xl font-bold", oferta.ganancia < 0 && "text-red-600 dark:text-red-400")}>{mxn(oferta.ganancia)}</p>
                <p className="text-xs text-muted-foreground">{oferta.gananciaPct.toFixed(1)} % del precio</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="grid gap-2">
                <h3 className="text-sm font-semibold">¿En qué se va el precio?</h3>
                <ul className="grid gap-1.5">
                  {[...r.desglose.map((d) => ({ ...d, clase: "bg-primary" })), { concepto: "Comisión del chofer", monto: oferta.comision, detalle: `${params.comision_pct} % del precio`, clase: "bg-amber-400" },
                    { concepto: "Ganancia", monto: Math.max(0, oferta.ganancia), detalle: `${oferta.gananciaPct.toFixed(1)} % del precio`, clase: "bg-emerald-500" }].map((d) => (
                    <li key={d.concepto} className="grid gap-0.5">
                      <div className="flex items-baseline justify-between gap-2 text-sm"><span>{d.concepto}</span><span className="font-medium">{mxn(d.monto)}</span></div>
                      <span className="h-2 overflow-hidden rounded-full bg-secondary"><span className={cn("block h-full", d.clase)} style={{ width: `${(d.monto / maximo) * 100}%` }} /></span>
                      <span className="text-[11px] text-muted-foreground">{d.detalle}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="grid content-start gap-4">
                <div className="grid gap-1 text-sm">
                  <h3 className="text-sm font-semibold">A facturar</h3>
                  <p className="flex justify-between"><span>Subtotal</span><b>{mxn(oferta.precio)}</b></p>
                  <p className="flex justify-between"><span>IVA {IVA * 100} %</span><span>{mxn(oferta.iva)}</span></p>
                  <p className="flex justify-between"><span>Retención IVA {RETENCION_IVA * 100} %</span><span>−{mxn(oferta.retencionIva)}</span></p>
                  <p className="flex justify-between border-t pt-1"><span>Total a cobrar</span><b>{mxn(oferta.total)}</b></p>
                </div>
                <div className="grid gap-1 text-sm">
                  <h3 className="text-sm font-semibold">Otros datos</h3>
                  <p className="flex justify-between"><span>Distancia operativa</span><span>{km(r.km)}</span></p>
                  <p className="flex justify-between"><span>Tiempo total con carga y descarga</span><span>{duracionTexto(r.horas * 60)} ({r.dias.toFixed(1)} día)</span></p>
                  <p className="flex justify-between"><span>Diésel</span><span>{r.litros.toFixed(0)} L</span></p>
                  <p className="flex justify-between"><span>Costo base (sin comisión)</span><span>{mxn(r.costoBase)}</span></p>
                  <p className="flex justify-between"><span>Precio por km</span><span>{mxn(oferta.precio / r.km)}</span></p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <h3 className="mb-1 text-sm font-semibold">Precio según la ganancia</h3>
              <table className="w-full min-w-[420px] text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Ganancia</th><th className="py-1 text-right font-medium">Por {etiquetaUnidad}</th><th className="py-1 text-right font-medium">Flete (sin IVA)</th></tr></thead>
                <tbody>
                  {r.escenarios.map((e) => (
                    <tr key={e.gananciaPct} className={cn("border-t", e.gananciaPct === params.ganancia_pct && "bg-primary/10 font-medium")}>
                      <td className="py-1">{e.gananciaPct === 0 ? "0 % (sin pérdida)" : `${e.gananciaPct} %`}</td>
                      <td className="py-1 text-right">{mxn(e.porUnidad)}</td><td className="py-1 text-right">{mxn(e.precio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void guardarCotizacion()} disabled={guardando || !empresaId}>
                  {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {editId ? "Guardar cambios" : "Guardar cotización"}
                </Button>
                {editId && <Button variant="outline" onClick={() => void guardarCotizacion(true)} disabled={guardando}><FilePlus2 className="h-4 w-4" /> Guardar como nueva</Button>}
                <Button variant="outline" onClick={() => documento && setImprimir(documento)}><Printer className="h-4 w-4" /> Vista previa e impresión</Button>
                {(editId || folio) && <Button variant="ghost" onClick={nueva}>Nueva cotización</Button>}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <CotizacionesGuardadas items={historial} editandoId={editId} onEditar={(c) => cargarCotizacion(c)} onDuplicar={(c) => cargarCotizacion(c, true)}
        onImprimir={(c) => setImprimir(documentoDe(c))} onBorrar={(c) => void borrar(c)} onEstado={(c, e) => void cambiarEstado(c, e)} />
      <ImprimirCotizacion doc={imprimir} onClose={() => setImprimir(null)} />
    </div>
  );
}
