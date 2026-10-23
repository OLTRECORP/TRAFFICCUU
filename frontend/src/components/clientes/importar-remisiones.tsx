"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { ApiError, postBackend } from "@/lib/api";
import type { Cliente } from "@/lib/types";
import { mxn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert } from "@/components/error-alert";
import { Label } from "@/components/ui/label";

interface Mapeo { excel: string; accion: "existente" | "variante" | "parecido" | "nuevo" }
interface Resultado {
  confirmado: boolean; cliente: { id: string; nombre: string; creado: boolean };
  filas: number; validos: number; nuevos: number; ya_importados: number; quitados_a_mano?: number; semanas: number; desde: string | null; hasta: string | null;
  subtotal_nuevos: number; tarifas: number; omitidas: { fila: number; motivo: string }[];
  lugares: (Mapeo & { lugar: string; usos: string[] })[]; choferes: (Mapeo & { chofer: string })[];
  unidades: { tipo: string; placa: string }[]; nuevos_catalogo: Record<string, number>;
  avisos: Record<string, Record<string, string | number | null>[]>; facturas_ligadas?: { folio: string; semana: string; viajes: number }[];
}

const ACCION: Record<Mapeo["accion"], { texto: string; variant: "verde" | "amarillo" | "rojo" | "default" }> = {
  existente: { texto: "ya existe", variant: "verde" },
  variante: { texto: "otra escritura", variant: "verde" },
  parecido: { texto: "parecido: revisar", variant: "amarillo" },
  nuevo: { texto: "nuevo", variant: "default" },
};

const AVISOS: Record<string, string> = {
  fecha_fuera_de_secuencia: "Fechas fuera de secuencia (¿año mal capturado?)",
  precio_distinto_tarifa: "Precio acordado distinto a la hoja PRECIOS (se respeta el precio de cada viaje)",
  sin_tarifa: "Rutas sin tarifa en la hoja PRECIOS (se usa el precio de cada viaje)",
  remision_repetida: "Mismo folio de remisión en más de un renglón",
  origen_deducido: "Origen vacío deducido de la tarifa",
  subtotal_distinto: "Subtotal distinto a cantidad × precio",
};
// Solo informativos: la tarifa puede cambiar por acuerdo y cada viaje conserva su precio.
const INFORMATIVOS = new Set(["precio_distinto_tarifa", "sin_tarifa"]);

const sel = "h-10 w-full rounded-md border bg-background px-3 text-sm";

/** Sube el Excel de remisiones (hojas PRECIOS y VIAJES): primero muestra la vista previa y luego importa. */
export function ImportarRemisiones({ clientes, onDone }: { clientes: Cliente[]; onDone: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [clienteId, setClienteId] = useState("");
  const [res, setRes] = useState<Resultado | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  async function enviar(confirmar: boolean, f = archivo) {
    if (!f) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      if (clienteId) fd.append("cliente_id", clienteId);
      fd.append("confirmar", String(confirmar));
      const r = await postBackend<Resultado>("remisiones/importar", fd);
      setRes(r);
      if (confirmar) onDone();
    } catch (e) { setError(e as ApiError); } finally { setBusy(false); }
  }

  const cambios = res ? [...res.lugares.filter((l) => l.accion !== "existente")] : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Importar viajes desde Excel de remisiones</CardTitle>
        <p className="text-sm text-muted-foreground">
          Hojas <b>PRECIOS</b> (origen, destino, precio, unidad) y <b>VIAJES</b> (fecha, origen, destino, remisión, material, operador,
          placas, cantidad, unidad, precio unitario, subtotal). Cada renglón es un viaje. Primero verás la vista previa; nada se guarda hasta confirmar.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="rem-cliente">Cliente</Label>
            <select id="rem-cliente" className={sel} value={clienteId} onChange={(e) => { setClienteId(e.target.value); setRes(null); }}>
              <option value="">Pétreos La Purísima (se crea si no existe)</option>
              {clientes.filter((c) => c.factura_semanal).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div>
            <input ref={ref} type="file" accept=".xlsx,.xlsm" hidden onChange={(e) => {
              const f = e.target.files?.[0] ?? null; setArchivo(f); setRes(null); if (f) void enviar(false, f); e.target.value = "";
            }} />
            <Button type="button" variant="outline" onClick={() => ref.current?.click()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              {archivo ? "Elegir otro Excel" : "Elegir Excel"}
            </Button>
          </div>
        </div>
        {error && <ErrorAlert where="importar-remisiones" message={error.message} status={error.status} path={error.path} />}

        {res && (
          <div className="grid gap-4">
            {res.confirmado ? (
              <Alert variant="success">
                Importados {res.nuevos} viajes de {res.cliente.nombre} ({res.ya_importados} ya estaban{res.quitados_a_mano ? `, ${res.quitados_a_mano} se quitaron a mano y se respetaron` : ""}).{" "}
                {res.facturas_ligadas?.length ? `${res.facturas_ligadas.length} factura(s) semanal(es) ligadas por monto.` : ""}{" "}
                Marca en el mapa la ubicación de los orígenes y destinos nuevos (Orígenes y destinos) para calcular sus km.
              </Alert>
            ) : (
              <Alert variant="info">Vista previa de <b>{archivo?.name}</b>: revisa los nombres ligados y los avisos antes de importar.</Alert>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Dato label="Viajes nuevos" value={String(res.nuevos)} />
              <Dato label="Ya importados" value={String(res.ya_importados)} />
              <Dato label={`Semanas (${res.desde ?? ""} – ${res.hasta ?? ""})`} value={String(res.semanas)} />
              <Dato label="Subtotal nuevo" value={mxn(res.subtotal_nuevos)} />
            </div>

            {cambios.length > 0 && (
              <Bloque titulo={`Orígenes y destinos (${res.lugares.length}; ${res.nuevos_catalogo.lugares ?? 0} nuevos)`}>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">En el Excel</th><th>Se liga a</th><th /></tr></thead>
                  <tbody>{cambios.map((l) => (
                    <tr key={l.excel} className="border-t"><td className="py-1.5">{l.excel}</td><td>{l.lugar}</td>
                      <td className="text-right"><Badge variant={ACCION[l.accion].variant}>{ACCION[l.accion].texto}</Badge></td></tr>
                  ))}</tbody>
                </table>
              </Bloque>
            )}
            <Bloque titulo={`Choferes (${res.choferes.length}; ${res.nuevos_catalogo.choferes ?? 0} nuevos sin RFC)`}>
              <table className="w-full text-sm"><tbody>{res.choferes.map((c) => (
                <tr key={c.excel} className="border-t"><td className="py-1.5">{c.excel}</td><td>{c.excel !== c.chofer ? c.chofer : ""}</td>
                  <td className="text-right"><Badge variant={ACCION[c.accion].variant}>{ACCION[c.accion].texto}</Badge></td></tr>
              ))}</tbody></table>
            </Bloque>
            {res.unidades.length > 0 && (
              <Bloque titulo={`Unidades nuevas (${res.unidades.length})`}>
                <p className="text-sm">{res.unidades.map((u) => `${u.tipo === "tracto" ? "Tracto" : "Góndola"} ${u.placa}`).join(" · ")}</p>
              </Bloque>
            )}
            {Object.entries(res.avisos).map(([k, lista]) => (
              <Bloque key={k} titulo={`${AVISOS[k] ?? k} (${lista.length})`} aviso={!INFORMATIVOS.has(k)}>
                <ul className="grid gap-1 text-sm">
                  {lista.slice(0, 30).map((a, i) => <li key={i}>{Object.entries(a).map(([kk, vv]) => `${kk}: ${vv ?? "—"}`).join(" · ")}</li>)}
                  {lista.length > 30 && <li className="text-muted-foreground">… y {lista.length - 30} más</li>}
                </ul>
              </Bloque>
            ))}
            {res.omitidas.length > 0 && (
              <Bloque titulo={`Renglones omitidos (${res.omitidas.length})`} aviso>
                <ul className="text-sm">{res.omitidas.map((o) => <li key={o.fila}>Fila {o.fila}: {o.motivo}</li>)}</ul>
              </Bloque>
            )}
            {!res.confirmado && (
              <div>
                <Button onClick={() => void enviar(true)} disabled={busy || res.nuevos === 0}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {res.nuevos ? `Importar ${res.nuevos} viajes` : "No hay viajes nuevos"}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/60 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold leading-tight">{value}</p>
    </div>
  );
}

function Bloque({ titulo, aviso, children }: { titulo: string; aviso?: boolean; children: React.ReactNode }) {
  return (
    <details className={`rounded-lg border px-3 py-2 ${aviso ? "border-amber-300 dark:border-amber-800" : ""}`}>
      <summary className="cursor-pointer text-sm font-medium">{titulo}</summary>
      <div className="mt-2 max-h-72 overflow-y-auto">{children}</div>
    </details>
  );
}
