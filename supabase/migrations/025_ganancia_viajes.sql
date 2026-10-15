-- Ganancia por tracto y chofer: viajes con facturación (subtotal antes de IVA), tracto, chofer y tasa de comisión. Requiere 022. Idempotente.
-- Misma fecha y mismo filtro que comisiones_viajes y rendimiento_viajes (salida del origen; facturas canceladas fuera).
-- La tasa de comisión es la de comisiones_viajes: tarifa de la ruta, si no la del cliente, si no 12 %.
create or replace view public.ganancia_viajes with (security_invoker = true) as
select v.id          as viaje_id,
       v.empresa_id,
       v.chofer_id,
       v.tracto_id,
       (coalesce(v.fecha_salida, v.fecha) at time zone 'UTC')::date as fecha_viaje,
       v.subtotal,
       coalesce(t.comision_pct, c.comision_pct, 12) as tasa_comision
from public.viajes v
left join public.facturas f on f.id = v.factura_id
left join public.clientes c on c.id = v.cliente_id
left join public.tarifas  t on t.cliente_id = v.cliente_id and t.origen_id = v.lugar_origen_id and t.destino_id = v.lugar_destino_id
where f.estado is distinct from 'cancelado';

grant select on public.ganancia_viajes to authenticated;

notify pgrst, 'reload schema';
