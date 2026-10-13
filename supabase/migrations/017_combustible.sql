-- Cargas de combustible (diésel) por tracto y base para el rendimiento de choferes. Requiere 007, 010 y 015. Idempotente.
--  * litros: litros de diésel de la carga (> 0). costo: monto total pagado en MXN (IVA incluido), opcional.
--  * kilometraje: odómetro del tracto al momento de la carga, opcional. Sin odómetro la carga cuenta para
--    litros y costo, pero no para km/l (el portal no adivina kilómetros).
--  * chofer_id: opcional; si se omite, el portal lo deduce del último viaje del tracto a esa fecha.

create table if not exists public.cargas_combustible (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresa_configuracion (id) on delete cascade,
  tracto_id   uuid not null references public.tractocamiones (id) on delete cascade,
  chofer_id   uuid references public.choferes (id) on delete set null,
  fecha       date not null default current_date,
  litros      numeric(10,2) not null check (litros > 0),
  costo       numeric(12,2) check (costo is null or costo >= 0),
  kilometraje numeric(12,1) check (kilometraje is null or kilometraje >= 0),
  estacion    text,
  notas       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists cargas_comb_tracto_idx on public.cargas_combustible (tracto_id, fecha desc);
create index if not exists cargas_comb_chofer_idx on public.cargas_combustible (chofer_id, fecha desc);
create index if not exists cargas_comb_empresa_idx on public.cargas_combustible (empresa_id, fecha desc);

drop trigger if exists trg_cargas_comb_updated_at on public.cargas_combustible;
create trigger trg_cargas_comb_updated_at before update on public.cargas_combustible
for each row execute function public.fn_set_updated_at();

alter table public.cargas_combustible enable row level security;
drop policy if exists tenant_cargas_comb on public.cargas_combustible;
create policy tenant_cargas_comb on public.cargas_combustible for all to authenticated
  using (empresa_id = public.mi_empresa_id()) with check (empresa_id = public.mi_empresa_id());

grant select, insert, update, delete on public.cargas_combustible to authenticated;

-- Viajes con tracto, chofer y km de la Carta Porte (distancia_operativa = ida x 2, redondo).
-- Misma fecha que comisiones_viajes (salida del origen); las facturas canceladas no cuentan.
create or replace view public.rendimiento_viajes with (security_invoker = true) as
select v.id          as viaje_id,
       v.empresa_id,
       v.chofer_id,
       v.tracto_id,
       (coalesce(v.fecha_salida, v.fecha) at time zone 'UTC')::date as fecha_viaje,
       v.distancia_operativa as km
from public.viajes v
left join public.facturas f on f.id = v.factura_id
where f.estado is distinct from 'cancelado';

grant select on public.rendimiento_viajes to authenticated;

notify pgrst, 'reload schema';
