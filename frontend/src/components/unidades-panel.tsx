"use client";

import { CatalogoPanel, Vigencia, type CatalogoConfig } from "@/components/catalogo-panel";
import type { Campo } from "@/components/ficha-campos";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const comunes: Campo[] = [
  { key: "placa", label: "Placas", required: true, upper: true },
  { key: "numero_economico", label: "Número económico" },
  { key: "marca", label: "Marca" },
  { key: "modelo", label: "Modelo" },
  { key: "anio", label: "Año", type: "number" },
  { key: "num_serie", label: "Número de serie (VIN)", upper: true },
  { key: "tipo_permiso_sct", label: "Tipo de permiso SCT (ej. TPAF01)", upper: true },
  { key: "num_permiso_sct", label: "Número de permiso SCT" },
  { key: "aseguradora", label: "Aseguradora" },
  { key: "poliza_seguro", label: "Póliza de seguro" },
  { key: "seguro_vigencia", label: "Vigencia del seguro", type: "date" },
  { key: "notas", label: "Notas", wide: true },
];
const detalleComun = [
  { label: "Placas", key: "placa" }, { label: "No. económico", key: "numero_economico" }, { label: "Marca", key: "marca" },
  { label: "Modelo", key: "modelo" }, { label: "Año", key: "anio" }, { label: "No. de serie", key: "num_serie" },
  { label: "Tipo de permiso SCT", key: "tipo_permiso_sct" }, { label: "No. de permiso SCT", key: "num_permiso_sct" },
  { label: "Aseguradora", key: "aseguradora" }, { label: "Póliza", key: "poliza_seguro" },
  { label: "Vigencia del seguro", key: "seguro_vigencia" }, { label: "Notas", key: "notas" },
];
const columnasComunes: CatalogoConfig["columnas"] = [
  { label: "Placas", render: (f) => <span className="font-medium">{String(f.placa)}</span> },
  { label: "Marca / modelo", render: (f) => [f.marca, f.modelo].filter(Boolean).join(" ") || "—" },
  { label: "Año", render: (f) => String(f.anio ?? "—") },
  { label: "Seguro", render: (f) => <Vigencia fecha={f.seguro_vigencia} /> },
];
const buscar = ["placa", "numero_economico", "marca", "modelo", "num_serie"];
const vigencias = [{ key: "seguro_vigencia", label: "Seguro" }];

const tractos: CatalogoConfig = {
  tabla: "tractocamiones", relacion: "tracto_id", bitacora: "tracto", singular: "tracto", orden: "placa", buscar, vigencias,
  campos: [...comunes.slice(0, 6), { key: "config_vehicular", label: "Config. vehicular (ej. T3S2)", upper: true },
    { key: "capacidad_kg", label: "Capacidad de carga (kg)", type: "number" }, ...comunes.slice(6)],
  extra: [{ key: "kilometraje_inicial", label: "Kilometraje inicial", type: "number" }],
  columnas: columnasComunes,
  detalle: [...detalleComun.slice(0, 6), { label: "Config. vehicular", key: "config_vehicular" },
    { label: "Capacidad de carga (kg)", key: "capacidad_kg" }, ...detalleComun.slice(6),
    { label: "Kilometraje actual", key: "kilometraje_actual" }],
};

const gondolas: CatalogoConfig = {
  tabla: "gondolas", relacion: "gondola_id", bitacora: "gondola", singular: "góndola", orden: "placa", buscar, vigencias,
  campos: [...comunes.slice(0, 6), { key: "subtipo", label: "Subtipo de remolque (ej. CTR_011)", upper: true }, ...comunes.slice(6)],
  columnas: columnasComunes,
  detalle: [...detalleComun.slice(0, 6), { label: "Subtipo de remolque", key: "subtipo" }, ...detalleComun.slice(6)],
};

export function UnidadesPanel() {
  return (
    <Tabs defaultValue="tractos">
      <TabsList>
        <TabsTrigger value="tractos">Tractos</TabsTrigger>
        <TabsTrigger value="gondolas">Góndolas</TabsTrigger>
      </TabsList>
      <TabsContent value="tractos"><CatalogoPanel cfg={tractos} /></TabsContent>
      <TabsContent value="gondolas"><CatalogoPanel cfg={gondolas} /></TabsContent>
    </Tabs>
  );
}
