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
export interface Tracto { id: string; empresa_id: string; placa: string; modelo: string | null; kilometraje_inicial: number; kilometraje_actual: number }
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
}

export interface Regla { id: string; tipo_servicio: string; intervalo_km: number }
export interface Bitacora { id: string; tracto_id: string; servicio_id: string; kilometraje_al_servicio: number; fecha: string; observaciones: string | null }

export interface EmpresaConfig {
  id: string; user_id: string; rfc: string; razon_social: string; regimen_fiscal: string;
  cer_path: string | null; key_path: string | null;
  logo_path: string | null; color_primario: string; color_base: string; color_acento: string;
}

export interface Factura {
  id: string; folio: string; uuid: string | null; tipo_comprobante: string | null; estado: string | null;
  fecha_emision: string | null; total: number; complemento: string | null;
  orden_referida: string | null; orden_compra: string | null; fecha_creacion: string | null; fecha_pago: string | null;
}

export interface OrdenResumen {
  id: string; numero: string; monto: number; fecha_creacion: string | null; fecha_pago: string | null;
  comp_pago: number | null; n_facturas: number; suma_facturas: number; diferencia: number;
}

export interface ImportExcelResult {
  facturas: { total: number; nuevas: number; actualizadas: number };
  ordenes_compra: { total: number; nuevas: number; actualizadas: number };
  omitidas: number; uuid_danados: number;
}

export interface FacturaSat {
  factura_id: string; uuid: string; estado: "pendiente" | "ok" | "error"; error: string | null;
  datos: CfdiResumen | null; actualizado_en: string | null; updated_at: string;
}
export interface CfdiResumen {
  uuid: string; version: string | null; tipo_comprobante: string | null; serie: string | null; folio: string | null;
  fecha: string | null; fecha_timbrado: string | null; moneda: string | null; subtotal: string | null; total: string | null;
  emisor: { rfc: string | null; nombre: string | null }; receptor: { rfc: string | null; nombre: string | null };
  conceptos: { descripcion: string | null; cantidad: string | null; importe: string | null; clave_prod_serv: string | null }[];
  carta_porte: {
    version: string | null; id_ccp: string | null; total_dist_rec: string | null;
    ubicaciones: { tipo: string | null; id: string | null; nombre: string | null; fecha: string | null; distancia: string | null; municipio: string | null; estado: string | null }[];
    mercancias: { descripcion: string | null; cantidad: string | null; peso_kg: string | null; clave_unidad: string | null }[];
    peso_bruto_total: string | null;
    vehiculo: { placa: string | null; config: string | null; anio: string | null };
    remolques: { placa: string | null; subtipo: string | null }[];
    figuras: { tipo: string | null; rfc: string | null; nombre: string | null; licencia: string | null }[];
  } | null;
}

export interface FacturaEstadistica { estado: string; complemento: string; con_orden: boolean; n: number; total: number }
export interface FacturaMes { mes: string; n: number; total: number }
