"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Loader2, Merge } from "lucide-react";
import { ApiError, postBackend } from "@/lib/api";
import type { Cliente } from "@/lib/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ErrorAlert } from "@/components/error-alert";
import { Label } from "@/components/ui/label";

interface ClienteCorto { id: string; nombre: string; rfc: string | null; viajes: number }
interface Vista {
  nombre_duplicado: string; nombre_destino: string; viajes: number; facturas: number; tarifas: number; tarifas_repetidas: number;
  lugares: number; alias_nuevos: string[]; rfc_duplicado: string | null; rfc_destino: string | null; rfc_distinto: boolean;
  comision: [number, number]; km_por_mapa: [boolean, boolean]; factura_semanal: [boolean, boolean]; viajes_km_cambian: number;
}

const sel = "h-10 w-full rounded-md border bg-background px-3 text-sm";
const siNo = (b: boolean) => (b ? "sí" : "no");

/** Une un cliente duplicado al que se conserva: viajes, tarifas, nombre como alias y RFC; con vista previa. */
export function UnificarClientes({ clientes, onDone }: { clientes: Cliente[]; onDone: () => void }) {
  const [pares, setPares] = useState<{ conservar: ClienteCorto; duplicado: ClienteCorto }[]>([]);
  const [dup, setDup] = useState("");
  const [dst, setDst] = useState("");
  const [vista, setVista] = useState<Vista | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  const sugerir = useCallback(async () => {
    try {
      setPares((await postBackend<{ pares: { conservar: ClienteCorto; duplicado: ClienteCorto }[] }>("clientes/similares", "{}", "application/json")).pares);
    } catch (e) { setError(e as ApiError); }
  }, []);
  useEffect(() => { void sugerir(); }, [sugerir, clientes.length]);

  async function previa(origen: string, destino: string) {
    setDup(origen); setDst(destino); setError(null); setHecho(null); setBusy(true);
    try {
      setVista(await postBackend<Vista>("clientes/unificar-vista-previa", JSON.stringify({ origen_id: origen, destino_id: destino }), "application/json"));
    } catch (e) { setError(e as ApiError); } finally { setBusy(false); }
  }

  async function confirmar() {
    if (!vista) return;
    setBusy(true); setError(null);
    try {
      await postBackend("clientes/unificar", JSON.stringify({ origen_id: dup, destino_id: dst, confirmar: true }), "application/json");
      setHecho(`«${vista.nombre_duplicado}» quedó unido a «${vista.nombre_destino}»: ${vista.viajes} viajes y ${vista.tarifas - vista.tarifas_repetidas} tarifas movidos.`);
      setVista(null); setDup(""); setDst("");
      onDone(); void sugerir();
    } catch (e) { setError(e as ApiError); } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Unificar clientes</CardTitle>
        <p className="text-sm text-muted-foreground">
          Si el mismo cliente aparece con nombres distintos (con o sin «SA de CV», abreviado o mal escrito), únelos: sus viajes y tarifas pasan al
          que conservas y el otro nombre queda como alias para que los XML y Excel futuros lo reconozcan.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4">
        {error && <ErrorAlert where="unificar-clientes" message={error.message} status={error.status} path={error.path} />}
        {hecho && <Alert variant="success">{hecho}</Alert>}

        {pares.length > 0 ? (
          <div className="grid gap-2">
            <p className="text-sm font-medium">Parecen el mismo cliente ({pares.length})</p>
            {pares.map(({ conservar, duplicado }) => (
              <div key={`${duplicado.id}-${conservar.id}`} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <span className="min-w-0"><b>{duplicado.nombre}</b> <span className="text-muted-foreground">({duplicado.viajes} viajes)</span></span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1"><b>{conservar.nombre}</b> <span className="text-muted-foreground">({conservar.viajes} viajes)</span></span>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void previa(duplicado.id, conservar.id)}>Unir así</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void previa(conservar.id, duplicado.id)}>Al revés</Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No hay clientes con nombre parecido. También puedes elegirlos a mano.</p>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="uc-dup">Duplicado (desaparece)</Label>
            <select id="uc-dup" className={sel} value={dup} onChange={(e) => setDup(e.target.value)}>
              <option value="">Elegir…</option>
              {clientes.filter((c) => c.id !== dst).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <ArrowRight className="mb-3 hidden h-4 w-4 text-muted-foreground sm:block" />
          <div className="grid gap-1.5">
            <Label htmlFor="uc-dst">Se conserva</Label>
            <select id="uc-dst" className={sel} value={dst} onChange={(e) => setDst(e.target.value)}>
              <option value="">Elegir…</option>
              {clientes.filter((c) => c.id !== dup).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <Button disabled={busy || !dup || !dst} onClick={() => void previa(dup, dst)}>
            {busy && !vista ? <Loader2 className="h-4 w-4 animate-spin" /> : <Merge className="h-4 w-4" />} Revisar
          </Button>
        </div>
      </CardContent>

      <Dialog open={!!vista} onOpenChange={(o) => !o && setVista(null)}>
        <DialogContent className="max-w-lg">
          {vista && (
            <>
              <div className="pr-6">
                <DialogTitle className="text-lg font-semibold">Unificar clientes</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  «{vista.nombre_duplicado}» se une a «{vista.nombre_destino}» y desaparece. Queda respaldo en la auditoría.
                </DialogDescription>
              </div>
              <ul className="grid gap-1.5 text-sm">
                <li><b>{vista.viajes}</b> viajes ({vista.facturas} facturas) pasan a «{vista.nombre_destino}»</li>
                <li><b>{vista.tarifas - vista.tarifas_repetidas}</b> tarifas pasan{vista.tarifas_repetidas > 0 && <>; {vista.tarifas_repetidas} de rutas que ya tiene «{vista.nombre_destino}» se descartan (se queda su precio)</>}</li>
                {vista.lugares > 0 && <li>{vista.lugares} orígenes/destinos cambian de cliente</li>}
                {vista.alias_nuevos.length > 0 && <li>Nuevos alias: {vista.alias_nuevos.join(", ")}</li>}
                {!vista.rfc_destino && vista.rfc_duplicado && <li>Se completa el RFC: {vista.rfc_duplicado}</li>}
              </ul>
              {(vista.comision[0] !== vista.comision[1] || vista.km_por_mapa[0] !== vista.km_por_mapa[1] || vista.factura_semanal[0] !== vista.factura_semanal[1]) && (
                <Alert variant="info">
                  Sus viajes toman la configuración de «{vista.nombre_destino}»:
                  {vista.comision[0] !== vista.comision[1] && <> comisión {Number(vista.comision[0])} % → {Number(vista.comision[1])} %.</>}
                  {vista.km_por_mapa[0] !== vista.km_por_mapa[1] && <> Km por mapa {siNo(vista.km_por_mapa[0])} → {siNo(vista.km_por_mapa[1])} ({vista.viajes_km_cambian} viajes cambian sus km y el odómetro de su tracto se ajusta).</>}
                  {vista.factura_semanal[0] !== vista.factura_semanal[1] && <> Factura semanal {siNo(vista.factura_semanal[0])} → {siNo(vista.factura_semanal[1])}.</>}
                </Alert>
              )}
              {vista.rfc_distinto && (
                <Alert variant="error">Tienen RFC distinto ({vista.rfc_duplicado} y {vista.rfc_destino}): probablemente son empresas diferentes. Se conservará {vista.rfc_destino}.</Alert>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setVista(null)} disabled={busy}>Cancelar</Button>
                <Button onClick={() => void confirmar()} disabled={busy}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />} Unificar
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
