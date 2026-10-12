"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ApiError, postBackend } from "@/lib/api";
import type { Lugar, Viaje, ViajeSobrepeso } from "@/lib/types";
import { Alert } from "@/components/ui/alert";
import { fechaMx, km, mxn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ubicacionLabel } from "@/lib/format";

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? "break-all font-mono text-sm" : "text-sm font-medium"}>{value || "—"}</dd>
    </div>
  );
}

const sel = "h-10 w-full rounded-md border bg-background px-3 text-sm";

export function ViajeModal({ viaje, onClose, onChanged }: { viaje: Viaje | null; onClose: () => void; onChanged?: () => void }) {
  const [lugares, setLugares] = useState<Lugar[]>([]);
  const [origen, setOrigen] = useState("");
  const [destino, setDestino] = useState("");
  const [kmIda, setKmIda] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sobrepeso, setSobrepeso] = useState<ViajeSobrepeso | null>(null);

  useEffect(() => {
    if (!viaje) return;
    setOrigen(viaje.lugar_origen_id ?? ""); setDestino(viaje.lugar_destino_id ?? "");
    setKmIda(viaje.distancia_mapa_km != null ? Number(viaje.distancia_mapa_km) : null); setError(null);
    setSobrepeso(null);
    void createClient().from("viajes_sobrepeso").select("*").eq("viaje_id", viaje.id).limit(1)
      .then(({ data }) => setSobrepeso(((data ?? [])[0] as ViajeSobrepeso | undefined) ?? null));
    void createClient().from("lugares").select("*").eq("activo", true).order("nombre").then(({ data }) => setLugares((data ?? []) as Lugar[]));
  }, [viaje]);

  async function asignar(o: string, d: string) {
    if (!viaje) return;
    setOrigen(o); setDestino(d); setSaving(true); setError(null);
    try {
      const r = await postBackend<{ distancia_km: number | null }>(`viajes/${viaje.id}/lugares`,
        JSON.stringify({ origen_id: o || null, destino_id: d || null }), "application/json");
      setKmIda(r.distancia_km);
      onChanged?.();
    } catch (e) { setError((e as ApiError).message); } finally { setSaving(false); }
  }

  return (
    <Dialog open={!!viaje} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {viaje && (
          <>
            <div>
              <DialogTitle className="text-lg font-semibold">Viaje {viaje.folio_factura ?? ""}</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">{fechaMx(viaje.fecha)}</DialogDescription>
            </div>
            <Tabs defaultValue="logistica">
              <TabsList>
                <TabsTrigger value="logistica">Logística</TabsTrigger>
                <TabsTrigger value="fiscal">Fiscal</TabsTrigger>
              </TabsList>

              <TabsContent value="logistica">
                {sobrepeso && (
                  <Alert variant="error" className="mb-3">
                    Posible sobrepeso: {Number(sobrepeso.toneladas_facturadas).toLocaleString("es-MX")} t facturadas contra una capacidad de{" "}
                    {(Number(sobrepeso.capacidad_kg) / 1000).toLocaleString("es-MX")} t del tracto (excede {Number(sobrepeso.exceso_kg).toLocaleString("es-MX")} kg).
                  </Alert>
                )}
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Field label="Origen" value={ubicacionLabel(viaje.origen)} />
                  <Field label="Destino" value={ubicacionLabel(viaje.destino)} />
                  <Field label="Placa tractocamión" value={viaje.tracto?.placa} />
                  <Field label="Placa góndola" value={viaje.gondola?.placa} />
                  <Field label="Chofer" value={viaje.chofer?.nombre} />
                  <Field label="Licencia" value={viaje.chofer?.licencia} />
                  <Field label="Mercancía" value={viaje.mercancia} />
                  <Field label="Toneladas facturadas" value={viaje.toneladas_facturadas != null ? `${Number(viaje.toneladas_facturadas).toLocaleString("es-MX")} t${viaje.precio_tonelada != null ? ` × ${mxn(Number(viaje.precio_tonelada))}` : ""}` : null} />
                  <Field label="Salida" value={viaje.fecha_salida ? fechaMx(viaje.fecha_salida) : null} />
                  <Field label="Llegada" value={viaje.fecha_llegada ? fechaMx(viaje.fecha_llegada) : null} />
                  <Field label="Distancia oficial (XML, ida)" value={km(viaje.distancia_xml)} />
                  <Field label="Distancia operativa (redondo)" value={km(viaje.distancia_operativa)} />
                </dl>
                <div className="mt-4 grid gap-3 rounded-md border p-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Km operativos por mapa</h4>
                  {error && <Alert variant="error">{error}</Alert>}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs font-medium">Origen
                      <select className={sel} value={origen} disabled={saving} onChange={(e) => void asignar(e.target.value, destino)}>
                        <option value="">Sin asignar</option>{lugares.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                      </select></label>
                    <label className="grid gap-1 text-xs font-medium">Destino
                      <select className={sel} value={destino} disabled={saving} onChange={(e) => void asignar(origen, e.target.value)}>
                        <option value="">Sin asignar</option>{lugares.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                      </select></label>
                  </div>
                  {(() => {
                    const p = lugares.find((l) => l.id === destino)?.precio_tonelada;
                    return p != null ? <p className="text-sm">Precio por tonelada del destino (referencia): <b>{mxn(Number(p))}</b></p> : null;
                  })()}
                  <p className="flex items-center gap-2 text-sm">
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    {kmIda != null ? <>Ida {km(kmIda)} · <b>km operativos (redondo) {km(kmIda * 2)}</b></> : "Asigna origen y destino ubicados en el mapa para calcular los km."}
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="fiscal">
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2"><Field label="UUID" value={viaje.uuid} mono /></div>
                  <Field label="RFC emisor" value={viaje.rfc_emisor} mono />
                  <Field label="RFC receptor" value={viaje.rfc_receptor} mono />
                  <Field label="Subtotal" value={mxn(viaje.subtotal)} />
                  <Field label="Total" value={mxn(viaje.total)} />
                </dl>
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
