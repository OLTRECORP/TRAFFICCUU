-- Odómetro estimado de cada tracto a partir de su último servicio con kilometraje, y servicios programados por rubro
-- con intervalo en km y/o en días. Requiere 016-025. Idempotente.
--
--  * Odómetro (tractocamiones.kilometraje_actual) = km del último servicio registrado (bitácora de servicios o
--    registro de una regla; el más reciente por fecha) + km de los viajes con fecha DESPUÉS de ese día.
--    Sin servicios: kilometraje inicial + km de todos sus viajes. Al registrar otro servicio con su km real, el
--    cálculo vuelve a empezar desde ahí. Se recalcula solo al cambiar viajes, servicios o el kilometraje inicial.
--  * Reglas de mantenimiento: rubro (mismo catálogo que la bitácora), cada X km y/o cada Y días.
--    Un servicio cuenta para una regla si se registró para ella (regla_id) o, si el rubro tiene una sola regla,
--    si es de ese rubro.

-- 1. Reglas por rubro, km y/o días -------------------------------------------------------------------------------
alter table public.reglas_mantenimiento
  add column if not exists categoria      text,
  add column if not exists intervalo_dias integer;
alter table public.reglas_mantenimiento alter column intervalo_km drop not null;
alter table public.reglas_mantenimiento drop constraint if exists reglas_mantenimiento_intervalo_km_check;
alter table public.reglas_mantenimiento drop constraint if exists reglas_mant_intervalos_ck;
alter table public.reglas_mantenimiento add constraint reglas_mant_intervalos_ck check (
  (intervalo_km is null or intervalo_km > 0) and (intervalo_dias is null or intervalo_dias > 0)
  and (intervalo_km is not null or intervalo_dias is not null));
alter table public.reglas_mantenimiento drop constraint if exists reglas_mant_categoria_ck;
alter table public.reglas_mantenimiento add constraint reglas_mant_categoria_ck check (categoria is null or categoria in (
  'motor', 'electrico', 'mecanico', 'soldadura', 'hidraulico', 'carroceria', 'suspension', 'llantas', 'frenos', 'transmision', 'otro'));

-- Rubro de las reglas que ya existían (las que crea la empresa por defecto)
update public.reglas_mantenimiento set categoria = 'motor'   where categoria is null and tipo_servicio ilike '%aceite%';
update public.reglas_mantenimiento set categoria = 'frenos'  where categoria is null and tipo_servicio ilike '%balata%';
update public.reglas_mantenimiento set categoria = 'llantas' where categoria is null and tipo_servicio ilike '%llanta%';

-- Servicio de la bitácora que cumple una regla
alter table public.servicios_mantenimiento
  add column if not exists regla_id uuid references public.reglas_mantenimiento (id) on delete set null;
create index if not exists servicios_mant_regla_idx on public.servicios_mantenimiento (regla_id);

-- 2. Odómetro estimado ----------------------------------------------------------------------------------------------
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
) v on true;
grant select on public.tractos_odometro to authenticated;

create or replace function public.fn_recalcular_odometro(p_tracto uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update tractocamiones t set kilometraje_actual = o.kilometraje_estimado
    from tractos_odometro o
   where o.tracto_id = p_tracto and t.id = p_tracto
     and t.kilometraje_actual is distinct from o.kilometraje_estimado;
end;
$$;

-- 3. Disparadores: viajes, servicios y kilometraje inicial ---------------------------------------------------------
-- Reemplazan a los que sumaban/restaban km por viaje (schema, 017 y 022).
drop trigger if exists trg_viaje_suma_kilometraje on public.viajes;
drop trigger if exists trg_viaje_resta_kilometraje on public.viajes;
drop trigger if exists trg_viaje_ajusta_kilometraje on public.viajes;

create or replace function public.fn_odometro_por_viaje()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.tracto_id is not null then perform fn_recalcular_odometro(old.tracto_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and new.tracto_id is not null
     then
    perform fn_recalcular_odometro(new.tracto_id);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_viaje_odometro on public.viajes;
create trigger trg_viaje_odometro after insert or delete on public.viajes
for each row execute function public.fn_odometro_por_viaje();
drop trigger if exists trg_viaje_odometro_upd on public.viajes;
create trigger trg_viaje_odometro_upd after update on public.viajes
for each row when (old.distancia_operativa is distinct from new.distancia_operativa
                   or old.tracto_id is distinct from new.tracto_id
                   or old.fecha is distinct from new.fecha
                   or old.fecha_salida is distinct from new.fecha_salida)
execute function public.fn_odometro_por_viaje();

create or replace function public.fn_odometro_por_servicio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.tracto_id is not null then perform fn_recalcular_odometro(old.tracto_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and new.tracto_id is not null then perform fn_recalcular_odometro(new.tracto_id); end if;
  return null;
end;
$$;
drop trigger if exists trg_servicio_odometro on public.servicios_mantenimiento;
create trigger trg_servicio_odometro after insert or update or delete on public.servicios_mantenimiento
for each row execute function public.fn_odometro_por_servicio();
drop trigger if exists trg_bitacora_odometro on public.bitacora_mantenimiento;
create trigger trg_bitacora_odometro after insert or update or delete on public.bitacora_mantenimiento
for each row execute function public.fn_odometro_por_servicio();

-- Alta del tracto o cambio de su kilometraje inicial
create or replace function public.fn_odometro_por_tracto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform fn_recalcular_odometro(new.id);
  return null;
end;
$$;
drop trigger if exists trg_tracto_odometro on public.tractocamiones;
create trigger trg_tracto_odometro after insert or update of kilometraje_inicial on public.tractocamiones
for each row execute function public.fn_odometro_por_tracto();

-- 4. Unificar tractos: el destino recalcula su odómetro con los viajes y servicios que recibe ------------------------
create or replace function public.fn_unificar_unidad(p_empresa uuid, p_tipo text, p_origen uuid, p_destino uuid, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  prev jsonb; dup jsonb; n int;
begin
  prev := fn_vista_previa_unificar(p_empresa, p_tipo, p_origen, p_destino);   -- valida y calcula lo que se moverá
  if p_tipo = 'tracto' then
    select to_jsonb(t) into dup from tractocamiones t where t.id = p_origen;
    update viajes set tracto_id = p_destino where tracto_id = p_origen and empresa_id = p_empresa;
    update servicios_mantenimiento set tracto_id = p_destino where tracto_id = p_origen and empresa_id = p_empresa;
    update bitacora_mantenimiento set tracto_id = p_destino where tracto_id = p_origen and empresa_id = p_empresa;
    update tractocamiones d set
      modelo = coalesce(nullif(d.modelo, ''), o.modelo), numero_economico = coalesce(nullif(d.numero_economico, ''), o.numero_economico),
      marca = coalesce(nullif(d.marca, ''), o.marca), anio = coalesce(d.anio, o.anio),
      num_serie = coalesce(nullif(d.num_serie, ''), o.num_serie), config_vehicular = coalesce(nullif(d.config_vehicular, ''), o.config_vehicular),
      tipo_permiso_sct = coalesce(nullif(d.tipo_permiso_sct, ''), o.tipo_permiso_sct), num_permiso_sct = coalesce(nullif(d.num_permiso_sct, ''), o.num_permiso_sct),
      aseguradora = coalesce(nullif(d.aseguradora, ''), o.aseguradora), poliza_seguro = coalesce(nullif(d.poliza_seguro, ''), o.poliza_seguro),
      seguro_vigencia = coalesce(d.seguro_vigencia, o.seguro_vigencia), capacidad_kg = coalesce(d.capacidad_kg, o.capacidad_kg),
      notas = coalesce(nullif(d.notas, ''), o.notas)
    from tractocamiones o where d.id = p_destino and o.id = p_origen;
  else
    select to_jsonb(g) into dup from gondolas g where g.id = p_origen;
    update viajes set gondola_id = p_destino where gondola_id = p_origen and empresa_id = p_empresa;
    update servicios_mantenimiento set gondola_id = p_destino where gondola_id = p_origen and empresa_id = p_empresa;
    update gondolas d set
      subtipo = coalesce(nullif(d.subtipo, ''), o.subtipo), numero_economico = coalesce(nullif(d.numero_economico, ''), o.numero_economico),
      marca = coalesce(nullif(d.marca, ''), o.marca), modelo = coalesce(nullif(d.modelo, ''), o.modelo), anio = coalesce(d.anio, o.anio),
      num_serie = coalesce(nullif(d.num_serie, ''), o.num_serie),
      tipo_permiso_sct = coalesce(nullif(d.tipo_permiso_sct, ''), o.tipo_permiso_sct), num_permiso_sct = coalesce(nullif(d.num_permiso_sct, ''), o.num_permiso_sct),
      aseguradora = coalesce(nullif(d.aseguradora, ''), o.aseguradora), poliza_seguro = coalesce(nullif(d.poliza_seguro, ''), o.poliza_seguro),
      seguro_vigencia = coalesce(d.seguro_vigencia, o.seguro_vigencia), notas = coalesce(nullif(d.notas, ''), o.notas)
    from gondolas o where d.id = p_destino and o.id = p_origen;
  end if;

  -- la placa errónea (y las que ya apuntaban al duplicado) quedan como alias del destino
  update unidad_alias set unidad_id = p_destino where empresa_id = p_empresa and tipo = p_tipo and unidad_id = p_origen;
  insert into unidad_alias (empresa_id, tipo, placa, unidad_id) values (p_empresa, p_tipo, dup->>'placa', p_destino)
  on conflict (empresa_id, tipo, placa) do update set unidad_id = excluded.unidad_id;

  insert into auditoria_eliminaciones (empresa_id, accion, referencia, resumen, respaldo, usuario_id)
  values (p_empresa, case p_tipo when 'tracto' then 'tracto_unificado' else 'gondola_unificada' end,
          (dup->>'placa') || ' → ' || (prev->>'placa_destino'), prev, jsonb_build_object('unidad_duplicada', dup), p_usuario);

  if p_tipo = 'tracto' then
    delete from tractocamiones where id = p_origen and empresa_id = p_empresa;
    -- los viajes y servicios movidos ya recalcularon el odómetro (trigger); se asegura al final
    perform fn_recalcular_odometro(p_destino);
  else
    delete from gondolas where id = p_origen and empresa_id = p_empresa;
  end if;
  return prev;
end;
$$;

revoke all on function public.fn_unificar_unidad(uuid, text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_unificar_unidad(uuid, text, uuid, uuid, uuid) to service_role;
revoke all on function public.fn_recalcular_odometro(uuid) from public, anon, authenticated;
grant execute on function public.fn_recalcular_odometro(uuid) to service_role;

-- 5. Recalcula el odómetro de todos los tractos con la regla nueva --------------------------------------------------
do $$ declare t record; begin for t in select id from public.tractocamiones loop perform public.fn_recalcular_odometro(t.id); end loop; end $$;

notify pgrst, 'reload schema';
