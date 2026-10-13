"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fechaMx } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Campos, aPayload, aValores, nivelVigencia, type Campo, type Valores } from "@/components/ficha-campos";
import { FichaServicios } from "@/components/ficha-servicios";
import { FichaViajes, type Relacion } from "@/components/ficha-viajes";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Fila = { id: string; codigo: string; activo: boolean; [k: string]: unknown };

export interface CatalogoConfig {
  tabla: "choferes" | "tractocamiones" | "gondolas";
  relacion: Relacion;
  singular: string;                      // "chofer", "tracto"...
  campos: Campo[];                       // formulario (sin codigo ni activo)
  columnas: { label: string; render: (f: Fila) => ReactNode }[];
  buscar: string[];                      // columnas para el filtro de texto
  orden: string;
  vigencias?: { key: string; label: string }[];   // se muestran con semáforo en el detalle
  detalle: { label: string; key: string }[];
  bitacora?: "tracto" | "gondola";       // muestra la bitácora de mantenimiento en la ficha
  extra?: Campo[];                       // campos solo al crear (ej. kilometraje inicial)
}

const ESTADO_VIG = { rojo: "Vencida", amarillo: "Por vencer", verde: "Vigente" } as const;

export function Vigencia({ fecha }: { fecha: unknown }) {
  const f = typeof fecha === "string" ? fecha : null;
  const nivel = nivelVigencia(f);
  if (!f || !nivel) return <span className="text-muted-foreground">—</span>;
  return <span className="inline-flex items-center gap-2 whitespace-nowrap">{fechaMx(f)} <Badge variant={nivel}>{ESTADO_VIG[nivel]}</Badge></span>;
}

export function CatalogoPanel({ cfg }: { cfg: CatalogoConfig }) {
  const [rows, setRows] = useState<Fila[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [editar, setEditar] = useState<Fila | "nuevo" | null>(null);
  const [ver, setVer] = useState<Fila | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await createClient().from(cfg.tabla).select("*").order(cfg.orden);
    if (err) setError(err.message); else { setError(null); setRows((data ?? []) as Fila[]); }
    setLoading(false);
  }, [cfg.tabla, cfg.orden]);
  useEffect(() => { void load(); }, [load]);

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => [r.codigo, ...cfg.buscar.map((k) => r[k])].some((v) => String(v ?? "").toLowerCase().includes(t)));
  }, [rows, q, cfg.buscar]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder={`Buscar ${cfg.singular} o ID`} value={q} onChange={(e) => setQ(e.target.value)} />
        <Button className="ml-auto" onClick={() => setEditar("nuevo")}><Plus className="h-4 w-4" /> Agregar {cfg.singular}</Button>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      <Card className="rounded-xl">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>ID</TableHead>
              {cfg.columnas.map((c) => <TableHead key={c.label}>{c.label}</TableHead>)}
              <TableHead>Estatus</TableHead><TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={cfg.columnas.length + 3} className="py-10 text-center text-muted-foreground">Cargando…</TableCell></TableRow>
            ) : filtradas.length === 0 ? (
              <TableRow><TableCell colSpan={cfg.columnas.length + 3} className="py-10 text-center text-muted-foreground">
                {rows.length ? "Sin resultados." : `Aún no hay registros. Agrega uno o procesa un XML con Carta Porte.`}
              </TableCell></TableRow>
            ) : filtradas.map((f) => (
              <TableRow key={f.id} className="cursor-pointer border-0 even:bg-secondary/70" onClick={() => setVer(f)}>
                <TableCell className="whitespace-nowrap font-mono font-medium">{f.codigo}</TableCell>
                {cfg.columnas.map((c) => <TableCell key={c.label}>{c.render(f)}</TableCell>)}
                <TableCell><Badge variant={f.activo ? "verde" : "default"}>{f.activo ? "Activo" : "Inactivo"}</Badge></TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => setEditar(f)}><Pencil className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="border-t px-4 py-3 text-xs">{filtradas.length} de {rows.length} registros</div>
      </Card>

      <Formulario cfg={cfg} editar={editar} onClose={() => setEditar(null)} onSaved={() => { setEditar(null); setVer(null); void load(); }} />

      <Dialog open={!!ver} onOpenChange={(o) => !o && setVer(null)}>
        <DialogContent className="max-w-2xl">
          {ver && (
            <>
              <div>
                <DialogTitle className="text-lg font-semibold"><span className="font-mono">{ver.codigo}</span> · {cfg.columnas[0].render(ver)}</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">Ficha de {cfg.singular}</DialogDescription>
              </div>
              <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                {cfg.detalle.map((d) => (
                  <div key={d.key}>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">{d.label}</dt>
                    <dd>{cfg.vigencias?.some((v) => v.key === d.key) ? <Vigencia fecha={ver[d.key]} /> : String(ver[d.key] ?? "—")}</dd>
                  </div>
                ))}
              </dl>
              {cfg.bitacora && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Bitácora de mantenimiento</h3>
                  <FichaServicios tipo={cfg.bitacora} unidadId={ver.id} empresaId={String(ver.empresa_id)}
                    kmActual={cfg.bitacora === "tracto" ? Number(ver.kilometraje_actual ?? 0) : null} />
                </div>
              )}
              <div>
                <h3 className="mb-2 text-sm font-semibold">Viajes, Carta Porte y facturas</h3>
                <FichaViajes relacion={cfg.relacion} id={ver.id} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setEditar(ver); }}><Pencil className="h-4 w-4" /> Editar</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Formulario({ cfg, editar, onClose, onSaved }: {
  cfg: CatalogoConfig; editar: Fila | "nuevo" | null; onClose: () => void; onSaved: () => void;
}) {
  const nuevo = editar === "nuevo";
  const campos = useMemo(() => (nuevo ? [...cfg.campos, ...(cfg.extra ?? [])] : cfg.campos), [cfg, nuevo]);
  const [valores, setValores] = useState<Valores>({});
  const [activo, setActivo] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editar) return;
    setValores(aValores(campos, typeof editar === "string" ? null : editar));
    setActivo(typeof editar === "string" ? true : editar.activo);
    setError(null);
  }, [editar, campos]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editar) return;
    setSaving(true); setError(null);
    const sb = createClient();
    const datos: Record<string, string | number | boolean | null> = { ...aPayload(campos, valores), activo };
    let err;
    if (typeof editar === "string") {
      const emp = await sb.from("empresa_configuracion").select("id").maybeSingle();
      if (!emp.data) { setSaving(false); return setError("Primero configura tu empresa en Empresa."); }
      if (cfg.tabla === "tractocamiones" && datos.kilometraje_inicial != null) datos.kilometraje_actual = datos.kilometraje_inicial;
      ({ error: err } = await sb.from(cfg.tabla).insert({ ...datos, empresa_id: emp.data.id }));
    } else {
      ({ error: err } = await sb.from(cfg.tabla).update(datos).eq("id", editar.id));
    }
    setSaving(false);
    if (err) setError(err.code === "23505" ? "Ya existe un registro con esa placa o RFC." : err.message);
    else onSaved();
  }

  async function eliminar() {
    if (!editar || typeof editar === "string") return;
    if (!window.confirm(`¿Eliminar ${editar.codigo}? Si tiene viajes ligados no se podrá; márcalo como inactivo.`)) return;
    setSaving(true);
    const { error: err } = await createClient().from(cfg.tabla).delete().eq("id", editar.id);
    setSaving(false);
    if (err) setError(err.code === "23503" ? "Tiene viajes ligados; márcalo como inactivo en lugar de eliminarlo." : err.message);
    else onSaved();
  }

  return (
    <Dialog open={!!editar} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <div>
          <DialogTitle className="text-lg font-semibold">{nuevo ? `Agregar ${cfg.singular}` : `Editar ${cfg.singular}`}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {nuevo ? "El ID se asigna automáticamente al guardar." : editar && typeof editar !== "string" ? `ID ${editar.codigo}` : ""}
          </DialogDescription>
        </div>
        <form onSubmit={onSubmit} className="grid gap-4">
          {error && <Alert variant="error">{error}</Alert>}
          <Campos campos={campos} valores={valores} onChange={setValores} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Activo
          </label>
          <div className="flex flex-wrap justify-between gap-2">
            {!nuevo ? (
              <Button type="button" variant="outline" disabled={saving} onClick={eliminar}><Trash2 className="h-4 w-4" /> Eliminar</Button>
            ) : <span />}
            <Button type="submit" disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
