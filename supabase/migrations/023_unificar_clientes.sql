-- Unificar clientes duplicados (mismo cliente con nombres parecidos: «TRITURADOS ROCA» y «TRITURADOS ROCA DE BC SA DE CV»).
-- Atómico y con respaldo en auditoria_eliminaciones, igual que unificar tractos/góndolas (017). Requiere 022. Idempotente.
--  * Los viajes y las tarifas del duplicado pasan al cliente que se conserva; si ambos tienen tarifa para la misma ruta,
--    se queda la del cliente que se conserva (la otra queda en el respaldo).
--  * El nombre y los alias del duplicado quedan como alias del que se conserva (los XML y Excel futuros lo reconocen).
--  * Los viajes toman la configuración del que se conserva: comisión, km por mapa (el odómetro se ajusta solo) y factura semanal.

create or replace view public.clientes_resumen with (security_invoker = true) as
select c.*,
       (select count(*) from public.viajes v where v.cliente_id = c.id)                        as viajes,
       (select count(*) from public.tarifas t where t.cliente_id = c.id)                       as tarifas,
       (select max(coalesce(v.fecha_salida, v.fecha)) from public.viajes v where v.cliente_id = c.id) as ultimo_viaje
from public.clientes c;
grant select on public.clientes_resumen to authenticated;

create or replace function public.fn_vista_previa_unificar_clientes(p_empresa uuid, p_origen uuid, p_destino uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  dup clientes%rowtype; dst clientes%rowtype;
begin
  if p_origen = p_destino then raise exception 'El duplicado y el cliente que se conserva deben ser distintos'; end if;
  select * into dup from clientes where id = p_origen and empresa_id = p_empresa;
  select * into dst from clientes where id = p_destino and empresa_id = p_empresa;
  if dup.id is null or dst.id is null then raise exception 'No se encontró alguno de los clientes'; end if;
  return jsonb_build_object(
    'nombre_duplicado', dup.nombre,
    'nombre_destino', dst.nombre,
    'viajes', (select count(*) from viajes where cliente_id = p_origen and empresa_id = p_empresa),
    'facturas', (select count(distinct factura_id) from viajes where cliente_id = p_origen and empresa_id = p_empresa),
    'tarifas', (select count(*) from tarifas where cliente_id = p_origen),
    'tarifas_repetidas', (select count(*) from tarifas t join tarifas d on d.cliente_id = p_destino
                            and d.origen_id = t.origen_id and d.destino_id = t.destino_id where t.cliente_id = p_origen),
    'lugares', (select count(*) from lugares where empresa_id = p_empresa and cliente = dup.nombre),
    'alias_nuevos', (select coalesce(jsonb_agg(distinct a), '[]') from unnest(array[dup.nombre] || dup.alias) a
                      where upper(a) <> upper(dst.nombre) and not (upper(a) = any (select upper(x) from unnest(dst.alias) x))),
    'rfc_duplicado', dup.rfc, 'rfc_destino', dst.rfc,
    'rfc_distinto', coalesce(dup.rfc, '') <> '' and coalesce(dst.rfc, '') <> '' and upper(dup.rfc) <> upper(dst.rfc),
    'comision', jsonb_build_array(dup.comision_pct, dst.comision_pct),
    'km_por_mapa', jsonb_build_array(dup.km_por_mapa, dst.km_por_mapa),
    'factura_semanal', jsonb_build_array(dup.factura_semanal, dst.factura_semanal),
    'viajes_km_cambian', case when dup.km_por_mapa = dst.km_por_mapa then 0 else
      (select count(*) from viajes where cliente_id = p_origen and empresa_id = p_empresa and distancia_mapa_km is not null) end
  );
end;
$$;

create or replace function public.fn_unificar_clientes(p_empresa uuid, p_origen uuid, p_destino uuid, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  prev jsonb; dup clientes%rowtype; dst clientes%rowtype; tarifas_dup jsonb;
begin
  prev := fn_vista_previa_unificar_clientes(p_empresa, p_origen, p_destino);   -- valida y calcula lo que se moverá
  select * into dup from clientes where id = p_origen;
  select * into dst from clientes where id = p_destino;
  select coalesce(jsonb_agg(to_jsonb(t)), '[]') into tarifas_dup from tarifas t where t.cliente_id = p_origen;

  delete from tarifas t using tarifas d
   where t.cliente_id = p_origen and d.cliente_id = p_destino and d.origen_id = t.origen_id and d.destino_id = t.destino_id;
  update tarifas set cliente_id = p_destino where cliente_id = p_origen;
  update viajes set cliente_id = p_destino where cliente_id = p_origen and empresa_id = p_empresa;   -- recalcula km y odómetro
  update lugares set cliente = dst.nombre where empresa_id = p_empresa and cliente = dup.nombre;
  update clientes set
    alias = (select coalesce(array_agg(distinct upper(a)), '{}') from unnest(dst.alias || dup.alias || array[dup.nombre]) a
              where upper(a) <> upper(dst.nombre)),
    rfc   = coalesce(nullif(dst.rfc, ''), dup.rfc),
    notas = coalesce(nullif(dst.notas, ''), dup.notas)
  where id = p_destino;

  insert into auditoria_eliminaciones (empresa_id, accion, referencia, resumen, respaldo, usuario_id)
  values (p_empresa, 'cliente_unificado', dup.nombre || ' → ' || dst.nombre, prev,
          jsonb_build_object('cliente_duplicado', to_jsonb(dup), 'tarifas_duplicado', tarifas_dup), p_usuario);

  delete from clientes where id = p_origen and empresa_id = p_empresa;
  return prev;
end;
$$;

revoke all on function public.fn_vista_previa_unificar_clientes(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.fn_unificar_clientes(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_vista_previa_unificar_clientes(uuid, uuid, uuid) to service_role;
grant execute on function public.fn_unificar_clientes(uuid, uuid, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
