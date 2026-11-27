-- Restaurar facturas desde la bitácora aunque ya exista una con el mismo folio/UUID. Idempotente. Requiere 036.
--  * Antes la restauración se rechazaba si la factura ya se había vuelto a cargar (XML o Excel). Ahora esa factura se
--    completa: se le agrega el XML guardado si no lo tiene y los viajes del respaldo que no se hayan vuelto a registrar.
--  * Un viaje que ya existe con el mismo UUID se conserva (se liga a la factura si estaba suelto).

create or replace function public.fn_restaurar_facturas(p_empresa uuid, p_ids uuid[], p_usuario uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  a record; fac jsonb; existente uuid; destino uuid; n_unidas int := 0; ya_tiene_xml boolean; sat jsonb; v jsonb; viaje jsonb;
  cols_v text; cols_f text; cols_s text;
  n_fact int := 0; n_viajes int := 0; n_xml int := 0; fid uuid; folios text[] := '{}';
begin
  if (select count(*) from auditoria_eliminaciones
       where empresa_id = p_empresa and id = any (p_ids) and accion = 'factura_eliminada') <> cardinality(p_ids) then
    raise exception 'Alguna entrada no existe o no es una factura eliminada';
  end if;
  -- todas las columnas menos las generadas; los triggers recalculan los km
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols_f
    from information_schema.columns where table_schema = 'public' and table_name = 'facturas' and is_generated = 'NEVER';
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols_s
    from information_schema.columns where table_schema = 'public' and table_name = 'facturas_sat' and is_generated = 'NEVER';
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols_v
    from information_schema.columns where table_schema = 'public' and table_name = 'viajes' and is_generated = 'NEVER';

  for a in select * from auditoria_eliminaciones where empresa_id = p_empresa and id = any (p_ids) order by created_at, id loop
    if a.restaurada_at is not null then
      raise exception 'La factura % ya fue restaurada', a.referencia;
    end if;
    fac := a.respaldo -> 'factura';
    if fac is null or fac = 'null'::jsonb then raise exception 'La entrada de % no tiene respaldo de la factura', a.referencia; end if;
    fid := (fac ->> 'id')::uuid;
    -- ¿Ya hay una factura con ese id, UUID o folio? (p. ej. se volvió a subir el XML o el Excel después de eliminarla)
    select f.id into existente from facturas f
     where f.id = fid
        or (f.empresa_id = p_empresa and coalesce(fac ->> 'uuid', '') <> '' and f.uuid::text = lower(fac ->> 'uuid'))
        or (f.empresa_id = p_empresa and f.folio = fac ->> 'folio')
     order by (f.id = fid) desc, (f.uuid::text = lower(coalesce(fac ->> 'uuid', ''))) desc limit 1;
    if existente is null then
      fac := fn_limpiar_referencias('public.facturas'::regclass, fac, array['empresa_id']);
      execute format('insert into facturas (%1$s) select %1$s from jsonb_populate_record(null::facturas, $1)', cols_f) using fac;
      destino := fid;
    else
      destino := existente;   -- se completa esa factura con el XML y los viajes que le falten
      n_unidas := n_unidas + 1;
    end if;

    sat := a.respaldo -> 'xml_sat';
    select exists (select 1 from facturas_sat where factura_id = destino and coalesce(xml, '') <> '') into ya_tiene_xml;
    if sat is not null and sat <> 'null'::jsonb and not ya_tiene_xml then
      delete from facturas_sat where factura_id = destino;
      sat := jsonb_set(sat, '{factura_id}', to_jsonb(destino::text));
      execute format('insert into facturas_sat (%1$s) select %1$s from jsonb_populate_record(null::facturas_sat, $1) on conflict do nothing', cols_s) using sat;
      n_xml := n_xml + case when coalesce(sat ->> 'xml', '') <> '' then 1 else 0 end;
    end if;

    for v in select * from jsonb_array_elements(coalesce(a.respaldo -> 'viajes', '[]'::jsonb)) loop
      viaje := fn_limpiar_referencias('public.viajes'::regclass, v, array['empresa_id', 'factura_id']);
      viaje := jsonb_set(viaje, '{factura_id}', to_jsonb(destino::text));
      if exists (select 1 from viajes where id = (viaje ->> 'id')::uuid)
         or (coalesce(viaje ->> 'uuid', '') <> '' and exists (select 1 from viajes where empresa_id = p_empresa and uuid::text = lower(viaje ->> 'uuid'))) then
        -- el viaje ya se volvió a registrar (p. ej. al subir el XML): se conserva ese y solo se liga a la factura
        update viajes set factura_id = destino
         where empresa_id = p_empresa and factura_id is null and uuid::text = lower(coalesce(viaje ->> 'uuid', ''));
        continue;
      end if;
      execute format('insert into viajes (%1$s) select %1$s from jsonb_populate_record(null::viajes, $1)', cols_v) using viaje;
      n_viajes := n_viajes + 1;
    end loop;

    update auditoria_eliminaciones set restaurada_at = now(), restaurada_por = p_usuario where id = a.id;
    insert into auditoria_eliminaciones (empresa_id, accion, referencia, resumen, usuario_id)
    values (p_empresa, 'factura_restaurada', a.referencia,
            jsonb_build_object('viajes', jsonb_array_length(coalesce(a.respaldo -> 'viajes', '[]'::jsonb)), 'total', a.resumen -> 'total', 'entrada_original', a.id),
            p_usuario);
    n_fact := n_fact + 1; folios := folios || a.referencia;
  end loop;
  return jsonb_build_object('facturas', n_fact, 'viajes', n_viajes, 'xml', n_xml, 'completadas', n_unidas, 'folios', to_jsonb(folios));
end;
$$;

revoke all on function public.fn_restaurar_facturas(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.fn_restaurar_facturas(uuid, uuid[], uuid) to service_role;

notify pgrst, 'reload schema';
