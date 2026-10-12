"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { descargarXml } from "@/lib/descarga";
import { createClient } from "@/lib/supabase/client";
import { ApiError, postBackend } from "@/lib/api";
import { ubicacionLabel } from "@/lib/format";
import type { Factura, FacturaSat } from "@/lib/types";
import { fechaMx, mxn } from "@/lib/utils";
import { ErrorAlert } from "@/components/error-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const UUID_RE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SONDEO_MS = 5000;
const ABANDONADA_MS = 20 * 60 * 1000;

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? "break-all font-mono text-sm" : "text-sm font-medium"}>{value || "—"}</dd>
    </div>
  );
}

const num = (v: string | null | undefined) => (v == null || v === "" ? null : Number(v));
const fechaHora = (iso: string) => new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export function FacturaModal({ factura, onClose }: { factura: Factura | null; onClose: () => void }) {
  const [sat, setSat] = useState<FacturaSat | null>(null);
  const [cargado, setCargado] = useState(false);
  const [pidiendo, setPidiendo] = useState(false);
  const [error, setError] = useState<{ where: string; message: string; status?: number; path?: string } | null>(null);
  const idActual = useRef<string | null>(null);

  const leer = useCallback(async (id: string) => {
    const { data, error: err } = await createClient().from("facturas_sat").select("*").eq("factura_id", id).maybeSingle();
    if (idActual.current !== id) return null;
    if (err) { setError({ where: "facturas-sat", message: err.message }); return null; }
    setSat((data as FacturaSat | null) ?? null);
    setCargado(true);
    return (data as FacturaSat | null) ?? null;
  }, []);

  const pedir = useCallback(async (id: string, forzar: boolean) => {
    setPidiendo(true);
    setError(null);
    try {
      await postBackend(`facturas/${id}/sat`, JSON.stringify({ forzar }), "application/json");
      await leer(id);
    } catch (e) {
      setError({ where: "facturas-sat", message: e instanceof Error ? e.message : "No se pudo consultar el SAT", status: e instanceof ApiError ? e.status : undefined, path: e instanceof ApiError ? e.path : undefined });
    } finally {
      setPidiendo(false);
    }
  }, [leer]);

  // Al abrir: lee lo que ya hay; solo si nunca se consultó al SAT lo pide automáticamente.
  useEffect(() => {
    setSat(null); setCargado(false); setError(null);
    idActual.current = factura?.id ?? null;
    if (!factura) return;
    void (async () => {
      const previo = await leer(factura.id);
      if (idActual.current === factura.id && !previo && factura.uuid && UUID_RE.test(factura.uuid)) void pedir(factura.id, false);
    })();
  }, [factura, leer, pedir]);

  // Mientras el SAT procesa la solicitud se consulta el estado cada pocos segundos.
  const pendiente = sat?.estado === "pendiente";
  useEffect(() => {
    if (!factura || !pendiente) return;
    const t = setInterval(() => void leer(factura.id), SONDEO_MS);
    return () => clearInterval(t);
  }, [factura, pendiente, leer]);

  const abandonada = pendiente && sat && Date.now() - new Date(sat.updated_at).getTime() > ABANDONADA_MS;
  const enCurso = pidiendo || (pendiente && !abandonada);
  const uuidValido = !!factura?.uuid && UUID_RE.test(factura.uuid);
  const d = sat?.datos ?? null;
  const cp = d?.carta_porte ?? null;

  return (
    <Dialog open={!!factura} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        {factura && (
          <>
            <div className="pr-6">
              <DialogTitle className="text-lg font-semibold">Factura {factura.folio}</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {factura.fecha_emision ? fechaMx(factura.fecha_emision) : "Sin fecha de emisión"}
              </DialogDescription>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-secondary/40 px-3 py-2 text-xs">
              <span className="flex items-center gap-2">
                {enCurso ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando al SAT, puede tardar unos minutos…</>
                ) : sat?.actualizado_en ? (
                  <>Datos del SAT <Badge variant="verde">actualizados</Badge> {fechaHora(sat.actualizado_en)}</>
                ) : (
                  <>Sin datos del SAT todavía</>
                )}
              </span>
              {sat?.xml && (
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs"
                  onClick={() => descargarXml(factura.uuid ?? factura.folio, sat.xml!)}>
                  <Download className="mr-1 h-3 w-3" /> Descargar XML
                </Button>
              )}
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={enCurso || !uuidValido}
                onClick={() => void pedir(factura.id, true)} title="Volver a descargar el CFDI desde el SAT">
                <RefreshCw className="mr-1 h-3 w-3" /> Actualizar desde SAT
              </Button>
            </div>

            {!uuidValido && (
              <p className="text-sm text-muted-foreground">Esta factura no tiene un folio fiscal (UUID) válido en el Excel, así que no se puede consultar al SAT.</p>
            )}
            {error && <ErrorAlert where={error.where} message={error.message} status={error.status} path={error.path} />}
            {sat?.estado === "error" && <ErrorAlert where="facturas-sat" message={sat.error ?? "El SAT no devolvió el CFDI"} />}
            {abandonada && <p className="text-sm text-muted-foreground">La consulta anterior no terminó. Usa «Actualizar desde SAT» para reintentar.</p>}

            <Tabs defaultValue="factura">
              <TabsList>
                <TabsTrigger value="factura">Factura</TabsTrigger>
                <TabsTrigger value="carta">Carta Porte</TabsTrigger>
              </TabsList>

              <TabsContent value="factura">
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2"><Field label="Folio fiscal (UUID)" value={factura.uuid} mono /></div>
                  <Field label="Estado" value={factura.estado} />
                  <Field label="Total (Excel)" value={mxn(factura.total)} />
                  <Field label="Orden de compra" value={factura.orden_compra} />
                  <Field label="Pago" value={factura.fecha_pago ? fechaMx(factura.fecha_pago) : null} />
                  {d && (
                    <>
                      <Field label="Emisor" value={[d.emisor.nombre, d.emisor.rfc].filter(Boolean).join(" · ")} />
                      <Field label="Receptor" value={[d.receptor.nombre, d.receptor.rfc].filter(Boolean).join(" · ")} />
                      <Field label="Serie y folio" value={[d.serie, d.folio].filter(Boolean).join(" ")} />
                      <Field label="Timbrado" value={d.fecha_timbrado ? fechaHora(d.fecha_timbrado) : null} />
                      <Field label="Subtotal" value={num(d.subtotal) != null ? mxn(num(d.subtotal)) : null} />
                      <Field label="Total (SAT)" value={num(d.total) != null ? <>{mxn(num(d.total))} {d.moneda}</> : null} />
                    </>
                  )}
                </dl>
                {d && d.conceptos.length > 0 && (
                  <div className="mt-4 grid gap-1">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conceptos</h4>
                    <ul className="divide-y rounded-md border text-sm">
                      {d.conceptos.map((c, i) => (
                        <li key={i} className="flex justify-between gap-3 px-3 py-2">
                          <span>{c.cantidad} × {c.descripcion}</span>
                          <span className="whitespace-nowrap">{num(c.importe) != null ? mxn(num(c.importe)) : "—"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="carta">
                {!d ? (
                  <p className="text-sm text-muted-foreground">{enCurso ? "Esperando la respuesta del SAT…" : "Aún no hay datos del SAT para mostrar la Carta Porte."}</p>
                ) : !cp ? (
                  <p className="text-sm text-muted-foreground">Este CFDI no incluye complemento Carta Porte.</p>
                ) : (
                  <div className="grid gap-4">
                    <dl className="grid gap-4 sm:grid-cols-2">
                      <Field label="Versión" value={cp.version} />
                      <Field label="Distancia total" value={cp.total_dist_rec ? `${cp.total_dist_rec} km` : null} />
                      <div className="sm:col-span-2"><Field label="IdCCP" value={cp.id_ccp} mono /></div>
                      <Field label="Placa tractocamión" value={cp.vehiculo.placa} />
                      <Field label="Configuración vehicular" value={cp.vehiculo.config} />
                      <Field label="Remolques" value={cp.remolques.map((r) => r.placa).filter(Boolean).join(", ")} />
                      <Field label="Peso bruto total" value={cp.peso_bruto_total ? `${cp.peso_bruto_total} kg` : null} />
                    </dl>
                    <Lista titulo="Ubicaciones" items={cp.ubicaciones.map((u) =>
                      `${u.tipo}: ${ubicacionLabel({ id: "", id_ubicacion: u.id ?? "", nombre: u.nombre, municipio: u.municipio, estado: u.estado })}${u.distancia ? ` · ${u.distancia} km` : ""}`)} />
                    <Lista titulo="Mercancías" items={cp.mercancias.map((m) => `${m.cantidad} × ${m.descripcion}${m.peso_kg ? ` · ${m.peso_kg} kg` : ""}`)} />
                    <Lista titulo="Figuras de transporte" items={cp.figuras.map((f) => `${f.nombre} (${f.rfc})${f.licencia ? ` · Lic. ${f.licencia}` : ""}`)} />
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Lista({ titulo, items }: { titulo: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="grid gap-1">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h4>
      <ul className="divide-y rounded-md border text-sm">{items.map((t, i) => <li key={i} className="px-3 py-2">{t}</li>)}</ul>
    </div>
  );
}
