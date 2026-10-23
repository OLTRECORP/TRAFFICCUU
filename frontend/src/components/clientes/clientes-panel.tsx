"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Cliente, Tarifa } from "@/lib/types";
import { cn, mxn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert } from "@/components/error-alert";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImportarRemisiones } from "./importar-remisiones";
import { SemanasCliente } from "./semanas-cliente";
import { ViajesCliente } from "./viajes-cliente";
import { UnificarClientes } from "./unificar-clientes";

const num = "h-8 w-20 rounded-md border bg-background px-2 text-right text-sm";

export function ClientesPanel() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState("");

  const cargar = useCallback(async () => {
    const { data, error: e } = await createClient().from("clientes").select("*").order("nombre");
    if (e) setError(e.message);
    else {
      const filas = (data ?? []) as Cliente[];
      setClientes(filas);
      setSel((s) => s ?? filas.find((c) => c.factura_semanal)?.id ?? null);
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  async function guardar(id: string, cambios: Partial<Cliente>) {
    setError(null);
    setClientes((cs) => cs.map((c) => (c.id === id ? { ...c, ...cambios } : c)));
    const { error: e } = await createClient().from("clientes").update(cambios).eq("id", id);
    if (e) { setError(e.message); void cargar(); }
  }

  async function crear() {
    const nombre = nuevo.trim().toUpperCase();
    if (!nombre) return;
    const sb = createClient();
    const { data: emp } = await sb.from("empresa_configuracion").select("id").maybeSingle();
    const { data, error: e } = await sb.from("clientes").insert({ empresa_id: emp?.id, nombre }).select("*").single();
    if (e) { setError(e.message); return; }
    setNuevo(""); setClientes((cs) => [...cs, data as Cliente].sort((a, b) => a.nombre.localeCompare(b.nombre))); setSel((data as Cliente).id);
  }

  const actual = clientes.find((c) => c.id === sel) ?? null;

  return (
    <div className="grid gap-4">
      {error && <ErrorAlert where="clientes" message={error} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clientes</CardTitle>
          <p className="text-sm text-muted-foreground">
            <b>Comisión</b>: % del subtotal de cada viaje para el chofer (una ruta puede tener su propia tasa en Tarifas).{" "}
            <b>Km por mapa</b>: los km de sus viajes salen de la distancia calculada con el mapa (ida × 2) en vez de la Carta Porte; suman al odómetro del tracto.{" "}
            <b>Factura semanal</b>: una factura agrupa todos sus viajes de lunes a domingo.
          </p>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Cliente</TableHead><TableHead className="text-right">Comisión %</TableHead>
              <TableHead className="text-center">Km por mapa</TableHead><TableHead className="text-center">Factura semanal</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {clientes.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Aún no hay clientes. Se crean solos con los XML y al importar remisiones.</TableCell></TableRow>
            ) : clientes.map((c) => (
              <TableRow key={c.id} className={cn("cursor-pointer", c.id === sel && "bg-secondary/70")} onClick={() => setSel(c.id)}>
                <TableCell>
                  <span className="font-medium">{c.nombre}</span>
                  <span className="block text-xs text-muted-foreground">{c.rfc ?? "RFC sin capturar"}{c.alias?.length ? ` · también: ${c.alias.join(", ")}` : ""}</span>
                </TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <input type="number" min={0} max={100} step={0.5} className={num} defaultValue={c.comision_pct} key={`${c.id}-${c.comision_pct}`}
                    aria-label={`Comisión de ${c.nombre}`}
                    onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0 && v <= 100 && v !== Number(c.comision_pct)) void guardar(c.id, { comision_pct: v }); }} />
                </TableCell>
                <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={c.km_por_mapa} aria-label={`Km por mapa de ${c.nombre}`}
                    onChange={(e) => void guardar(c.id, { km_por_mapa: e.target.checked })} />
                </TableCell>
                <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={c.factura_semanal} aria-label={`Factura semanal de ${c.nombre}`}
                    onChange={(e) => void guardar(c.id, { factura_semanal: e.target.checked })} />
                </TableCell>
                <TableCell className="text-right">{c.id === sel ? <Badge>Seleccionado</Badge> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <CardContent className="flex gap-2 pt-4">
          <Input placeholder="Nuevo cliente (nombre)" value={nuevo} onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void crear()} className="max-w-sm" />
          <Button variant="outline" onClick={() => void crear()} disabled={!nuevo.trim()}><Plus className="h-4 w-4" /> Agregar</Button>
        </CardContent>
      </Card>

      <ImportarRemisiones clientes={clientes} onDone={() => void cargar()} />

      <UnificarClientes clientes={clientes} onDone={() => { setSel(null); void cargar(); }} />

      {actual && (
        <Card>
          <CardHeader><CardTitle className="text-base">{actual.nombre}</CardTitle></CardHeader>
          <CardContent>
            <Tabs defaultValue={actual.factura_semanal ? "semanas" : "tarifas"} key={actual.id}>
              <TabsList>
                {actual.factura_semanal && <TabsTrigger value="semanas">Semanas y facturas</TabsTrigger>}
                <TabsTrigger value="viajes">Viajes</TabsTrigger>
                <TabsTrigger value="tarifas">Tarifas y comisión por ruta</TabsTrigger>
                <TabsTrigger value="datos">Datos</TabsTrigger>
              </TabsList>
              {actual.factura_semanal && <TabsContent value="semanas"><SemanasCliente cliente={actual} /></TabsContent>}
              <TabsContent value="viajes"><ViajesCliente cliente={actual} /></TabsContent>
              <TabsContent value="tarifas"><Tarifas cliente={actual} /></TabsContent>
              <TabsContent value="datos"><Datos cliente={actual} onGuardar={(c) => guardar(actual.id, c)} /></TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Tarifas({ cliente }: { cliente: Cliente }) {
  const [tarifas, setTarifas] = useState<Tarifa[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    const { data, error: e } = await createClient().from("tarifas")
      .select("*, origen:lugares!origen_id(nombre), destino:lugares!destino_id(nombre)").eq("cliente_id", cliente.id);
    if (e) setError(e.message);
    else setTarifas(((data ?? []) as unknown as Tarifa[]).sort((a, b) => `${a.origen?.nombre}${a.destino?.nombre}`.localeCompare(`${b.origen?.nombre}${b.destino?.nombre}`)));
  }, [cliente.id]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function guardar(id: string, cambios: Partial<Tarifa>) {
    const { error: e } = await createClient().from("tarifas").update(cambios).eq("id", id);
    if (e) setError(e.message);
    void cargar();
  }

  if (!tarifas.length) return <Alert variant="info">Sin tarifas. Se cargan de la hoja PRECIOS al importar el Excel de remisiones.</Alert>;
  return (
    <div className="grid gap-2">
      {error && <ErrorAlert where="tarifas" message={error} />}
      <p className="text-sm text-muted-foreground">Comisión de la ruta vacía = la del cliente ({Number(cliente.comision_pct)} %). El cambio aplica a todos los viajes de esa ruta, también a los ya registrados.</p>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Origen</TableHead><TableHead>Destino</TableHead><TableHead className="text-right">Precio</TableHead>
            <TableHead>Unidad</TableHead><TableHead className="text-right">Comisión de la ruta %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tarifas.map((t) => (
            <TableRow key={t.id}>
              <TableCell>{t.origen?.nombre ?? "—"}</TableCell>
              <TableCell>{t.destino?.nombre ?? "—"}</TableCell>
              <TableCell className="whitespace-nowrap text-right">{mxn(Number(t.precio))}</TableCell>
              <TableCell>{t.unidad}</TableCell>
              <TableCell className="text-right">
                <input type="number" min={0} max={100} step={0.5} className={num} placeholder={String(Number(cliente.comision_pct))}
                  defaultValue={t.comision_pct ?? ""} key={`${t.id}-${t.comision_pct}`} aria-label={`Comisión de la ruta ${t.origen?.nombre} a ${t.destino?.nombre}`}
                  onBlur={(e) => {
                    const v = e.target.value.trim() === "" ? null : Number(e.target.value);
                    if (v !== (t.comision_pct == null ? null : Number(t.comision_pct)) && (v == null || (v >= 0 && v <= 100))) void guardar(t.id, { comision_pct: v });
                  }} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Datos({ cliente, onGuardar }: { cliente: Cliente; onGuardar: (c: Partial<Cliente>) => void }) {
  const [rfc, setRfc] = useState(cliente.rfc ?? "");
  const [alias, setAlias] = useState((cliente.alias ?? []).join(", "));
  useEffect(() => { setRfc(cliente.rfc ?? ""); setAlias((cliente.alias ?? []).join(", ")); }, [cliente]);
  return (
    <div className="grid max-w-xl gap-3">
      <label className="grid gap-1 text-sm font-medium">RFC (receptor de sus facturas)
        <Input value={rfc} maxLength={13} onChange={(e) => setRfc(e.target.value.toUpperCase())} placeholder="Se aprende solo de su primera factura ligada" />
      </label>
      <label className="grid gap-1 text-sm font-medium">Otros nombres (separados por coma)
        <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Ej. LA PURISIMA, PURISIMA" />
        <span className="text-xs font-normal text-muted-foreground">Sirven para reconocer sus facturas por el nombre del receptor y sus viajes por el destinatario de la Carta Porte.</span>
      </label>
      <div>
        <Button onClick={() => onGuardar({ rfc: rfc.trim() || null, alias: alias.split(",").map((a) => a.trim().toUpperCase()).filter(Boolean) })}>Guardar</Button>
      </div>
    </div>
  );
}
