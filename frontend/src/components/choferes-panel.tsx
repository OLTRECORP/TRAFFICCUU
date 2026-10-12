"use client";

import { CatalogoPanel, Vigencia, type CatalogoConfig } from "@/components/catalogo-panel";

const cfg: CatalogoConfig = {
  tabla: "choferes", relacion: "chofer_id", singular: "chofer", orden: "nombre",
  buscar: ["nombre", "rfc", "licencia", "curp"],
  campos: [
    { key: "nombre", label: "Nombre completo", required: true, wide: true },
    { key: "rfc", label: "RFC", required: true, upper: true },
    { key: "curp", label: "CURP", upper: true },
    { key: "telefono", label: "Teléfono" },
    { key: "licencia", label: "Número de licencia" },
    { key: "licencia_tipo", label: "Tipo de licencia (ej. E)", upper: true },
    { key: "licencia_vigencia", label: "Vigencia de licencia", type: "date" },
    { key: "notas", label: "Notas", wide: true },
  ],
  columnas: [
    { label: "Nombre", render: (f) => <span className="font-medium">{String(f.nombre)}</span> },
    { label: "RFC", render: (f) => String(f.rfc) },
    { label: "Licencia", render: (f) => String(f.licencia ?? "—") },
    { label: "Vigencia", render: (f) => <Vigencia fecha={f.licencia_vigencia} /> },
  ],
  vigencias: [{ key: "licencia_vigencia", label: "Vigencia" }],
  detalle: [
    { label: "RFC", key: "rfc" }, { label: "CURP", key: "curp" }, { label: "Teléfono", key: "telefono" },
    { label: "Licencia", key: "licencia" }, { label: "Tipo de licencia", key: "licencia_tipo" },
    { label: "Vigencia de licencia", key: "licencia_vigencia" }, { label: "Notas", key: "notas" },
  ],
};

export const ChoferesPanel = () => <CatalogoPanel cfg={cfg} />;
