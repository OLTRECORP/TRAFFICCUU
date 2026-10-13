-- Bitácora de servicios de mantenimiento por unidad. Idempotente.
--  * Tractocamión: fecha, kilometraje (odómetro al servicio), servicio realizado y costo.
--  * Góndola: fecha, servicio realizado y costo (sin kilometraje).
-- Costo en pesos mexicanos (MXN), monto total pagado (IVA incluido).
-- Es independiente de bitacora_mantenimiento (alertas por intervalo de km).

create table if not exists public.servicios_mantenimiento (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresa_configuracion (id) on delete cascade,
  tracto_id   uuid references public.tractocamiones (id) on delete cascade,
  gondola_id  uuid references public.gondolas (id) on delete cascade,
  fecha       date not null default current_date,
  kilometraje numeric(12,1) check (kilometraje is null or kilometraje >= 0),
  servicio    text not null check (length(btrim(servicio)) > 0),
  costo       numeric(12,2) not null default 0 check (costo >= 0),
  notas       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- exactamente una unidad; el kilometraje es obligatorio en tractos y no aplica en góndolas
  constraint servicios_mant_unidad_ck check (
    (tracto_id is not null and gondola_id is null and kilometraje is not null)
    or (gondola_id is not null and tracto_id is null and kilometraje is null)
  )
);

create index if not exists servicios_mant_tracto_idx  on public.servicios_mantenimiento (tracto_id, fecha desc);
create index if not exists servicios_mant_gondola_idx on public.servicios_mantenimiento (gondola_id, fecha desc);

drop trigger if exists trg_servicios_mant_updated_at on public.servicios_mantenimiento;
create trigger trg_servicios_mant_updated_at before update on public.servicios_mantenimiento
for each row execute function public.fn_set_updated_at();

alter table public.servicios_mantenimiento enable row level security;
drop policy if exists tenant_servicios_mant on public.servicios_mantenimiento;
create policy tenant_servicios_mant on public.servicios_mantenimiento for all to authenticated
  using (empresa_id = public.mi_empresa_id()) with check (empresa_id = public.mi_empresa_id());

grant select, insert, update, delete on public.servicios_mantenimiento to authenticated;

notify pgrst, 'reload schema';
