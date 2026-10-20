export interface Ubicacion { id: string; id_ubicacion: string; nombre: string | null; municipio: string | null; estado: string | null }
export interface Chofer { id: string; rfc: string; nombre: string; licencia: string | null }

// Fichas completas (catálogos editables)
export interface ChoferFicha extends Chofer {
  empresa_id: string; codigo: string; curp: string | null; telefono: string | null;
  licencia_tipo: string | null; licencia_vigencia: string | null; activo: boolean; notas: string | null;
}
export interface UnidadBase {
  id: string; empresa_id: string; codigo: string; placa: string; numero_economico: string | null;
  marca: string | null; anio: number | null; num_serie: string | null;
  tipo_permiso_sct: string | null; num_permiso_sct: string | null;
  aseguradora: string | null; poliza_seguro: string | null; seguro_vigencia: string | null;
  activo: boolean; notas: string | null;
}
export interface TractoFicha extends UnidadBase { modelo: string | null; config_vehicular: string | null; kilometraje_inicial: number; kilometraje_actual: number }
export interface GondolaFicha extends UnidadBase { modelo: string | null; subtipo: string | null }

export interface ViajeLigado {
  id: string; uuid: string; folio_factura: string | null; fecha: string; total: number;
  origen: Ubicacion | null; destino: Ubicacion | null;
}
export interface Tracto { id: string; empresa_id: string; placa: string; modelo: string | null; kilometraje_inicial: number; kilometraje_actual: number; ejes?: number }
export interface Gondola { id: string; placa: string; subtipo: string | null }

export interface Viaje {
  id: string;
  folio_factura: string | null;
  uuid: string;
  fecha: string;
  distancia_xml: number;
  distancia_operativa: number;
  subtotal: number;
  total: number;
  rfc_emisor: string | null;
  rfc_receptor: string | null;
  origen: Ubicacion | null;
  destino: Ubicacion | null;
  chofer: Chofer | null;
  tracto: Pick<Tracto, "id" | "placa"> | null;
  gondola: Gondola | null;
  lugar_origen_id: string | null;
  lugar_destino_id: string | null;
  lugar_origen?: { nombre: string } | null; lugar_destino?: { nombre: string } | null;   // nombre de referencia del catálogo
  distancia_mapa_km: number | null;   // ida por mapa; km_operativos = ida x 2
  km_operativos: number | null;
  toneladas_facturadas?: number | null; precio_tonelada?: number | null; mercancia?: string | null;
  fecha_salida?: string | null; fecha_llegada?: string | null;
  origen_registro?: "xml" | "excel"; remision?: string | null; material?: string | null;
  cantidad?: number | null; unidad?: string | null; precio_unitario?: number | null;
  km_por_mapa?: boolean; cliente?: { nombre: string; comision_pct: number } | null;
}

/** Viaje con toneladas facturadas por encima de la capacidad del tracto (vista viajes_sobrepeso). */
export interface ViajeSobrepeso {
  viaje_id: string; factura_id: string | null; tracto_placa: string; capacidad_kg: number;
  toneladas_facturadas: number; exceso_kg: number;
}

/** Servicio programado: cada `intervalo_km` y/o cada `intervalo_dias`, dentro de un rubro (categoría de la bitácora). */
export interface Regla { id: string; empresa_id?: string; tipo_servicio: string; intervalo_km: number | null; intervalo_dias: number | null; categoria: string | null }
/** Cómo se estimó el odómetro del tracto (vista tractos_odometro). */
export interface OdometroTracto {
  tracto_id: string; km_base: number | null; fecha_base: string | null; fuente: "servicio" | "inicial";
  km_viajes: number; viajes: number; kilometraje_estimado: number; kilometraje_inicial: number;
}
export interface ServicioMant { id: string; empresa_id: string; tracto_id: string | null; gondola_id: string | null; fecha: string; kilometraje: number | null; servicio: string; categoria: string | null; costo: number; notas: string | null; regla_id?: string | null }
export interface Bitacora { id: string; tracto_id: string; servicio_id: string; kilometraje_al_servicio: number; fecha: string; observaciones: string | null }

export interface EmpresaConfig {
  id: string; user_id: string; rfc: string; razon_social: string; regimen_fiscal: string;
  cer_path: string | null; key_path: string | null;
  logo_path: string | null; color_primario: string; color_base: string; color_acento: string;
}

export interface Factura {
  sat?: { estado: string; actualizado_en: string | null; receptor?: { rfc: string | null; nombre: string | null } | null } | null;   // embebido desde facturas_sat
  vs?: { cliente_id: string | null }[];   // viajes ligados (uno por XML; varios en una factura semanal)
  id: string; folio: string; uuid: string | null; tipo_comprobante: string | null; estado: string | null;
  fecha_emision: string | null; total: number; complemento: string | null;
  orden_referida: string | null; orden_compra: string | null; fecha_creacion: string | null; fecha_pago: string | null;
}

export interface OrdenResumen {
  id: string; numero: string; monto: number; fecha_creacion: string | null; fecha_pago: string | null;
  comp_pago: number | null; n_facturas: number; suma_facturas: number; diferencia: number;
  n_complementos: number; fecha_pago_complemento: string | null; monto_pagado: number; pagada: boolean;   // pagada = hay complemento de pago con fecha
}

export interface ImportExcelResult {
  facturas: { total: number; nuevas: number; actualizadas: number };
  ordenes_compra: { total: number; nuevas: number; actualizadas: number };
  omitidas: number; uuid_danados: number;
}

export interface FacturaSat {
  factura_id: string; uuid: string; estado: "pendiente" | "ok" | "error"; error: string | null;
  datos: CfdiResumen | null; xml?: string | null; actualizado_en: string | null; updated_at: string;
}
/** Impuestos del comprobante: lo trasladado (IVA) y lo retenido (IVA e ISR), que el Total ya trae descontado. */
export interface ImpuestosCfdi { iva_trasladado: string; retencion_iva: string; retencion_isr: string; total_trasladados: string; total_retenidos: string }
export interface CfdiResumen {
  uuid: string; version: string | null; tipo_comprobante: string | null; serie: string | null; folio: string | null;
  fecha: string | null; fecha_timbrado: string | null; moneda: string | null; subtotal: string | null; total: string | null;
  emisor: { rfc: string | null; nombre: string | null }; receptor: { rfc: string | null; nombre: string | null };
  impuestos?: ImpuestosCfdi; descuento?: string | null;
  conceptos: { descripcion: string | null; cantidad: string | null; importe: string | null; clave_prod_serv: string | null }[];
  carta_porte: {
    version: string | null; id_ccp: string | null; total_dist_rec: string | null;
    ubicaciones: { tipo: string | null; id: string | null; nombre: string | null; fecha: string | null; distancia: string | null; municipio: string | null; estado: string | null; calle?: string | null; referencia?: string | null }[];
    mercancias: { descripcion: string | null; cantidad: string | null; peso_kg: string | null; clave_unidad: string | null }[];
    peso_bruto_total: string | null;
    vehiculo: { placa: string | null; config: string | null; anio: string | null };
    remolques: { placa: string | null; subtipo: string | null }[];
    figuras: { tipo: string | null; rfc: string | null; nombre: string | null; licencia: string | null }[];
  } | null;
}

export interface FacturaEstadistica { estado: string; complemento: string; con_orden: boolean; con_complemento: boolean; n: number; total: number }
export interface FacturaDia { dia: string; n: number; total: number }
export interface FacturaMes { mes: string; n: number; total: number }

export interface FacturaXmlMes { anio: number; mes: number; total: number; con_xml: number }
export interface SatDescarga {
  id: string; modo: "anio" | "faltantes" | "reprocesar" | "zip"; anio: number; meses: number[];
  estado: "pendiente" | "en_proceso" | "ok" | "error" | "cancelado";
  detalle: { mes: number; estado: "ok" | "error"; xml: number; mensaje: string | null }[];
  xml_recibidos: number; facturas_asignadas: number; complementos: number; viajes: number;
  bitacora: { t: string; n: "info" | "ok" | "aviso" | "error"; m: string }[];
  sin_asignar: { uuid: string; folio: string; total: string | null; fecha: string; motivo: string }[];
  error: string | null; created_at: string; updated_at: string;
}
export interface ComplementoPago {
  id: string; uuid: string; serie: string | null; folio: string | null; fecha_pago: string | null;
  monto: number | null; xml: string | null;
}
export interface Lugar {
  id: string; nombre: string; tipo: "origen" | "destino" | "ambos"; direccion: string | null;
  referencia: string | null; lat: number | null; lng: number | null; activo: boolean;
  precio_tonelada: number | null;
  cliente?: string | null;   // un cliente puede tener varios destinos; cada lugar lleva su propio nombre
  alias?: string[];          // otros nombres con que llega (ej. «LA RUMOROSA» para «RUMOROSA»)
  auto_ubicar?: boolean;     // false: el nombre no basta para ubicarlo; se marca a mano en el mapa
}

/** Cliente: tasa de comisión de sus viajes, si sus km salen del mapa y si factura por semana (lunes a domingo). */
export interface Cliente {
  id: string; nombre: string; rfc: string | null; alias: string[];
  comision_pct: number; km_por_mapa: boolean; factura_semanal: boolean; notas: string | null;
}
export interface Tarifa {
  id: string; cliente_id: string; origen_id: string; destino_id: string; precio: number; unidad: string;
  comision_pct: number | null; origen: { nombre: string } | null; destino: { nombre: string } | null;
}
export interface SemanaCliente {
  semana: string; fin: string; viajes: number; subtotal: number; cantidad: number;
  facturas: Record<string, number>; sin_factura: number; sugerida: string | null;
}
export interface FacturaCliente { id: string; folio: string; fecha: string | null; estado: string | null; subtotal: number | null; total: number; rfc: string | null }
export interface Ruta {
  id: string; origen_id: string; destino_id: string; distancia_km: number; calculada_en: string;
  origen: { nombre: string } | null; destino: { nombre: string } | null;
}
