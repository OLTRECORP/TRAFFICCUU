"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { calcularAlertas, peorNivel, type Alerta, type Nivel } from "@/lib/mantenimiento";
import type { Bitacora, Regla, Tracto } from "@/lib/types";
import { cn, km } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
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

export function MantenimientoPanel() {
  const [tractos, setTractos] = useState<Tracto[]>([]);
  const [reglas, setReglas] = useState<Regla[]>([]);
  const [bitacora, setBitacora] = useState<Bitacora[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registro, setRegistro] = useState<{ tracto: Tracto; regla: Regla } | null>(null);

  const load = useCallback(async () => {
    const sb = createClient();
    const [t, r, b] = await Promise.all([
      sb.from("tractocamiones").select("*").order("placa"),
      sb.from("reglas_mantenimiento").select("*").order("tipo_servicio"),
      sb.from("bitacora_mantenimiento").select("*"),
    ]);
    const err = t.error ?? r.error ?? b.error;
    if (err) setError(err.message);
    else {
      setTractos((t.data ?? []) as Tracto[]);
      setReglas((r.data ?? []) as Regla[]);
      setBitacora((b.data ?? []) as Bitacora[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filas = useMemo(
    () => tractos.map((t) => ({ tracto: t, alertas: calcularAlertas(t, reglas, bitacora) })),
    [tractos, reglas, bitacora],
  );

  if (loading) return <p className="text-sm text-muted-foreground">Calculando alertas…</p>;
  if (error) return <Alert variant="error">{error}</Alert>;
  if (!tractos.length)
    return <Alert variant="info">No hay tractocamiones. Se crean automáticamente al procesar el primer XML con Carta Porte.</Alert>;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {filas.map(({ tracto, alertas }) => (
        <Card key={tracto.id}>
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>{tracto.placa}</CardTitle>
              <p className="text-sm text-muted-foreground">Odómetro: {km(tracto.kilometraje_actual)}</p>
            </div>
            <Semaforo nivel={peorNivel(alertas)} />
          </CardHeader>
          <CardContent className="grid gap-4">
            {alertas.map((a) => (
              <AlertaRow key={a.regla.id} a={a} onRegistrar={() => setRegistro({ tracto, regla: a.regla })} />
            ))}
          </CardContent>
        </Card>
      ))}
      <RegistrarServicio registro={registro} onClose={() => setRegistro(null)} onSaved={() => { setRegistro(null); load(); }} />
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
          {error && <Alert variant="error">{error}</Alert>}
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
