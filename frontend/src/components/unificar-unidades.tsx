"use client";

import { useEffect, useState } from "react";
import { Loader2, Merge } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { postBackend } from "@/lib/api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuditoriaEliminaciones } from "@/components/auditoria-eliminaciones";

interface Unidad { id: string; placa: string; marca: string | null; modelo: string | null }
interface Previa {
  placa_duplicado: string; placa_destino: string; viajes: number; facturas: number; servicios: number;
  reglas_bitacora: number; km_a_sumar: number; campos_a_completar: string[];
}
const sel = "h-10 min-w-[12rem] rounded-md border bg-background px-3 text-sm";

/** Unifica una unidad duplicada (por datos erróneos en un XML) con la correcta, sin perder viajes, facturas ni servicios. */
export function UnificarUnidades({ tipo }: { tipo: "tracto" | "gondola" }) {
  const tabla = tipo === "tracto" ? "tractocamiones" : "gondolas";
  const nombre = tipo === "tracto" ? "tracto" : "góndola";
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [origen, setOrigen] = useState("");
  const [destino, setDestino] = useState("");
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    void createClient().from(tabla).select("id, placa, marca, modelo").order("placa").limit(2000)
      .then(({ data }) => setUnidades((data ?? []) as Unidad[]));
  }, [tabla, version]);
  useEffect(() => { setPrevia(null); setError(null); }, [origen, destino]);

  const etiqueta = (u: Unidad) => [u.placa, [u.marca, u.modelo].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  const cuerpo = (extra = {}) => JSON.stringify({ tipo, origen_id: origen, destino_id: destino, ...extra });

  async function verPrevia() {
    setTrabajando(true); setError(null); setOk(null);
    try { setPrevia(await postBackend<Previa>("unidades/unificar-vista-previa", cuerpo(), "application/json")); }
    catch (e) { setError((e as Error).message); } finally { setTrabajando(false); }
  }
  async function unificar() {
    setTrabajando(true); setError(null);
    try {
      await postBackend("unidades/unificar", cuerpo({ confirmar: true }), "application/json");
      setOk(`${previa?.placa_duplicado} quedó unificado con ${previa?.placa_destino}. Sus viajes, facturas y servicios ahora cuentan en ${previa?.placa_destino}.`);
      setOrigen(""); setDestino(""); setPrevia(null); setVersion((v) => v + 1);
    } catch (e) { setError((e as Error).message); } finally { setTrabajando(false); }
  }

  return (
    <div className="grid gap-3">
      <Card className="rounded-xl">
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Merge className="h-4 w-4" />Unificar {nombre}s duplicados</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-xs text-muted-foreground">
            Si un XML trajo placas con datos erróneos y el sistema creó un {nombre} nuevo, elige el duplicado y el correcto. Todo lo del duplicado
            pasa al correcto y la placa errónea se recuerda para que no vuelva a crearse.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs">Duplicado (desaparece)
              <select className={sel} value={origen} onChange={(e) => setOrigen(e.target.value)}>
                <option value="">Elegir…</option>{unidades.filter((u) => u.id !== destino).map((u) => <option key={u.id} value={u.id}>{etiqueta(u)}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs">Correcto (conserva todo)
              <select className={sel} value={destino} onChange={(e) => setDestino(e.target.value)}>
                <option value="">Elegir…</option>{unidades.filter((u) => u.id !== origen).map((u) => <option key={u.id} value={u.id}>{etiqueta(u)}</option>)}
              </select>
            </label>
            <Button variant="outline" disabled={!origen || !destino || trabajando} onClick={verPrevia}>
              {trabajando && !previa && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Ver qué se moverá
            </Button>
          </div>
          {error && <Alert variant="error">{error}</Alert>}
          {ok && <Alert variant="success">{ok}</Alert>}
          {previa && (
            <div className="grid gap-2 rounded-md border p-3 text-sm">
              <p>Se mueve de <b>{previa.placa_duplicado}</b> a <b>{previa.placa_destino}</b>:</p>
              <ul className="grid gap-1">
                <li><b>{previa.viajes}</b> viajes ({previa.facturas} facturas con su Carta Porte)</li>
                <li><b>{previa.servicios}</b> servicios de mantenimiento{tipo === "tracto" ? <> y <b>{previa.reglas_bitacora}</b> registros de la bitácora por intervalo</> : null}</li>
                {tipo === "tracto" && <li><b>{Number(previa.km_a_sumar).toLocaleString("es-MX")}</b> km se suman al kilometraje del tracto correcto</li>}
                <li>Datos que se completan en {previa.placa_destino}: {previa.campos_a_completar.length ? previa.campos_a_completar.join(", ") : "ninguno (ya los tiene)"}</li>
                <li>El registro duplicado se elimina y queda un respaldo en la bitácora de depuración.</li>
              </ul>
              <div className="flex justify-end"><Button variant="destructive" disabled={trabajando} onClick={unificar}>
                {trabajando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar unificación</Button></div>
            </div>
          )}
        </CardContent>
      </Card>
      <AuditoriaEliminaciones acciones={[tipo === "tracto" ? "tracto_unificado" : "gondola_unificada"]} refrescar={version} />
    </div>
  );
}
