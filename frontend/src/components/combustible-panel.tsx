"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { rendimientoPorChofer, type Carga, type RendChofer, type ViajeRend } from "@/lib/combustible";
import type { Chofer, Tracto } from "@/lib/types";
import { fechaMx, km, mxn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const sel = "h-10 rounded-md border bg-background px-3 text-sm";
const PAG = 1000;
const num = (n: number | null, d = 1) => n == null ? "—" : new Intl.NumberFormat("es-MX", { maximumFractionDigits: d }).format(n);
const litros = (n: number) => `${num(n, 2)} L`;

type TractoOp = Pick<Tracto, "id" | "empresa_id" | "placa">;
type ChoferOp = Pick<Chofer, "id" | "nombre"> & { tracto_asignado_id: string | null };

async function todo<T>(q: (d: number, h: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const acum: T[] = [];
  for (let d = 0; ; d += PAG) {
    const { data, error } = await q(d, d + PAG - 1);
    if (error) throw new Error(error.message);
    acum.push(...((data ?? []) as T[]));
    if ((data?.length ?? 0) < PAG) return acum;
  }
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card><CardContent className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </CardContent></Card>
  );
}

export function CombustiblePanel() {
  const [tractos, setTractos] = useState<TractoOp[]>([]);
  const [choferes, setChoferes] = useState<ChoferOp[]>([]);
  const [cargas, setCargas] = useState<Carga[]>([]);
  const [viajes, setViajes] = useState<ViajeRend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [tractoId, setTractoId] = useState("");
  const [editar, setEditar] = useState<Carga | "nueva" | null>(null);

  const load = useCallback(async () => {
    const sb = createClient();
    try {
      const [t, c, cg, v] = await Promise.all([
        todo<TractoOp>((d, h) => sb.from("tractocamiones").select("id, empresa_id, placa").order("placa").range(d, h)),
        todo<ChoferOp>((d, h) => sb.from("choferes").select("id, nombre, tracto_asignado_id").order("nombre").range(d, h)),
        todo<Carga>((d, h) => sb.from("cargas_combustible").select("*").order("fecha", { ascending: false }).order("id").range(d, h)),
        todo<ViajeRend>((d, h) => sb.from("rendimiento_viajes").select("viaje_id, chofer_id, tracto_id, fecha_viaje, km").order("fecha_viaje").order("viaje_id").range(d, h)),
      ]);
      setTractos(t); setChoferes(c); setCargas(cg); setViajes(v); setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const placa = useMemo(() => new Map(tractos.map((t) => [t.id, t.placa])), [tractos]);
  const nombre = useMemo(() => new Map(choferes.map((c) => [c.id, c.nombre])), [choferes]);
  const rangoInvalido = !!desde && !!hasta && desde > hasta;

  const filtradas = useMemo(
    () => cargas.filter((c) => (!tractoId || c.tracto_id === tractoId) && (!desde || c.fecha >= desde) && (!hasta || c.fecha <= hasta)),
    [cargas, tractoId, desde, hasta],
  );
  const asignados = useMemo(
    () => new Map(choferes.filter((c) => c.tracto_asignado_id).map((c) => [c.tracto_asignado_id!, c.id])),
    [choferes],
  );
  const rend = useMemo(() => rendimientoPorChofer(cargas, viajes, desde, hasta, asignados), [cargas, viajes, desde, hasta, asignados]);

  async function borrar(c: Carga) {
    if (!window.confirm(`¿Eliminar la carga de ${litros(c.litros)} del ${fechaMx(c.fecha)} (${placa.get(c.tracto_id) ?? "tracto"})?`)) return;
    const { error: e } = await createClient().from("cargas_combustible").delete().eq("id", c.id);
    if (e) setError(e.message); else void load();
  }

  if (loading) return <p className="text-sm text-muted-foreground">Cargando combustible…</p>;

  const totLitros = filtradas.reduce((s, c) => s + Number(c.litros), 0);
  const totCosto = filtradas.reduce((s, c) => s + Number(c.costo ?? 0), 0);

  return (
    <div className="grid gap-4">
      {error && <ErrorAlert where="combustible" message={error} />}

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
          <div className="grid gap-1.5">
            <Label htmlFor="cb-tracto">Tracto</Label>
            <select id="cb-tracto" className={sel} value={tractoId} onChange={(e) => setTractoId(e.target.value)}>
              <option value="">Todos</option>
              {tractos.map((t) => <option key={t.id} value={t.id}>{t.placa}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cb-desde">Desde</Label>
            <Input id="cb-desde" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cb-hasta">Hasta</Label>
            <Input id="cb-hasta" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={() => setEditar("nueva")} disabled={!tractos.length}><Plus className="h-4 w-4" /> Registrar carga</Button>
          </div>
        </CardContent>
      </Card>
      {rangoInvalido && <Alert variant="error">La fecha inicial es posterior a la final.</Alert>}
      {!tractos.length && <Alert variant="info">No hay tractocamiones. Se crean al procesar el primer XML con Carta Porte o desde Tractos y góndolas.</Alert>}

      <Tabs defaultValue="cargas">
        <TabsList>
          <TabsTrigger value="cargas">Cargas</TabsTrigger>
          <TabsTrigger value="rendimiento">Rendimiento por chofer</TabsTrigger>
          <TabsTrigger value="asignacion">Chofer y tracto</TabsTrigger>
        </TabsList>

        <TabsContent value="cargas" className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi label="Cargas" value={String(filtradas.length)} />
            <Kpi label="Litros de diésel" value={litros(totLitros)} />
            <Kpi label="Costo registrado" value={mxn(totCosto)} />
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tracto</TableHead>
                  <TableHead>Chofer</TableHead>
                  <TableHead className="text-right">Litros</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                  <TableHead className="text-right">Odómetro</TableHead>
                  <TableHead>Estación / notas</TableHead>
                  <TableHead className="w-24" aria-hidden />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtradas.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Sin cargas en el filtro seleccionado.</TableCell></TableRow>
                ) : filtradas.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap">{fechaMx(c.fecha)}</TableCell>
                    <TableCell className="whitespace-nowrap font-medium">{placa.get(c.tracto_id) ?? "—"}</TableCell>
                    <TableCell>{c.chofer_id ? nombre.get(c.chofer_id) ?? "—" : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">{litros(c.litros)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">{c.costo == null ? "—" : mxn(c.costo)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">{c.kilometraje == null ? <span className="text-muted-foreground">sin odómetro</span> : km(c.kilometraje)}</TableCell>
                    <TableCell>{[c.estacion, c.notas].filter(Boolean).join(" · ") || "—"}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" aria-label="Editar carga" onClick={() => setEditar(c)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="sm" aria-label="Eliminar carga" onClick={() => void borrar(c)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="rendimiento" className="grid gap-4">
          <Rendimiento filas={rend} nombre={nombre} placa={placa} />
        </TabsContent>

        <TabsContent value="asignacion">
          <Asignacion choferes={choferes} tractos={tractos} onError={setError} onSaved={load} />
        </TabsContent>
      </Tabs>

      <FormCarga
        carga={editar} tractos={tractos} choferes={choferes} tractoInicial={tractoId}
        onClose={() => setEditar(null)} onSaved={() => { setEditar(null); void load(); }}
      />
    </div>
  );
}

function Asignacion({ choferes, tractos, onError, onSaved }: {
  choferes: ChoferOp[]; tractos: TractoOp[]; onError: (m: string) => void; onSaved: () => Promise<void>;
}) {
  const [guardando, setGuardando] = useState<string | null>(null);
  async function cambiar(c: ChoferOp, tractoId: string) {
    setGuardando(c.id);
    const { error: e } = await createClient().from("choferes").update({ tracto_asignado_id: tractoId || null }).eq("id", c.id);
    if (e) onError(e.code === "23505" ? "Ese tracto ya está asignado a otro chofer; quítaselo primero." : e.message);
    else await onSaved();
    setGuardando(null);
  }
  return (
    <div className="grid gap-3">
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent"><TableHead>Chofer</TableHead><TableHead>Tracto asignado</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {choferes.length === 0 ? (
              <TableRow><TableCell colSpan={2} className="py-8 text-center text-muted-foreground">Aún no hay choferes.</TableCell></TableRow>
            ) : choferes.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.nombre}</TableCell>
                <TableCell>
                  <select aria-label={`Tracto de ${c.nombre}`} className={sel} disabled={guardando === c.id}
                    value={c.tracto_asignado_id ?? ""} onChange={(e) => void cambiar(c, e.target.value)}>
                    <option value="">Sin tracto fijo</option>
                    {tractos.map((t) => <option key={t.id} value={t.id}>{t.placa}</option>)}
                  </select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">Un tracto solo puede tener un chofer asignado. No guarda historial: al reasignar, las cargas pasadas sin chofer capturado se atribuyen al nuevo chofer.</p>
    </div>
  );
}

function Rendimiento({ filas, nombre, placa }: { filas: RendChofer[]; nombre: Map<string, string>; placa: Map<string, string> }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  return (
    <>
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Chofer</TableHead>
              <TableHead className="text-right">Cargas</TableHead>
              <TableHead className="text-right">Litros</TableHead>
              <TableHead className="text-right">km/l (odómetro)</TableHead>
              <TableHead className="text-right">km/l (Carta Porte)</TableHead>
              <TableHead className="text-right">Viajes</TableHead>
              <TableHead className="text-right">Litros por viaje</TableHead>
              <TableHead className="text-right">Viajes por carga</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Sin cargas en el rango seleccionado.</TableCell></TableRow>
            ) : filas.map((r) => {
              const id = r.choferId ?? "sin";
              return (
                <FilaRend key={id} r={r} abierto={abierto === id} onToggle={() => setAbierto(abierto === id ? null : id)}
                  etiqueta={r.choferId ? nombre.get(r.choferId) ?? "—" : "Sin chofer"} placa={placa} />
              );
            })}
          </TableBody>
        </Table>
      </Card>
      <div className="grid gap-1 text-xs text-muted-foreground">
        <p><b>km/l (odómetro)</b>: kilómetros del odómetro entre dos cargas consecutivas del mismo tracto ÷ litros de la carga que cierra el tramo (se asume tanque lleno en cada carga).</p>
        <p><b>km/l (Carta Porte)</b>: km (redondo) de los viajes del tracto con fecha de salida entre ambas cargas ÷ los mismos litros; es referencia, no cuenta viajes vacíos ni fechas del mismo día.</p>
        <p>Las cargas sin odómetro cuentan en litros, costo y litros por viaje, pero no en km/l. La carga sin chofer se atribuye al chofer asignado al tracto (pestaña «Chofer y tracto»); si no hay, al del último viaje de ese tracto a su fecha; si tampoco, va en «Sin chofer». Solo se cuentan viajes de choferes con cargas en el rango; facturas canceladas excluidas.</p>
      </div>
    </>
  );
}

function FilaRend({ r, abierto, onToggle, etiqueta, placa }: { r: RendChofer; abierto: boolean; onToggle: () => void; etiqueta: string; placa: Map<string, string> }) {
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell className="font-medium">
          {etiqueta}
          {r.cargasSinOdometro > 0 && <span className="block text-xs font-normal text-amber-600">{r.cargasSinOdometro} carga(s) sin odómetro, fuera del km/l</span>}
        </TableCell>
        <TableCell className="text-right">{r.cargas}</TableCell>
        <TableCell className="whitespace-nowrap text-right">{litros(r.litros)}</TableCell>
        <TableCell className="whitespace-nowrap text-right font-semibold">{r.kmPorLitro == null ? <span className="font-normal text-muted-foreground">sin datos</span> : num(r.kmPorLitro, 2)}</TableCell>
        <TableCell className="whitespace-nowrap text-right">{num(r.kmPorLitroCp, 2)}</TableCell>
        <TableCell className="text-right">{r.choferId ? r.viajes : "—"}</TableCell>
        <TableCell className="whitespace-nowrap text-right">{r.litrosPorViaje == null ? "—" : litros(r.litrosPorViaje)}</TableCell>
        <TableCell className="text-right">{num(r.viajesPorCarga, 2)}</TableCell>
      </TableRow>
      {abierto && (
        <TableRow className="bg-secondary/40 hover:bg-secondary/40">
          <TableCell colSpan={8}>
            {r.tramos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin tramos calculables: se necesitan al menos dos cargas del mismo tracto con odómetro.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Tracto</TableHead><TableHead>Tramo</TableHead>
                    <TableHead className="text-right">km odómetro</TableHead><TableHead className="text-right">km Carta Porte</TableHead>
                    <TableHead className="text-right">Litros</TableHead><TableHead className="text-right">km/l</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.tramos.map((t, i) => (
                    <TableRow key={i}>
                      <TableCell>{placa.get(t.tractoId) ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{fechaMx(t.desde)} → {fechaMx(t.hasta)}</TableCell>
                      <TableCell className="text-right">{km(t.kmOdometro)}</TableCell>
                      <TableCell className="text-right">{km(t.kmCartaPorte)}</TableCell>
                      <TableCell className="text-right">{litros(t.litros)}</TableCell>
                      <TableCell className="text-right font-medium">{num(t.kmOdometro / t.litros, 2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function FormCarga({
  carga, tractos, choferes, tractoInicial, onClose, onSaved,
}: {
  carga: Carga | "nueva" | null; tractos: TractoOp[]; choferes: ChoferOp[]; tractoInicial: string;
  onClose: () => void; onSaved: () => void;
}) {
  const vacio = { tracto: "", chofer: "", fecha: "", litros: "", costo: "", odo: "", estacion: "", notas: "" };
  const [f, setF] = useState(vacio);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof vacio) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  useEffect(() => {
    if (!carga) return;
    setError(null);
    setF(carga === "nueva"
      ? { ...vacio, tracto: tractoInicial, fecha: new Date().toISOString().slice(0, 10) }
      : { tracto: carga.tracto_id, chofer: carga.chofer_id ?? "", fecha: carga.fecha, litros: String(carga.litros), costo: carga.costo == null ? "" : String(carga.costo),
          odo: carga.kilometraje == null ? "" : String(carga.kilometraje), estacion: carga.estacion ?? "", notas: carga.notas ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carga]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const tracto = tractos.find((t) => t.id === f.tracto);
    if (!tracto) return setError("Selecciona un tracto");
    const l = Number(f.litros);
    if (!Number.isFinite(l) || l <= 0) return setError("Los litros deben ser mayores a 0");
    const costo = f.costo === "" ? null : Number(f.costo);
    if (costo != null && (!Number.isFinite(costo) || costo < 0)) return setError("Costo inválido");
    const odo = f.odo === "" ? null : Number(f.odo);
    if (odo != null && (!Number.isFinite(odo) || odo < 0)) return setError("Odómetro inválido");
    setSaving(true);
    const payload = {
      empresa_id: tracto.empresa_id, tracto_id: tracto.id, chofer_id: f.chofer || null, fecha: f.fecha,
      litros: l, costo, kilometraje: odo, estacion: f.estacion.trim() || null, notas: f.notas.trim() || null,
    };
    const sb = createClient();
    const { error: err } = carga && carga !== "nueva"
      ? await sb.from("cargas_combustible").update(payload).eq("id", carga.id)
      : await sb.from("cargas_combustible").insert(payload);
    setSaving(false);
    if (err) setError(err.message); else onSaved();
  }

  return (
    <Dialog open={!!carga} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <div>
          <DialogTitle className="text-lg font-semibold">{carga === "nueva" ? "Registrar carga de combustible" : "Editar carga"}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">Diésel en litros. Costo y odómetro son opcionales; sin odómetro la carga no entra al km/l.</DialogDescription>
        </div>
        <form onSubmit={onSubmit} className="grid gap-4">
          {error && <ErrorAlert where="combustible-form" message={error} />}
          <div className="grid gap-2">
            <Label htmlFor="cf-tracto">Tracto</Label>
            <select id="cf-tracto" required className={sel} value={f.tracto} onChange={set("tracto")}>
              <option value="">Selecciona…</option>
              {tractos.map((t) => <option key={t.id} value={t.id}>{t.placa}</option>)}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cf-chofer">Chofer (opcional)</Label>
            <select id="cf-chofer" className={sel} value={f.chofer} onChange={set("chofer")}>
              <option value="">Usar el chofer asignado al tracto</option>
              {choferes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2"><Label htmlFor="cf-fecha">Fecha</Label><Input id="cf-fecha" type="date" required value={f.fecha} onChange={set("fecha")} /></div>
            <div className="grid gap-2"><Label htmlFor="cf-litros">Litros</Label><Input id="cf-litros" type="number" min={0.01} step="0.01" required value={f.litros} onChange={set("litros")} /></div>
            <div className="grid gap-2"><Label htmlFor="cf-costo">Costo MXN (opcional)</Label><Input id="cf-costo" type="number" min={0} step="0.01" value={f.costo} onChange={set("costo")} /></div>
            <div className="grid gap-2"><Label htmlFor="cf-odo">Odómetro km (opcional)</Label><Input id="cf-odo" type="number" min={0} step="0.1" value={f.odo} onChange={set("odo")} /></div>
          </div>
          <div className="grid gap-2"><Label htmlFor="cf-est">Estación</Label><Input id="cf-est" value={f.estacion} onChange={set("estacion")} /></div>
          <div className="grid gap-2"><Label htmlFor="cf-notas">Notas</Label><Input id="cf-notas" value={f.notas} onChange={set("notas")} /></div>
          <Button type="submit" disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
