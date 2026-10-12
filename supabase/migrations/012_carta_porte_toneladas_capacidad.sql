-- Datos extra de la Carta Porte: toneladas facturadas, mercancía, fechas de salida/llegada y
-- capacidad del tracto (alerta de posible sobrepeso). Idempotente. Va después de la 009-011.

-- Capacidad de carga del tracto en kg (se llena con el PesoBrutoTotal de la Carta Porte si está vacía).
alter table public.tractocamiones
  add column if not exists capacidad_kg numeric(10,2) check (capacidad_kg is null or capacidad_kg >= 0);

alter table public.viajes
  add column if not exists toneladas_facturadas numeric(12,3),   -- Cantidad del concepto facturado en toneladas
  add column if not exists precio_tonelada      numeric(12,2),   -- ValorUnitario de ese concepto
  add column if not exists peso_bruto_total_kg  numeric(12,2),   -- PesoBrutoTotal tal cual viene en la Carta Porte
  add column if not exists mercancia            text,
  add column if not exists fecha_salida         timestamptz,
  add column if not exists fecha_llegada        timestamptz;

-- Posible sobrepeso: toneladas facturadas por encima de la capacidad del tracto del viaje.
create or replace view public.viajes_sobrepeso with (security_invoker = true) as
select v.empresa_id, v.id as viaje_id, v.factura_id, v.folio_factura, v.tracto_id,
       t.placa as tracto_placa,
       t.capacidad_kg,
       v.toneladas_facturadas,
       round(v.toneladas_facturadas * 1000 - t.capacidad_kg, 2) as exceso_kg
from public.viajes v
join public.tractocamiones t on t.id = v.tracto_id
where v.toneladas_facturadas is not null
  and t.capacidad_kg is not null
  and v.toneladas_facturadas * 1000 > t.capacidad_kg;

grant select on public.viajes_sobrepeso to authenticated;

notify pgrst, 'reload schema';
