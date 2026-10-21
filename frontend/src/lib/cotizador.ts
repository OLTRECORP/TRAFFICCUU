/**
 * Cotizador de fletes. Precio sugerido (subtotal, antes de IVA) sin pérdida y con la ganancia deseada:
 *
 *   costo base C0 = diésel + desgaste (mantenimiento y llantas) + depreciación + costo fijo por día + casetas + otros + indirectos
 *   comisión del chofer = c % del precio y ganancia = g % del precio  →  precio = C0 / (1 − c − g)
 *   precio mínimo (sin pérdida, ganancia 0) = C0 / (1 − c)
 *
 * La comisión es un % del precio (igual que en Comisiones), por eso el precio se despeja en lugar de sumarla al costo.
 */

export type UnidadCobro = "tonelada" | "m3";

/** Supuestos de la empresa (se guardan y se reutilizan en cada cotización). */
export interface Parametros {
  diesel_precio_litro: number;
  rendimiento_km_l: number;
  mant_por_km: number;           // mantenimiento y llantas ($/km)
  depreciacion_por_km: number;   // depreciación, financiamiento y seguro del equipo ($/km)
  costo_dia: number;             // costos fijos por día de operación ($/día)
  horas_jornada: number;
  horas_carga_descarga: number;
  indirectos_pct: number;        // administración y otros, sobre los costos directos
  comision_pct: number;          // comisión del chofer, % del precio
  ganancia_pct: number;          // ganancia deseada, % del precio
}

export const PARAMETROS_BASE: Parametros = {
  diesel_precio_litro: 24, rendimiento_km_l: 2.3, mant_por_km: 3.5, depreciacion_por_km: 2.5, costo_dia: 600,
  horas_jornada: 10, horas_carga_descarga: 3, indirectos_pct: 5, comision_pct: 12, ganancia_pct: 15,
};

export interface EntradaCotizacion {
  km_ida: number; minutos_ida: number;
  redondo: boolean;              // la unidad regresa (km y tiempo x 2), igual que los km operativos de los viajes
  cantidad: number; unidad: UnidadCobro;
  casetas: number; otros: number;
  params: Parametros;
}

export interface Desglose { concepto: string; monto: number; detalle: string }

export interface ResultadoCotizacion {
  km: number; horas: number; dias: number; litros: number;
  desglose: Desglose[];          // costos directos e indirectos
  costoBase: number;             // C0
  precioMinimo: number;          // sin pérdida: la comisión ya incluida
  precio: number;                // sugerido, redondeado hacia arriba al peso por unidad cobrada
  precioPorUnidad: number; precioMinimoPorUnidad: number; precioPorKm: number;
  comision: number; ganancia: number; gananciaPct: number;   // con el precio redondeado
  markupSobreCosto: number;      // ganancia / (costos + comisión)
  iva: number; retencionIva: number; total: number;
  escenarios: { gananciaPct: number; precio: number; porUnidad: number }[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export const IVA = 0.16, RETENCION_IVA = 0.04;   // flete: IVA 16 % con retención de 4 %

export function validar(e: EntradaCotizacion): string | null {
  const p = e.params;
  if (!(e.km_ida > 0)) return "Calcula primero la ruta (origen y destino)";
  if (!(e.cantidad > 0)) return `Captura la cantidad de ${e.unidad === "tonelada" ? "toneladas" : "m³"}`;
  if (!(p.rendimiento_km_l > 0)) return "El rendimiento del tracto (km/l) debe ser mayor a cero";
  if (!(p.horas_jornada > 0)) return "Las horas de jornada deben ser mayores a cero";
  if ([p.diesel_precio_litro, p.mant_por_km, p.depreciacion_por_km, p.costo_dia, p.horas_carga_descarga, p.indirectos_pct, p.comision_pct, p.ganancia_pct, e.casetas, e.otros].some((n) => !(n >= 0)))
    return "Los costos y porcentajes no pueden ser negativos";
  if (p.comision_pct + p.ganancia_pct >= 100) return "La comisión más la ganancia deben sumar menos de 100 %";
  return null;
}

export function cotizar(e: EntradaCotizacion): ResultadoCotizacion {
  const err = validar(e);
  if (err) throw new Error(err);
  const p = e.params, v = e.redondo ? 2 : 1;
  const km = e.km_ida * v, horas = (e.minutos_ida * v) / 60 + p.horas_carga_descarga;
  const dias = Math.max(0.5, horas / p.horas_jornada);
  const litros = km / p.rendimiento_km_l;
  const directos: Desglose[] = [
    { concepto: "Diésel", monto: litros * p.diesel_precio_litro, detalle: `${litros.toFixed(0)} L × $${p.diesel_precio_litro}/L (${p.rendimiento_km_l} km/l)` },
    { concepto: "Desgaste: mantenimiento y llantas", monto: km * p.mant_por_km, detalle: `${km.toFixed(0)} km × $${p.mant_por_km}/km` },
    { concepto: "Depreciación y financiamiento del equipo", monto: km * p.depreciacion_por_km, detalle: `${km.toFixed(0)} km × $${p.depreciacion_por_km}/km` },
    { concepto: "Costos fijos del día", monto: dias * p.costo_dia, detalle: `${dias.toFixed(1)} día(s) × $${p.costo_dia}/día` },
    { concepto: "Casetas y peajes", monto: e.casetas, detalle: "capturado" },
    { concepto: "Maniobras y otros", monto: e.otros, detalle: "capturado" },
  ];
  const sumaDirectos = directos.reduce((t, d) => t + d.monto, 0);
  const indirectos = sumaDirectos * (p.indirectos_pct / 100);
  const desglose = [...directos, { concepto: "Indirectos (administración)", monto: indirectos, detalle: `${p.indirectos_pct} % de los costos directos` }].map((d) => ({ ...d, monto: r2(d.monto) }));
  const costoBase = sumaDirectos + indirectos;
  const c = p.comision_pct / 100, g = p.ganancia_pct / 100;
  const precioMinimo = costoBase / (1 - c);
  // Se cobra por unidad entera: el precio por unidad se redondea hacia arriba y el total sale de él (nunca baja del cálculo)
  const porUnidad = Math.ceil(costoBase / (1 - c - g) / e.cantidad);
  const precio = r2(porUnidad * e.cantidad);
  const comision = precio * c, ganancia = precio - costoBase - comision;
  const iva = precio * IVA, retencion = precio * RETENCION_IVA;
  return {
    km, horas, dias, litros, desglose, costoBase: r2(costoBase),
    precioMinimo: r2(precioMinimo), precio, precioPorUnidad: porUnidad, precioMinimoPorUnidad: r2(precioMinimo / e.cantidad), precioPorKm: r2(precio / km),
    comision: r2(comision), ganancia: r2(ganancia), gananciaPct: precio > 0 ? ganancia / precio * 100 : 0,
    markupSobreCosto: costoBase + comision > 0 ? ganancia / (costoBase + comision) * 100 : 0,
    iva: r2(iva), retencionIva: r2(retencion), total: r2(precio + iva - retencion),
    escenarios: [0, 10, 15, 20, 25, 30].filter((x) => x + p.comision_pct < 100).map((x) => {
      const pr = costoBase / (1 - c - x / 100);
      return { gananciaPct: x, precio: r2(pr), porUnidad: r2(pr / e.cantidad) };
    }),
  };
}

/** Supuestos con los datos reales de la flota; lo que no tenga historial suficiente queda en el valor base. */
export interface HistorialCotizador {
  cargas: { fecha: string; costo: number | null; litros: number | null }[];
  tramos: { km: number; litros: number | null }[];
  servicios: { fecha: string; costo: number; tracto_id: string | null }[];
  viajes: { fecha_viaje: string; km: number }[];
}
export type Origen = "historial" | "base";
export interface ParametrosSugeridos { params: Parametros; origen: Partial<Record<keyof Parametros, { fuente: Origen; nota: string }>> }

const MIN_KM_MANT = 5000;
export function parametrosDesdeHistorial(h: HistorialCotizador, hoy = new Date().toISOString().slice(0, 10)): ParametrosSugeridos {
  const params = { ...PARAMETROS_BASE };
  const origen: ParametrosSugeridos["origen"] = {};
  const hace = (dias: number) => new Date(Date.parse(`${hoy}T00:00:00Z`) - dias * 86400000).toISOString().slice(0, 10);

  const conCosto = h.cargas.filter((c) => c.costo != null && c.litros != null && Number(c.litros) > 0 && Number(c.costo) > 0);
  const recientes = conCosto.filter((c) => c.fecha >= hace(120));
  const baseD = recientes.length >= 3 ? recientes : conCosto;
  if (baseD.length) {
    const lit = baseD.reduce((t, c) => t + Number(c.litros), 0);
    params.diesel_precio_litro = r2(baseD.reduce((t, c) => t + Number(c.costo), 0) / lit);
    origen.diesel_precio_litro = { fuente: "historial", nota: `${baseD.length} cargas${baseD === recientes ? " de los últimos 4 meses" : ""}` };
  }

  const tr = h.tramos.filter((t) => t.litros != null && Number(t.litros) > 0 && t.km > 0);
  const litrosTr = tr.reduce((t, x) => t + Number(x.litros), 0);
  if (tr.length >= 3 && litrosTr > 0) {
    params.rendimiento_km_l = r2(tr.reduce((t, x) => t + x.km, 0) / litrosTr);
    origen.rendimiento_km_l = { fuente: "historial", nota: `${tr.length} tramos entre cargas` };
  }

  const desde = hace(365);
  const kmAnio = h.viajes.filter((v) => v.fecha_viaje >= desde).reduce((t, v) => t + Number(v.km), 0);
  const costoMant = h.servicios.filter((s) => s.tracto_id && s.fecha >= desde).reduce((t, s) => t + Number(s.costo), 0);
  if (kmAnio >= MIN_KM_MANT && costoMant > 0) {
    params.mant_por_km = r2(costoMant / kmAnio);
    origen.mant_por_km = { fuente: "historial", nota: `servicios de 12 meses ÷ ${Math.round(kmAnio).toLocaleString("es-MX")} km` };
  }
  return { params, origen };
}

/** Lo que se cobra al cliente: el precio por unidad ofertado (el sugerido si no se captura otro) y qué deja a la empresa. */
export interface Oferta {
  precioPorUnidad: number; precio: number;
  comision: number; ganancia: number; gananciaPct: number;
  bajoMinimo: boolean;            // por debajo del mínimo sin pérdida: la empresa pierde dinero
  bajoDeseado: boolean;           // deja menos ganancia que la deseada
  iva: number; retencionIva: number; total: number;
}

export function evaluarOferta(r: ResultadoCotizacion, p: Pick<Parametros, "comision_pct" | "ganancia_pct">, cantidad: number, precioPorUnidad?: number): Oferta {
  const pu = precioPorUnidad != null && precioPorUnidad > 0 ? r2(precioPorUnidad) : r.precioPorUnidad;
  const precio = r2(pu * cantidad);
  const comision = precio * (p.comision_pct / 100), ganancia = precio - r.costoBase - comision;
  return {
    precioPorUnidad: pu, precio, comision: r2(comision), ganancia: r2(ganancia), gananciaPct: precio > 0 ? (ganancia / precio) * 100 : 0,
    bajoMinimo: ganancia < -0.005, bajoDeseado: ganancia < precio * (p.ganancia_pct / 100) - 0.005,
    iva: r2(precio * IVA), retencionIva: r2(precio * RETENCION_IVA), total: r2(precio + precio * IVA - precio * RETENCION_IVA),
  };
}

export const ESTADOS = ["borrador", "enviada", "aceptada", "rechazada"] as const;
export type EstadoCotizacion = (typeof ESTADOS)[number];
export const ETIQUETA_ESTADO: Record<EstadoCotizacion, string> = { borrador: "Borrador", enviada: "Enviada", aceptada: "Aceptada", rechazada: "Rechazada" };

export const VIGENCIA_BASE = 15;
/** Condiciones por defecto del formato; se pueden editar en cada cotización. El tiempo de carga sale de los supuestos. */
export const condicionesBase = (horasCargaDescarga: number) => [
  "Precios en pesos mexicanos (MXN); a los importes se les suma el IVA y se aplica la retención de IVA de 4 % del autotransporte de carga.",
  "El precio incluye casetas y peajes del trayecto cotizado y el combustible.",
  `Tiempo de carga y descarga incluido: ${horasCargaDescarga} horas en total; el excedente se cobra como demora.`,
  "La cantidad se cobra sobre lo cargado y pesado en origen; la unidad no excederá el peso máximo permitido por la SCT.",
  "La cotización está sujeta a disponibilidad de unidades y a cambios sustanciales en el precio del diésel.",
].join("\n");

/** Fecha (YYYY-MM-DD) hasta la que vale la cotización. */
export function vigenciaHasta(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha.slice(0, 10)}T00:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);
}

/** Datos del formato imprimible: lo que ve el cliente (nunca los costos internos ni la ganancia). */
export interface DocumentoCotizacion {
  folio: number | null; fecha: string; vigencia_dias: number;
  cliente: string | null; origen: string; destino: string; mercancia: string | null;
  km_ida: number; minutos_ida: number | null; redondo: boolean;
  cantidad: number; unidad: UnidadCobro; precio_unidad: number;
  condiciones: string;
}

export function totalesDocumento(d: Pick<DocumentoCotizacion, "cantidad" | "precio_unidad">) {
  const subtotal = r2(d.cantidad * d.precio_unidad);
  const iva = r2(subtotal * IVA), retencion = r2(subtotal * RETENCION_IVA);
  return { subtotal, iva, retencion, total: r2(subtotal + iva - retencion) };
}

export const folioTexto = (folio: number | null) => (folio == null ? "SIN FOLIO" : String(folio).padStart(5, "0"));
