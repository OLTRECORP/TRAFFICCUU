-- Cotizador de fletes: supuestos de costos de la empresa (uno por empresa) y cotizaciones guardadas. Idempotente.

create table if not exists public.cotizador_parametros (
  empresa_id  uuid primary key references public.empresa_configuracion (id) on delete cascade,
  parametros  jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create table if not exists public.cotizaciones (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresa_configuracion (id) on delete cascade,
  cliente        text,
  origen         text not null,
  destino        text not null,
  km_ida         numeric(10,2) not null check (km_ida >= 0),
  minutos_ida    integer check (minutos_ida is null or minutos_ida >= 0),
  unidad         text not null check (unidad in ('tonelada', 'm3')),
  cantidad       numeric(12,2) not null check (cantidad > 0),
  precio         numeric(14,2) not null,            -- subtotal antes de IVA
  precio_unidad  numeric(14,2) not null,
  precio_minimo  numeric(14,2) not null,            -- sin pérdida
  entrada        jsonb not null,                    -- lo capturado y los supuestos usados
  resultado      jsonb not null,
  notas          text,
  created_at     timestamptz not null default now()
);
create index if not exists cotizaciones_empresa_idx on public.cotizaciones (empresa_id, created_at desc);

drop trigger if exists trg_cotizador_parametros_updated_at on public.cotizador_parametros;
create trigger trg_cotizador_parametros_updated_at before update on public.cotizador_parametros
for each row execute function public.fn_set_updated_at();

alter table public.cotizador_parametros enable row level security;
alter table public.cotizaciones         enable row level security;
drop policy if exists tenant_cotizador_parametros on public.cotizador_parametros;
create policy tenant_cotizador_parametros on public.cotizador_parametros for all to authenticated
  using (empresa_id = public.mi_empresa_id()) with check (empresa_id = public.mi_empresa_id());
drop policy if exists tenant_cotizaciones on public.cotizaciones;
create policy tenant_cotizaciones on public.cotizaciones for all to authenticated
  using (empresa_id = public.mi_empresa_id()) with check (empresa_id = public.mi_empresa_id());
grant select, insert, update, delete on public.cotizador_parametros, public.cotizaciones to authenticated;

notify pgrst, 'reload schema';
