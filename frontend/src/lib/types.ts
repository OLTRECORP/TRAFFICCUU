export interface Ubicacion { id: string; id_ubicacion: string; nombre: string | null; municipio: string | null; estado: string | null }
export interface Chofer { id: string; rfc: string; nombre: string; licencia: string | null }
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
  logo_path: string | null; color_primario: string; color_base: string;
}
