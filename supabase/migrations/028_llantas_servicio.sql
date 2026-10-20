-- Liga cada llanta con el servicio de la bitácora en que se instaló: al registrar un servicio de llantas se eligen
-- las posiciones (tracto o góndola) y toman su fecha y kilometraje. Si después se corrige la fecha o el km del
-- servicio, las llantas ligadas se corrigen igual. Requiere 027. Idempotente.

alter table public.llantas add column if not exists servicio_id uuid references public.servicios_mantenimiento (id) on delete set null;
create index if not exists llantas_servicio_idx on public.llantas (servicio_id) where servicio_id is not null;

create or replace function public.fn_servicio_sincroniza_llantas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fecha is distinct from old.fecha or new.kilometraje is distinct from old.kilometraje then
    update llantas
       set fecha_instalacion = new.fecha,
           km_instalacion = case when tracto_id is not null then coalesce(new.kilometraje, km_instalacion) else km_instalacion end
     where servicio_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_servicio_sincroniza_llantas on public.servicios_mantenimiento;
create trigger trg_servicio_sincroniza_llantas after update of fecha, kilometraje on public.servicios_mantenimiento
for each row execute function public.fn_servicio_sincroniza_llantas();

-- La vista expone l.*; se recrea para incluir la columna nueva (create or replace no admite columnas en medio)
drop view if exists public.llantas_estado;
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

notify pgrst, 'reload schema';
