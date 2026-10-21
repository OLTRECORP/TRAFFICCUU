-- Los complementos de pago (CFDI tipo P, «Pago» en el Excel) no son facturas: no cuentan en el total, el conteo,
-- las gráficas por día y mes ni en los demás indicadores de facturas del dashboard. Siguen en la lista de
-- facturas y siguen ligando las facturas que pagan. Idempotente.

create or replace function public.es_complemento_pago(tipo text)
returns boolean language sql immutable as $$
  select lower(btrim(coalesce(tipo, ''))) = 'p' or lower(btrim(coalesce(tipo, ''))) like 'pago%'
$$;
grant execute on function public.es_complemento_pago(text) to authenticated, service_role;

create or replace view public.facturas_estadisticas with (security_invoker = true) as
select empresa_id,
       coalesce(estado, 'sin estado')             as estado,
       coalesce(complemento, 'SIN COMPLEMENTO')   as complemento,
       (orden_compra is not null)                 as con_orden,
       con_complemento,
       count(*)                                   as n,
       coalesce(sum(total), 0)                    as total
from (
  select f.*,
         (coalesce(f.complemento = 'COMPLEMENTO LISTO', false) or exists (
            select 1 from public.complemento_pago_documentos d
            where d.empresa_id = f.empresa_id and d.uuid_documento = f.uuid)) as con_complemento
  from public.facturas f
  where not public.es_complemento_pago(f.tipo_comprobante)
) x
group by empresa_id, 2, 3, 4, con_complemento;

create or replace view public.facturas_por_mes with (security_invoker = true) as
select empresa_id,
       date_trunc('month', fecha_emision)::date        as mes,
       count(*)                                        as n,
       coalesce(sum(total), 0)                         as total
from public.facturas
where fecha_emision is not null and estado is distinct from 'cancelado'
  and not public.es_complemento_pago(tipo_comprobante)
group by empresa_id, 2;

create or replace view public.facturas_por_dia with (security_invoker = true) as
select empresa_id, fecha_emision as dia, count(*) as n, coalesce(sum(total), 0) as total
from public.facturas
where fecha_emision is not null and estado is distinct from 'cancelado'
  and not public.es_complemento_pago(tipo_comprobante)
group by empresa_id, fecha_emision;

grant select on public.facturas_estadisticas, public.facturas_por_mes, public.facturas_por_dia to authenticated;

notify pgrst, 'reload schema';
