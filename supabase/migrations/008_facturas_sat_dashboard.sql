-- Datos del SAT por factura (popup de Facturas) y estadísticas para el dashboard.
-- Idempotente: se puede ejecutar varias veces en Supabase > SQL Editor.

-- 1. Última descarga del CFDI desde el SAT, una fila por factura ------------------
create table if not exists public.facturas_sat (
  factura_id     uuid primary key references public.facturas (id) on delete cascade,
  empresa_id     uuid not null references public.empresa_configuracion (id) on delete cascade,
  uuid           uuid not null,
  estado         text not null default 'pendiente' check (estado in ('pendiente', 'ok', 'error')),
  id_solicitud   text,                       -- IdSolicitud de la Descarga Masiva del SAT
  error          text,
  datos          jsonb,                      -- resumen del CFDI y de su Carta Porte
  xml            text,                       -- CFDI tal cual lo entregó el SAT
  actualizado_en timestamptz,                -- cuándo se obtuvo el XML (null mientras no haya datos)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists facturas_sat_empresa_idx on public.facturas_sat (empresa_id);

drop trigger if exists trg_facturas_sat_updated_at on public.facturas_sat;
create trigger trg_facturas_sat_updated_at before update on public.facturas_sat
for each row execute function public.fn_set_updated_at();

alter table public.facturas_sat enable row level security;

-- Lectura por empresa desde el navegador; la escritura la hace solo el backend (service_role).
drop policy if exists tenant_facturas_sat_select on public.facturas_sat;
create policy tenant_facturas_sat_select on public.facturas_sat
  for select to authenticated using (empresa_id = public.mi_empresa_id());

grant select on public.facturas_sat to authenticated;

-- Búsqueda por folio fiscal desde el listado (ilike no aplica a columnas uuid).
alter table public.facturas
  add column if not exists uuid_texto text generated always as (lower(uuid::text)) stored;

-- 2. Estadísticas para el dashboard (security_invoker: respetan el RLS de facturas) -
create or replace view public.facturas_estadisticas with (security_invoker = true) as
select empresa_id,
       coalesce(estado, 'sin estado')                  as estado,
       coalesce(complemento, 'SIN COMPLEMENTO')        as complemento,
       (orden_compra is not null)                      as con_orden,
       count(*)                                        as n,
       coalesce(sum(total), 0)                         as total
from public.facturas
group by empresa_id, 2, 3, 4;

create or replace view public.facturas_por_mes with (security_invoker = true) as
select empresa_id,
       date_trunc('month', fecha_emision)::date        as mes,
       count(*)                                        as n,
       coalesce(sum(total), 0)                         as total
from public.facturas
where fecha_emision is not null and estado is distinct from 'cancelado'
group by empresa_id, 2;

grant select on public.facturas_estadisticas, public.facturas_por_mes to authenticated;

notify pgrst, 'reload schema';
