"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { postBackend } from "@/lib/api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface Previa {
  facturas: number; canceladas: number; no_canceladas: number; pagadas: number; con_orden: number;
  con_xml: number; viajes: number; km_a_restar: number; folios: string[];
}

/** Confirmación para eliminar facturas: muestra qué se borra (viajes, XML, km) y exige escribir ELIMINAR. */
export function EliminarFacturas({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: (mensaje: string) => void }) {
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [motivo, setMotivo] = useState("");
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const abierto = ids.length > 0;

  useEffect(() => {
    setPrevia(null); setError(null); setTexto(""); setMotivo("");
    if (ids.length === 0) return;
    postBackend<Previa>("facturas/eliminar-vista-previa", JSON.stringify({ ids }), "application/json")
      .then(setPrevia).catch((e: Error) => setError(e.message));
  }, [ids]);

  async function eliminar() {
    setTrabajando(true); setError(null);
    try {
      const r = await postBackend<{ facturas: number; viajes: number; xml: number }>(
        "facturas/eliminar", JSON.stringify({ ids, motivo: motivo.trim() || null, confirmar: true }), "application/json");
      onDone(`${r.facturas} facturas eliminadas (${r.viajes} viajes y ${r.xml} XML). El respaldo quedó en la bitácora de depuración.`);
    } catch (e) { setError((e as Error).message); } finally { setTrabajando(false); }
  }

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && !trabajando && onClose()}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">Eliminar {ids.length} {ids.length === 1 ? "factura" : "facturas"}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">Revisa lo que se va a borrar antes de confirmar.</DialogDescription>
        {error && <Alert variant="error">{error}</Alert>}
        {!previa && !error && <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Calculando…</p>}
        {previa && (
          <div className="grid gap-3 text-sm">
            <ul className="grid gap-1">
              <li>Facturas: <b>{previa.facturas}</b> ({previa.canceladas} canceladas, {previa.no_canceladas} no canceladas{previa.pagadas ? `, ${previa.pagadas} pagadas` : ""})</li>
              <li>Viajes (Carta Porte) que se borran con ellas: <b>{previa.viajes}</b> — se restan <b>{Number(previa.km_a_restar).toLocaleString("es-MX")}</b> km a sus tractos</li>
              <li>XML guardados que se borran: <b>{previa.con_xml}</b></li>
              {previa.con_orden > 0 && <li>{previa.con_orden} están ligadas a una orden de compra (la orden no se borra)</li>}
              <li className="text-muted-foreground">Folios: {previa.folios.join(", ")}{previa.facturas > previa.folios.length ? "…" : ""}</li>
            </ul>
            {previa.no_canceladas > 0 && (
              <Alert variant="error">Incluye {previa.no_canceladas} facturas que NO están canceladas. Los ingresos del dashboard bajarán.</Alert>
            )}
            <p className="text-xs text-muted-foreground">Se guarda un respaldo completo (factura, XML y viaje) en la bitácora de depuración.</p>
            <Input placeholder="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
            <Input placeholder="Escribe ELIMINAR para confirmar" value={texto} onChange={(e) => setTexto(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={trabajando}>Cancelar</Button>
              <Button variant="destructive" disabled={texto.trim().toUpperCase() !== "ELIMINAR" || trabajando || previa.facturas === 0} onClick={eliminar}>
                {trabajando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Eliminar definitivamente
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
