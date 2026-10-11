"use client";

import type { Viaje } from "@/lib/types";
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

export function ViajeModal({ viaje, onClose }: { viaje: Viaje | null; onClose: () => void }) {
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
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Field label="Origen" value={ubicacionLabel(viaje.origen)} />
                  <Field label="Destino" value={ubicacionLabel(viaje.destino)} />
                  <Field label="Placa tractocamión" value={viaje.tracto?.placa} />
                  <Field label="Placa góndola" value={viaje.gondola?.placa} />
                  <Field label="Chofer" value={viaje.chofer?.nombre} />
                  <Field label="Licencia" value={viaje.chofer?.licencia} />
                  <Field label="Distancia oficial (XML, ida)" value={km(viaje.distancia_xml)} />
                  <Field label="Distancia operativa (redondo)" value={km(viaje.distancia_operativa)} />
                </dl>
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
