-- Llantas por posición en tractos y góndolas: la vida se mide desde la última llanta instalada (vigente) en cada
-- posición. Requiere 007, 016 y 026. Idempotente.
--
--  * Instalar una llanta en una posición retira sola a la que estaba ahí (fecha de retiro = fecha de instalación).
--  * Km recorridos de una llanta vigente:
--      tracto  -> odómetro estimado del tracto (026) − odómetro al instalarla
--      góndola -> km de los viajes de la góndola con fecha posterior a la instalación (la góndola no tiene odómetro)
--  * Ejes por unidad para dibujar las posiciones: tracto 3 (direccional sencillo + 2 de tracción dobles),
--    góndola 2 (dobles). Se pueden cambiar por unidad.

alter table public.tractocamiones add column if not exists ejes integer not null default 3;
alter table public.gondolas       add column if not exists ejes integer not null default 2;
alter table public.tractocamiones drop constraint if exists tractos_ejes_ck;
alter table public.tractocamiones add constraint tractos_ejes_ck check (ejes between 1 and 6);
alter table public.gondolas drop constraint if exists gondolas_ejes_ck;
alter table public.gondolas add constraint gondolas_ejes_ck check (ejes between 1 and 6);

create table if not exists public.llantas (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references public.empresa_configuracion (id) on delete cascade,
  tracto_id         uuid references public.tractocamiones (id) on delete cascade,
  gondola_id        uuid references public.gondolas (id) on delete cascade,
  posicion          text not null,                         -- E1-I, E1-D, E2-IE, E2-II, E2-DI, E2-DE, ...
  fecha_instalacion date not null default current_date,
  km_instalacion    numeric(12,1) check (km_instalacion is null or km_instalacion >= 0),   -- odómetro del tracto
  vida_km           integer not null default 120000 check (vida_km > 0),
  marca             text,
  medida            text,
  numero_serie      text,
  costo             numeric(12,2) not null default 0 check (costo >= 0),
  notas             text,
  fecha_retiro      date,
  motivo_retiro     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint llantas_unidad_ck check (
    (tracto_id is not null and gondola_id is null and km_instalacion is not null)
    or (gondola_id is not null and tracto_id is null)),
  constraint llantas_posicion_ck check (posicion ~ '^E[1-6]-(I|D|IE|II|DI|DE)$')
);
-- Una sola llanta vigente por posición
create unique index if not exists llantas_vigente_uk on public.llantas (coalesce(tracto_id, gondola_id), posicion) where fecha_retiro is null;
create index if not exists llantas_tracto_idx  on public.llantas (tracto_id, posicion);
create index if not exists llantas_gondola_idx on public.llantas (gondola_id, posicion);

drop trigger if exists trg_llantas_updated_at on public.llantas;
create trigger trg_llantas_updated_at before update on public.llantas
for each row execute function public.fn_set_updated_at();

-- Al instalar, se retira la llanta vigente de esa posición
create or replace function public.fn_llanta_retira_anterior()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fecha_retiro is null then
    update llantas set fecha_retiro = greatest(fecha_instalacion, new.fecha_instalacion), motivo_retiro = coalesce(motivo_retiro, 'Reemplazada')
     where fecha_retiro is null and posicion = new.posicion and id <> new.id
       and coalesce(tracto_id, gondola_id) = coalesce(new.tracto_id, new.gondola_id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_llanta_retira_anterior on public.llantas;
create trigger trg_llanta_retira_anterior before insert on public.llantas
for each row execute function public.fn_llanta_retira_anterior();

alter table public.llantas enable row level security;
drop policy if exists tenant_llantas on public.llantas;
create policy tenant_llantas on public.llantas for all to authenticated
  using (empresa_id = public.mi_empresa_id()) with check (empresa_id = public.mi_empresa_id());
grant select, insert, update, delete on public.llantas to authenticated;

-- Llantas vigentes con km recorridos y % de vida usada
create or replace view public.llantas_estado with (security_invoker = true) as
select l.*,
       round(greatest(0, case when l.tracto_id is not null then t.kilometraje_actual - l.km_instalacion
                              else coalesce(g.km, 0) end), 1)                                as km_recorridos,
       (current_date - l.fecha_instalacion)                                                 as dias,
       round(100.0 * greatest(0, case when l.tracto_id is not null then t.kilometraje_actual - l.km_instalacion
                                       else coalesce(g.km, 0) end) / l.vida_km, 1)          as porcentaje
from public.llantas l
left join public.tractocamiones t on t.id = l.tracto_id
left join lateral (
  select sum(v.distancia_operativa) as km from public.viajes v
   where l.gondola_id is not null and v.gondola_id = l.gondola_id
     and (coalesce(v.fecha_salida, v.fecha) at time zone 'UTC')::date > l.fecha_instalacion
) g on true
where l.fecha_retiro is null;
grant select on public.llantas_estado to authenticated;

-- Góndola que jala cada tracto: la de su viaje más reciente
create or replace view public.tractos_gondola_actual with (security_invoker = true) as
select distinct on (v.tracto_id) v.tracto_id, v.gondola_id, g.placa as gondola_placa,
       (coalesce(v.fecha_salida, v.fecha) at time zone 'UTC')::date as fecha
from public.viajes v
join public.gondolas g on g.id = v.gondola_id
where v.tracto_id is not null and v.gondola_id is not null
order by v.tracto_id, coalesce(v.fecha_salida, v.fecha) desc;
grant select on public.tractos_gondola_actual to authenticated;

notify pgrst, 'reload schema';
