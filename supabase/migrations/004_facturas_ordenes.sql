-- Facturas y órdenes de compra (importadas del Excel "Administración de fletes").
-- La liga factura -> orden es por número de orden (facturas.orden_compra = ordenes_compra.numero),
-- sin FK porque el Excel puede traer facturas con órdenes que aún no están en la relación.

create table if not exists public.ordenes_compra (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresa_configuracion (id) on delete cascade,
  numero         text not null,
  monto          numeric(14,2) not null default 0,
  fecha_creacion date,
  fecha_pago     date,
  comp_pago      numeric(14,2),                 -- total cubierto por complemento de pago
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (empresa_id, numero)
);

create table if not exists public.facturas (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references public.empresa_configuracion (id) on delete cascade,
  folio             text not null,               -- clave de importación (único en el Excel)
  uuid              uuid,                        -- UUID del CFDI; null si el Excel lo trae dañado
  tipo_comprobante  text,
  estado            text,                        -- activado | pagado | cancelado ...
  fecha_emision     date,
  total             numeric(14,2) not null default 0,
  c_pag             integer,                     -- indicador de complemento de pago del Excel
  complemento       text,                        -- COMPLEMENTO LISTO | SIN COMPLEMENTO
  orden_referida    text,
  orden_compra      text,
  fecha_creacion    date,
  fecha_pago        date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (empresa_id, folio)
);

create index if not exists facturas_empresa_fecha_idx on public.facturas (empresa_id, fecha_emision desc);
create unique index if not exists facturas_uuid_idx on public.facturas (empresa_id, uuid) where uuid is not null;
create index if not exists facturas_orden_idx on public.facturas (empresa_id, orden_compra);

drop trigger if exists trg_ordenes_updated_at on public.ordenes_compra;
create trigger trg_ordenes_updated_at before update on public.ordenes_compra
for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_facturas_updated_at on public.facturas;
create trigger trg_facturas_updated_at before update on public.facturas
for each row execute function public.fn_set_updated_at();

alter table public.ordenes_compra enable row level security;
alter table public.facturas       enable row level security;

-- Lectura por empresa desde el navegador; la escritura la hace solo el backend (service_role).
drop policy if exists tenant_ordenes_select on public.ordenes_compra;
create policy tenant_ordenes_select on public.ordenes_compra
  for select to authenticated using (empresa_id = public.mi_empresa_id());
drop policy if exists tenant_facturas_select on public.facturas;
create policy tenant_facturas_select on public.facturas
  for select to authenticated using (empresa_id = public.mi_empresa_id());

-- Resumen por orden: facturas ligadas, suma y diferencia contra el monto de la orden.
create or replace view public.ordenes_compra_resumen with (security_invoker = true) as
select o.*,
       coalesce(f.n_facturas, 0)      as n_facturas,
       coalesce(f.suma_facturas, 0)   as suma_facturas,
       round(coalesce(f.suma_facturas, 0) - o.monto, 2) as diferencia
from public.ordenes_compra o
left join (
  select empresa_id, orden_compra, count(*) as n_facturas, sum(total) as suma_facturas
  from public.facturas
  where estado is distinct from 'cancelado'
  group by empresa_id, orden_compra
) f on f.empresa_id = o.empresa_id and f.orden_compra = o.numero;

grant select on public.ordenes_compra, public.facturas, public.ordenes_compra_resumen to authenticated;

-- Refresca el caché de esquema de la API (evita "Could not find the table ... in the schema cache").
notify pgrst, 'reload schema';
