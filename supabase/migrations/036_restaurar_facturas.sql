-- Restaurar facturas eliminadas desde la bitácora de depuración. Idempotente. Requiere 017.
--  * Vuelve a insertar la factura, su XML guardado y sus viajes tal como estaban en el respaldo
--    (auditoria_eliminaciones.respaldo); los triggers devuelven los km a los tractos.
--  * La entrada original queda marcada como restaurada (no se puede restaurar dos veces) y se registra
--    una nueva entrada 'factura_restaurada'.
--  * Si un tracto, góndola, chofer, cliente o lugar al que apuntaba el respaldo ya no existe, la referencia
--    vuelve vacía en lugar de impedir la restauración.

alter table public.auditoria_eliminaciones add column if not exists restaurada_at timestamptz;
alter table public.auditoria_eliminaciones add column if not exists restaurada_por uuid;

-- Quita del registro las referencias (llaves foráneas de una sola columna) que ya no existen.
create or replace function public.fn_limpiar_referencias(p_tabla regclass, p_registro jsonb, p_conservar text[])
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  fk record; existe boolean; r jsonb := p_registro;
begin
  for fk in
    select a.attname as col, c.confrelid::regclass as tabla_ref, ra.attname as col_ref
      from pg_constraint c
      join pg_attribute a  on a.attrelid = c.conrelid  and a.attnum = c.conkey[1]
      join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
     where c.contype = 'f' and c.conrelid = p_tabla and cardinality(c.conkey) = 1
  loop
    continue when fk.col = any (p_conservar) or coalesce(r ->> fk.col, '') = '';
    execute format('select exists (select 1 from %s where %I::text = $1)', fk.tabla_ref, fk.col_ref) into existe using r ->> fk.col;
    if not existe then r := jsonb_set(r, array[fk.col], 'null'::jsonb); end if;
  end loop;
  return r;
end;
$$;

create or replace function public.fn_restaurar_facturas(p_empresa uuid, p_ids uuid[], p_usuario uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  a record; fac jsonb; sat jsonb; v jsonb; viaje jsonb;
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
    if exists (select 1 from facturas where id = fid)
       or exists (select 1 from facturas where empresa_id = p_empresa and folio = fac ->> 'folio')
       or (coalesce(fac ->> 'uuid', '') <> '' and exists (select 1 from facturas where empresa_id = p_empresa and uuid::text = fac ->> 'uuid')) then
      raise exception 'Ya existe una factura con el folio o UUID de % (¿se volvió a cargar?). Elimínala primero si quieres recuperar la del respaldo', a.referencia;
    end if;

    fac := fn_limpiar_referencias('public.facturas'::regclass, fac, array['empresa_id']);
    execute format('insert into facturas (%1$s) select %1$s from jsonb_populate_record(null::facturas, $1)', cols_f) using fac;

    sat := a.respaldo -> 'xml_sat';
    if sat is not null and sat <> 'null'::jsonb then
      execute format('insert into facturas_sat (%1$s) select %1$s from jsonb_populate_record(null::facturas_sat, $1) on conflict do nothing', cols_s) using sat;
      n_xml := n_xml + case when coalesce(sat ->> 'xml', '') <> '' then 1 else 0 end;
    end if;

    for v in select * from jsonb_array_elements(coalesce(a.respaldo -> 'viajes', '[]'::jsonb)) loop
      viaje := fn_limpiar_referencias('public.viajes'::regclass, v, array['empresa_id', 'factura_id']);
      if exists (select 1 from viajes where id = (viaje ->> 'id')::uuid) then continue; end if;
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
  return jsonb_build_object('facturas', n_fact, 'viajes', n_viajes, 'xml', n_xml, 'folios', to_jsonb(folios));
end;
$$;

revoke all on function public.fn_limpiar_referencias(regclass, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.fn_restaurar_facturas(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.fn_limpiar_referencias(regclass, jsonb, text[]) to service_role;
grant execute on function public.fn_restaurar_facturas(uuid, uuid[], uuid) to service_role;

notify pgrst, 'reload schema';
