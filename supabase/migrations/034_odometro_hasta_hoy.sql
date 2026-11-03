-- Odómetro estimado «hasta hoy». Requiere 026. Idempotente.
--
--  kilometraje_estimado = km del último mantenimiento (servicio o bitácora, el más reciente por fecha)
--                       + km de los viajes con fecha DESPUÉS de ese día y hasta hoy.
--  Sin mantenimiento con km: kilometraje inicial + km de los viajes hasta hoy.
--  Cambio vs 026: los viajes con fecha futura (programados) ya no suman. La vista se evalúa al consultar, así que
--  siempre está al día; tractocamiones.kilometraje_actual solo se refresca al cambiar viajes/servicios (el panel de
--  mantenimiento muestra el valor de la vista).

create or replace view public.tractos_odometro with (security_invoker = true) as
select t.id as tracto_id, t.empresa_id, t.placa, t.kilometraje_inicial,
       b.km                                         as km_base,
       b.fecha                                      as fecha_base,
       case when b.km is null then 'inicial' else 'servicio' end as fuente,
       coalesce(v.km, 0)                            as km_viajes,
       coalesce(v.n, 0)                             as viajes,
       coalesce(b.km, t.kilometraje_inicial) + coalesce(v.km, 0) as kilometraje_estimado
from public.tractocamiones t
left join lateral (
  select x.km, x.fecha from (
    select s.kilometraje as km, s.fecha from public.servicios_mantenimiento s where s.tracto_id = t.id and s.kilometraje is not null
    union all
    select m.kilometraje_al_servicio, m.fecha from public.bitacora_mantenimiento m where m.tracto_id = t.id
  ) x order by x.fecha desc, x.km desc limit 1
) b on true
left join lateral (
  select sum(vj.distancia_operativa) as km, count(*) as n
    from public.viajes vj
   where vj.tracto_id = t.id
     and (b.fecha is null or (coalesce(vj.fecha_salida, vj.fecha) at time zone 'UTC')::date > b.fecha)
     and (coalesce(vj.fecha_salida, vj.fecha) at time zone 'UTC')::date <= current_date   -- hasta hoy: sin viajes futuros
) v on true;
grant select on public.tractos_odometro to authenticated;

-- Refresca lo almacenado con el corte de hoy
do $$ declare t record; begin for t in select id from public.tractocamiones loop perform public.fn_recalcular_odometro(t.id); end loop; end $$;

notify pgrst, 'reload schema';
