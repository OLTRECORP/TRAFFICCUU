"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloudDownload, FileArchive, Loader2, Square, Stethoscope, Workflow } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ApiError, postBackend } from "@/lib/api";
import type { FacturaXmlMes, SatDescarga } from "@/lib/types";
import { ErrorAlert } from "@/components/error-alert";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const SONDEO_MS = 3000;
const LATIDO_MAX_MS = 5 * 60_000;   // sin señales de vida de la corrida en este tiempo = interrumpida
const ZIP_MAX_BYTES = 4 * 1024 * 1024;   // límite de Vercel para el cuerpo de la petición
const MESES_LARGO = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const sel = "h-10 rounded-md border bg-background px-3 text-sm";

/** Descarga masiva de los XML de las facturas emitidas (y sus complementos de pago) desde el SAT. */
export function DescargaMasiva({ onDone }: { onDone: () => void }) {
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [modo, setModo] = useState<"faltantes" | "anio">("faltantes");
  const [mes, setMes] = useState(0);            // 0 = según el modo (faltantes / todo el año)
  const [clienteId, setClienteId] = useState("");   // "" = todos los clientes
  const [clientes, setClientes] = useState<{ id: string; nombre: string; rfc: string | null }[]>([]);
  const [meses, setMeses] = useState<FacturaXmlMes[]>([]);
  const [corrida, setCorrida] = useState<SatDescarga | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [error, setError] = useState<{ message: string; status?: number; path?: string } | null>(null);
  const [diag, setDiag] = useState<{ ok: boolean; pasos: { paso: string; ok: boolean; detalle: string }[] } | null>(null);
  const [probando, setProbando] = useState(false);
  const [deteniendo, setDeteniendo] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const zipRef = useRef<HTMLInputElement>(null);

  const leer = useCallback(async () => {
    const sb = createClient();
    const [m, c, cl] = await Promise.all([
      sb.from("facturas_xml_por_mes").select("anio, mes, total, con_xml").eq("anio", anio).order("mes"),
      sb.from("sat_descargas").select("*").order("created_at", { ascending: false }).limit(1),
      sb.from("clientes").select("id, nombre, rfc").order("nombre"),
    ]);
    if (m.error || c.error || cl.error) { setError({ message: (m.error ?? c.error ?? cl.error)!.message }); return null; }
    setClientes((cl.data ?? []) as { id: string; nombre: string; rfc: string | null }[]);
    setMeses((m.data ?? []) as FacturaXmlMes[]);
    const ultima = ((c.data ?? [])[0] as SatDescarga | undefined) ?? null;
    setCorrida(ultima);
    return ultima;
  }, [anio]);
  useEffect(() => { void leer(); }, [leer]);

  const enCurso = !!corrida && (corrida.estado === "pendiente" || corrida.estado === "en_proceso");
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 15_000); return () => clearInterval(t); }, []);
  const interrumpida = enCurso && ahora - new Date(corrida!.updated_at).getTime() > LATIDO_MAX_MS;
  const activa = enCurso && !interrumpida;

  // Mientras corre, se mantiene despierto el servidor (el plan gratuito de Render se duerme sin visitas y mata el proceso).
  useEffect(() => {
    if (!activa) return;
    const t = setInterval(() => { void fetch("/api/health").catch(() => undefined); }, 60_000);
    return () => clearInterval(t);
  }, [activa]);
  useEffect(() => {
    if (!activa) return;
    const t = setInterval(() => void leer().then((c) => { if (c && c.estado !== "en_proceso" && c.estado !== "pendiente") onDone(); }), SONDEO_MS);
    return () => clearInterval(t);
  }, [activa, leer, onDone]);

  const faltantes = useMemo(() => meses.filter((m) => m.con_xml < m.total), [meses]);
  const totalFalta = faltantes.reduce((a, m) => a + (m.total - m.con_xml), 0);

  async function probar() {
    setProbando(true); setError(null); setDiag(null);
    try { setDiag(await postBackend("sat/diagnostico", "{}", "application/json")); }
    catch (e) { const a = e as ApiError; setError({ message: a.message, status: a.status, path: a.path }); }
    finally { setProbando(false); }
  }

  async function detener() {
    setDeteniendo(true); setError(null);
    try { await postBackend("sat/descarga-masiva/cancelar", "{}", "application/json"); await leer(); }
    catch (e) { const a = e as ApiError; setError({ message: a.message, status: a.status, path: a.path }); }
    finally { setDeteniendo(false); }
  }

  async function subirZip(files: FileList | null) {
    const f = files?.[0];
    if (zipRef.current) zipRef.current.value = "";
    if (!f) return;
    if (f.size > ZIP_MAX_BYTES) return setError({ message: `El .zip pesa ${(f.size / 1048576).toFixed(1)} MB; el máximo es 4 MB. Divídelo en varios .zip.` });
    setSubiendo(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      await postBackend("xml/subir-zip", fd);
      await leer();
    } catch (e) { const a = e as ApiError; setError({ message: a.message, status: a.status, path: a.path }); }
    finally { setSubiendo(false); }
  }

  async function iniciar(m: "faltantes" | "anio" | "reprocesar" = modo) {
    setPidiendo(true); setError(null);
    try {
      await postBackend("sat/descarga-masiva", JSON.stringify({ anio, modo: m, ...(m !== "reprocesar" && mes ? { mes } : {}), ...(m !== "reprocesar" && clienteId ? { cliente_id: clienteId } : {}) }), "application/json");
      await leer();
    } catch (e) {
      const a = e as ApiError;
      setError({ message: a.message, status: a.status, path: a.path });
    } finally { setPidiendo(false); }
  }

  const anios = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
  const porMes = new Map(meses.map((m) => [m.mes, m]));

  return (
    <Card className="rounded-xl">
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm text-primary dark:text-foreground">
        <CloudDownload className="h-4 w-4" /> Descargar XML del SAT
      </CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-xs text-muted-foreground">
          Baja los CFDI emitidos y los asigna a cada factura por UUID (o por folio y total si la factura no tiene UUID).
          Los complementos de pago se ligan a las facturas y órdenes de compra que cubren.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select className={sel} value={anio} onChange={(e) => setAnio(Number(e.target.value))} aria-label="Año">
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className={sel} value={mes} onChange={(e) => setMes(Number(e.target.value))} aria-label="Mes">
            <option value={0}>Todos los meses</option>
            {MESES_LARGO.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
          </select>
          <select className={sel} value={clienteId} onChange={(e) => setClienteId(e.target.value)} aria-label="Cliente"
            title="Pide al SAT solo las facturas emitidas a ese cliente (por su RFC)">
            <option value="">Todos los clientes</option>
            {clientes.map((c) => <option key={c.id} value={c.id} disabled={!c.rfc}>{c.nombre}{c.rfc ? "" : " (sin RFC)"}</option>)}
          </select>
          {!mes && (
            <select className={sel} value={modo} onChange={(e) => setModo(e.target.value as "faltantes" | "anio")} aria-label="Meses a descargar">
              <option value="faltantes">Solo meses con XML faltante</option>
              <option value="anio">Todo el año</option>
            </select>
          )}
          <Button onClick={() => void iniciar()} disabled={pidiendo || activa || (!mes && modo === "faltantes" && faltantes.length === 0)}>
            {pidiendo || activa ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
            {activa ? "Descargando…" : "Descargar XML"}
          </Button>
          <input ref={zipRef} type="file" accept=".zip" hidden onChange={(e) => void subirZip(e.target.files)} />
          <Button variant="outline" onClick={() => zipRef.current?.click()} disabled={subiendo || activa}
            title="Sube varios XML a la vez; se asignan a sus facturas igual que los del SAT (máx. 4 MB)">
            {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />} Subir XML (.zip)
          </Button>
          <Button variant="outline" onClick={() => void probar()} disabled={probando} title="Revisa tablas, FIEL y autenticación con el SAT">
            {probando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />} Probar conexión
          </Button>
          <Button variant="outline" onClick={() => void iniciar("reprocesar")} disabled={pidiendo || activa}
            title="Sin consultar al SAT: registra viajes, choferes, tractos, góndolas, orígenes y destinos de los XML ya guardados">
            <Workflow className="h-4 w-4" /> Procesar Carta Porte de XML guardados
          </Button>
          <span className="text-xs text-muted-foreground">
            {meses.length === 0 ? `Sin facturas con fecha de emisión en ${anio}` : totalFalta ? `${totalFalta} facturas sin XML en ${faltantes.length} mes(es)` : "Todas las facturas del año tienen XML"}
          </span>
        </div>

        <div className="grid grid-cols-6 gap-1.5 text-center text-xs sm:grid-cols-12" aria-label="XML por mes">
          {MESES.map((nombre, i) => {
            const m = porMes.get(i + 1);
            const completo = !!m && m.con_xml >= m.total;
            return (
              <div key={nombre} className="rounded-md border px-1 py-1.5" title={m ? `${m.con_xml} de ${m.total} facturas con XML` : "Sin facturas"}>
                <p className="font-medium">{nombre}</p>
                <p className={m ? (completo ? "text-emerald-600" : "text-amber-600") : "text-muted-foreground"}>{m ? `${m.con_xml}/${m.total}` : "—"}</p>
              </div>
            );
          })}
        </div>

        {diag && (
          <div className="grid gap-1 rounded-md border p-3 text-xs" role="status">
            <p className="font-semibold">{diag.ok ? "Conexión con el SAT lista" : "La conexión con el SAT falla"}</p>
            {diag.pasos.map((p) => (
              <p key={p.paso} className={p.ok ? "text-emerald-600" : "text-destructive"}>{p.ok ? "✓" : "✗"} {p.paso}: {p.detalle}</p>
            ))}
          </div>
        )}
        {error && <ErrorAlert where="descarga-masiva" message={error.message} status={error.status} path={error.path} />}
        {enCurso && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
            {interrumpida
              ? <span>El proceso dejó de responder (el servidor se reinició o se durmió). Lo ya asignado se conservó.</span>
              : <span className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Proceso en curso. Puedes detenerlo cuando quieras.</span>}
            <Button size="sm" variant="outline" className="ml-auto h-7 px-2 text-xs" disabled={deteniendo} onClick={() => void detener()}>
              {deteniendo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />} {interrumpida ? "Marcar como detenido" : "Detener"}
            </Button>
          </div>
        )}
        {corrida && <Resultado c={corrida} activa={activa} interrumpida={interrumpida} />}
      </CardContent>
    </Card>
  );
}

function Resultado({ c, activa, interrumpida }: { c: SatDescarga; activa: boolean; interrumpida: boolean }) {
  const hechos = c.detalle.length;
  return (
    <div className="grid gap-2 rounded-md border bg-secondary/40 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{c.modo === "reprocesar" ? "Último proceso de Carta Porte" : c.modo === "zip" ? "Último .zip subido" : `Última descarga · ${c.anio}`}</span>
        <Badge variant={c.estado === "ok" ? "verde" : c.estado === "error" ? "rojo" : "amarillo"}>
          {c.estado === "ok" ? "Terminada" : c.estado === "error" ? "Con error" : c.estado === "cancelado" ? "Detenida"
            : activa ? (c.meses.length ? `En proceso (${hechos}/${c.meses.length} meses)` : "En proceso") : interrumpida ? "Interrumpida" : "Interrumpida"}
        </Badge>
        <span>{c.xml_recibidos} XML · {c.facturas_asignadas} facturas asignadas · {c.complementos} complementos de pago · {c.viajes} viajes de Carta Porte</span>
      </div>
      {c.error && <Alert variant="error">{c.error}</Alert>}
      {c.detalle.filter((d) => d.estado === "error").map((d) => (
        <p key={d.mes} className="text-destructive">Mes {d.mes}: {d.mensaje}</p>
      ))}
      <Bitacora lineas={c.bitacora ?? []} abierta={activa || c.estado === "error" || c.estado === "cancelado" || c.modo === "zip"} />
      {c.sin_asignar.length > 0 && (
        <details>
          <summary className="cursor-pointer font-medium">{c.sin_asignar.length} XML sin factura (revisar)</summary>
          <ul className="mt-1 divide-y rounded-md border bg-card">
            {c.sin_asignar.map((s) => (
              <li key={s.uuid} className="flex flex-wrap justify-between gap-2 px-2 py-1">
                <span className="font-mono">{s.uuid}</span><span>{s.folio} · {s.fecha} · {s.total}</span><span className="text-muted-foreground">{s.motivo}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const COLOR = { info: "text-muted-foreground", ok: "text-emerald-600", aviso: "text-amber-600", error: "text-destructive" } as const;

/** Registro en vivo del proceso (se actualiza mientras corre). Se abre solo si está en curso o hubo error. */
function Bitacora({ lineas, abierta }: { lineas: SatDescarga["bitacora"]; abierta: boolean }) {
  if (!lineas.length) return <p className="text-muted-foreground">Sin registro: esta descarga se hizo antes de existir la bitácora.</p>;
  const hora = (t: string) => new Intl.DateTimeFormat("es-MX", { timeStyle: "medium" }).format(new Date(t));
  return (
    <details open={abierta}>
      <summary className="cursor-pointer font-medium">Registro del proceso ({lineas.length} líneas)</summary>
      <div className="mt-1 max-h-72 overflow-y-auto rounded-md border bg-card p-2 font-mono text-[11px] leading-5" aria-live="polite">
        {lineas.map((l, i) => (
          <p key={i} className={COLOR[l.n] ?? COLOR.info}><span className="opacity-60">{hora(l.t)}</span> {l.m}</p>
        ))}
      </div>
    </details>
  );
}
