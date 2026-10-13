-- Órdenes de compra pagadas según los complementos de pago (XML del SAT). Requiere 009. Idempotente.
-- Una orden está "pagada" cuando algún complemento de pago CON fecha de pago cubre una factura (no cancelada)
-- ligada a ella: orden -> facturas.orden_compra -> complemento_pago_documentos.uuid_documento -> complementos_pago.
-- Sin complemento con fecha de pago la orden queda "no pagada".

drop view if exists public.ordenes_compra_resumen;
create view public.ordenes_compra_resumen with (security_invoker = true) as
select o.*,
       coalesce(f.n_facturas, 0)      as n_facturas,
       coalesce(f.suma_facturas, 0)   as suma_facturas,
       round(coalesce(f.suma_facturas, 0) - o.monto, 2) as diferencia,
       coalesce(p.n_complementos, 0)  as n_complementos,
       p.fecha_pago_complemento,                          -- último pago registrado en los complementos
       coalesce(p.monto_pagado, 0)    as monto_pagado,
       (coalesce(p.n_complementos, 0) > 0) as pagada
from public.ordenes_compra o
left join (
  select empresa_id, orden_compra, count(*) as n_facturas, sum(total) as suma_facturas
  from public.facturas
  where estado is distinct from 'cancelado'
  group by empresa_id, orden_compra
) f on f.empresa_id = o.empresa_id and f.orden_compra = o.numero
left join (
  select fa.empresa_id, fa.orden_compra,
         count(distinct c.id)       as n_complementos,
         max(c.fecha_pago)          as fecha_pago_complemento,
         coalesce(sum(d.imp_pagado), 0) as monto_pagado
  from public.facturas fa
  join public.complemento_pago_documentos d on d.empresa_id = fa.empresa_id and d.uuid_documento = fa.uuid
  join public.complementos_pago c on c.id = d.complemento_id and c.fecha_pago is not null
  where fa.estado is distinct from 'cancelado' and fa.orden_compra is not null
  group by fa.empresa_id, fa.orden_compra
) p on p.empresa_id = o.empresa_id and p.orden_compra = o.numero;

grant select on public.ordenes_compra_resumen to authenticated;

-- Índices para filtrar facturas por chofer y por origen/destino a través de su viaje
create index if not exists viajes_chofer_idx on public.viajes (chofer_id);
create index if not exists viajes_lugar_origen_idx on public.viajes (lugar_origen_id);
create index if not exists viajes_lugar_destino_idx on public.viajes (lugar_destino_id);

notify pgrst, 'reload schema';
