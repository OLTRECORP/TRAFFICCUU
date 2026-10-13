-- Comisiones de choferes: base de cálculo por viaje. Requiere 007, 010, 012 y 013. Idempotente.
-- La comisión (12 %) se calcula en el portal sobre el subtotal de la factura (antes de IVA).
-- Fecha del viaje = fecha de salida del Origen en la Carta Porte (FechaHoraSalidaLlegada, viajes.fecha_salida);
-- si el viaje aún no la tiene, se usa la fecha del CFDI. La fecha se guarda sin zona horaria en el XML,
-- por eso se toma tal cual (UTC) para no recorrer el día.
-- Las facturas canceladas no generan comisión.

create or replace view public.comisiones_viajes with (security_invoker = true) as
select v.id                                   as viaje_id,
       v.empresa_id,
       v.chofer_id,
       v.factura_id,
       coalesce(f.folio, v.folio_factura)     as folio,
       (coalesce(v.fecha_salida, v.fecha) at time zone 'UTC')::date as fecha_viaje,
       v.subtotal,
       v.total,
       f.estado                               as estado_factura,
       coalesce(lo.nombre, uo.nombre, nullif(concat_ws(', ', uo.municipio, uo.estado), '')) as origen,
       coalesce(ld.nombre, ud.nombre, nullif(concat_ws(', ', ud.municipio, ud.estado), '')) as destino,
       ld.cliente                             as cliente
from public.viajes v
left join public.facturas   f  on f.id  = v.factura_id
left join public.lugares    lo on lo.id = v.lugar_origen_id
left join public.lugares    ld on ld.id = v.lugar_destino_id
left join public.ubicaciones uo on uo.id = v.origen_id
left join public.ubicaciones ud on ud.id = v.destino_id
where v.chofer_id is not null
  and f.estado is distinct from 'cancelado';

grant select on public.comisiones_viajes to authenticated;

create index if not exists viajes_chofer_fecha_idx on public.viajes (chofer_id, fecha_salida);

notify pgrst, 'reload schema';
