-- Eliminar facturas con respaldo y unificar tractos/góndolas duplicados. Idempotente. Requiere 004, 007, 008, 010, 016.
--  * Eliminar una factura borra también su viaje (el viaje nace de la factura) y su XML, devuelve al tracto los km de ese
--    viaje y deja el respaldo completo (factura, XML, viaje) en auditoria_eliminaciones para poder recuperarla.
--  * Unificar mueve viajes, servicios y bitácora del duplicado al tracto/góndola destino, completa los datos vacíos del
--    destino, suma los km propios del duplicado y guarda la placa errónea como alias para que no vuelva a crearse.

-- 1. Auditoría ----------------------------------------------------------------------------------------------------
create table if not exists public.auditoria_eliminaciones (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresa_configuracion (id) on delete cascade,
  accion      text not null,                 -- factura_eliminada | tracto_unificado | gondola_unificada
  referencia  text,                          -- folio de la factura o placa de la unidad
  motivo      text,
  resumen     jsonb not null default '{}',
  respaldo    jsonb not null default '{}',
  usuario_id  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists auditoria_elim_empresa_idx on public.auditoria_eliminaciones (empresa_id, created_at desc);
alter table public.auditoria_eliminaciones enable row level security;
drop policy if exists tenant_auditoria_elim_select on public.auditoria_eliminaciones;
create policy tenant_auditoria_elim_select on public.auditoria_eliminaciones
  for select to authenticated using (empresa_id = public.mi_empresa_id());
grant select on public.auditoria_eliminaciones to authenticated;

-- 2. Alias de placas (placa errónea -> unidad correcta) ------------------------------------------------------------
create table if not exists public.unidad_alias (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresa_configuracion (id) on delete cascade,
  tipo        text not null check (tipo in ('tracto', 'gondola')),
  placa       text not null,
  unidad_id   uuid not null,
  created_at  timestamptz not null default now(),
  unique (empresa_id, tipo, placa)
);
alter table public.unidad_alias enable row level security;
drop policy if exists tenant_unidad_alias_select on public.unidad_alias;
create policy tenant_unidad_alias_select on public.unidad_alias
  for select to authenticated using (empresa_id = public.mi_empresa_id());
grant select on public.unidad_alias to authenticated;

-- 3. Al borrar un viaje se le devuelven al tracto sus km (el insert ya los suma) -----------------------------------
create or replace function public.fn_viaje_resta_kilometraje()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.tracto_id is not null then
    update public.tractocamiones
       set kilometraje_actual = greatest(0, kilometraje_actual - old.distancia_operativa)
     where id = old.tracto_id and empresa_id = old.empresa_id;
  end if;
  return old;
end;
$$;
drop trigger if exists trg_viaje_resta_kilometraje on public.viajes;
create trigger trg_viaje_resta_kilometraje after delete on public.viajes
for each row execute function public.fn_viaje_resta_kilometraje();

-- 4. Facturas: vista previa y eliminación -------------------------------------------------------------------------
create or replace function public.fn_vista_previa_eliminar_facturas(p_empresa uuid, p_ids uuid[])
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'facturas',       (select count(*) from facturas f where f.empresa_id = p_empresa and f.id = any (p_ids)),
    'canceladas',     (select count(*) from facturas f where f.empresa_id = p_empresa and f.id = any (p_ids) and f.estado = 'cancelado'),
    'no_canceladas',  (select count(*) from facturas f where f.empresa_id = p_empresa and f.id = any (p_ids) and f.estado is distinct from 'cancelado'),
    'pagadas',        (select count(*) from facturas f where f.empresa_id = p_empresa and f.id = any (p_ids) and f.estado = 'pagado'),
    'con_orden',      (select count(*) from facturas f where f.empresa_id = p_empresa and f.id = any (p_ids) and f.orden_compra is not null),
    'con_xml',        (select count(*) from facturas_sat s where s.empresa_id = p_empresa and s.factura_id = any (p_ids) and s.xml is not null),
    'viajes',         (select count(*) from viajes v where v.empresa_id = p_empresa and v.factura_id = any (p_ids)),
    'km_a_restar',    (select coalesce(sum(v.distancia_operativa), 0) from viajes v where v.empresa_id = p_empresa and v.factura_id = any (p_ids)),
    'folios',         (select coalesce(jsonb_agg(f.folio order by f.folio), '[]') from (select folio from facturas f2
                        where f2.empresa_id = p_empresa and f2.id = any (p_ids) order by folio limit 12) f)
  );
$$;

create or replace function public.fn_eliminar_facturas(p_empresa uuid, p_ids uuid[], p_motivo text, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  f record;
  n_fact int := 0; n_viajes int := 0; n_xml int := 0; k int;
begin
  for f in select * from facturas where empresa_id = p_empresa and id = any (p_ids) order by folio loop
    insert into auditoria_eliminaciones (empresa_id, accion, referencia, motivo, resumen, respaldo, usuario_id)
    values (
      p_empresa, 'factura_eliminada', f.folio, nullif(btrim(p_motivo), ''),
      jsonb_build_object('estado', f.estado, 'total', f.total, 'uuid', f.uuid,
                         'viajes', (select count(*) from viajes v where v.factura_id = f.id)),
      jsonb_build_object('factura', to_jsonb(f),
                         'xml_sat', (select to_jsonb(s) from facturas_sat s where s.factura_id = f.id),
                         'viajes', (select coalesce(jsonb_agg(to_jsonb(v)), '[]') from viajes v where v.factura_id = f.id)),
      p_usuario);
    delete from viajes where factura_id = f.id and empresa_id = p_empresa;   -- el trigger devuelve sus km al tracto
    get diagnostics k = row_count; n_viajes := n_viajes + k;
    select count(*) into k from facturas_sat where factura_id = f.id and xml is not null; n_xml := n_xml + k;
    delete from facturas where id = f.id and empresa_id = p_empresa;          -- facturas_sat se va por cascade
    n_fact := n_fact + 1;
  end loop;
  return jsonb_build_object('facturas', n_fact, 'viajes', n_viajes, 'xml', n_xml);
end;
$$;

-- 5. Unidades: vista previa y unificación -------------------------------------------------------------------------
create or replace function public.fn_vista_previa_unificar(p_empresa uuid, p_tipo text, p_origen uuid, p_destino uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  dup jsonb; dst jsonb; campos text[] := '{}'; c text; cols text[];
  n_viajes int; n_fact int; n_serv int; n_reglas int := 0; km numeric := 0; placa_o text; placa_d text;
begin
  if p_tipo not in ('tracto', 'gondola') then raise exception 'Tipo de unidad inválido'; end if;
  if p_origen = p_destino then raise exception 'El duplicado y el destino deben ser distintos'; end if;
  if p_tipo = 'tracto' then
    select to_jsonb(t) into dup from tractocamiones t where t.id = p_origen and t.empresa_id = p_empresa;
    select to_jsonb(t) into dst from tractocamiones t where t.id = p_destino and t.empresa_id = p_empresa;
    cols := array['modelo','numero_economico','marca','anio','num_serie','config_vehicular','tipo_permiso_sct','num_permiso_sct',
                  'aseguradora','poliza_seguro','seguro_vigencia','capacidad_kg','notas'];
    select count(*), count(distinct factura_id) into n_viajes, n_fact from viajes where tracto_id = p_origen and empresa_id = p_empresa;
    select count(*) into n_serv from servicios_mantenimiento where tracto_id = p_origen and empresa_id = p_empresa;
    select count(*) into n_reglas from bitacora_mantenimiento where tracto_id = p_origen and empresa_id = p_empresa;
    km := greatest(0, coalesce((dup->>'kilometraje_actual')::numeric, 0) - coalesce((dup->>'kilometraje_inicial')::numeric, 0));
  else
    select to_jsonb(g) into dup from gondolas g where g.id = p_origen and g.empresa_id = p_empresa;
    select to_jsonb(g) into dst from gondolas g where g.id = p_destino and g.empresa_id = p_empresa;
    cols := array['subtipo','numero_economico','marca','modelo','anio','num_serie','tipo_permiso_sct','num_permiso_sct',
                  'aseguradora','poliza_seguro','seguro_vigencia','notas'];
    select count(*), count(distinct factura_id) into n_viajes, n_fact from viajes where gondola_id = p_origen and empresa_id = p_empresa;
    select count(*) into n_serv from servicios_mantenimiento where gondola_id = p_origen and empresa_id = p_empresa;
  end if;
  if dup is null or dst is null then raise exception 'No se encontró alguna de las unidades'; end if;
  foreach c in array cols loop
    if coalesce(dst->>c, '') = '' and coalesce(dup->>c, '') <> '' then campos := campos || c; end if;
  end loop;
  return jsonb_build_object('placa_duplicado', dup->>'placa', 'placa_destino', dst->>'placa',
                            'viajes', n_viajes, 'facturas', n_fact, 'servicios', n_serv, 'reglas_bitacora', n_reglas,
                            'km_a_sumar', km, 'campos_a_completar', to_jsonb(campos));
end;
$$;

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
      notas = coalesce(nullif(d.notas, ''), o.notas),
      kilometraje_actual = d.kilometraje_actual + greatest(0, o.kilometraje_actual - o.kilometraje_inicial)
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

  if p_tipo = 'tracto' then delete from tractocamiones where id = p_origen and empresa_id = p_empresa;
  else delete from gondolas where id = p_origen and empresa_id = p_empresa; end if;
  return prev;
end;
$$;

revoke all on function public.fn_eliminar_facturas(uuid, uuid[], text, uuid) from public, anon, authenticated;
revoke all on function public.fn_unificar_unidad(uuid, text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.fn_vista_previa_eliminar_facturas(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.fn_vista_previa_unificar(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_eliminar_facturas(uuid, uuid[], text, uuid) to service_role;
grant execute on function public.fn_unificar_unidad(uuid, text, uuid, uuid, uuid) to service_role;
grant execute on function public.fn_vista_previa_eliminar_facturas(uuid, uuid[]) to service_role;
grant execute on function public.fn_vista_previa_unificar(uuid, text, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
