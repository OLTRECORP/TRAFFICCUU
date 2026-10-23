-- Quitar, restaurar y corregir viajes importados del Excel de remisiones (p. ej. La Purísima) cuando hay duplicados
-- o errores. Idempotente. Requiere 017 y 022.
--  * Quitar un viaje lo borra (los triggers devuelven sus km al tracto), deja el respaldo en auditoria_eliminaciones
--    y anota su clave de importación en viajes_descartados para que reimportar el Excel NO lo vuelva a crear.
--  * Restaurar lo vuelve a insertar tal como estaba y quita la anotación.

create table if not exists public.viajes_descartados (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresa_configuracion (id) on delete cascade,
  cliente_id  uuid references public.clientes (id) on delete set null,
  import_key  text not null,
  remision    text,
  fecha       date,
  subtotal    numeric(14,2),
  motivo      text,
  respaldo    jsonb not null,
  usuario_id  uuid,
  created_at  timestamptz not null default now(),
  unique (empresa_id, import_key)
);
create index if not exists viajes_descartados_cliente_idx on public.viajes_descartados (cliente_id, fecha);
alter table public.viajes_descartados enable row level security;
drop policy if exists tenant_viajes_descartados_select on public.viajes_descartados;
create policy tenant_viajes_descartados_select on public.viajes_descartados
  for select to authenticated using (empresa_id = public.mi_empresa_id());
grant select on public.viajes_descartados to authenticated;

create or replace function public.fn_quitar_viajes_excel(p_empresa uuid, p_ids uuid[], p_motivo text, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v record;
  n int := 0; total numeric := 0;
begin
  if (select count(*) from viajes where empresa_id = p_empresa and id = any (p_ids) and origen_registro = 'excel') <> cardinality(p_ids) then
    raise exception 'Algún viaje no existe o no viene del Excel de remisiones (los viajes de un XML se eliminan con su factura)';
  end if;
  for v in select * from viajes where empresa_id = p_empresa and id = any (p_ids) order by fecha, id loop
    if v.import_key is not null then
      insert into viajes_descartados (empresa_id, cliente_id, import_key, remision, fecha, subtotal, motivo, respaldo, usuario_id)
      values (p_empresa, v.cliente_id, v.import_key, v.remision, (v.fecha at time zone 'UTC')::date, v.subtotal, nullif(btrim(p_motivo), ''), to_jsonb(v), p_usuario)
      on conflict (empresa_id, import_key) do update
        set respaldo = excluded.respaldo, motivo = excluded.motivo, subtotal = excluded.subtotal, usuario_id = excluded.usuario_id, created_at = now();
    end if;
    insert into auditoria_eliminaciones (empresa_id, accion, referencia, motivo, resumen, respaldo, usuario_id)
    values (p_empresa, 'viaje_excel_eliminado', coalesce('Rem. ' || v.remision, v.id::text), nullif(btrim(p_motivo), ''),
            jsonb_build_object('fecha', (v.fecha at time zone 'UTC')::date, 'subtotal', v.subtotal, 'cliente_id', v.cliente_id, 'factura', v.folio_factura),
            jsonb_build_object('viaje', to_jsonb(v)), p_usuario);
    delete from viajes where id = v.id;
    n := n + 1; total := total + coalesce(v.subtotal, 0);
  end loop;
  return jsonb_build_object('viajes', n, 'subtotal', total);
end;
$$;
revoke all on function public.fn_quitar_viajes_excel(uuid, uuid[], text, uuid) from public, anon, authenticated;
grant execute on function public.fn_quitar_viajes_excel(uuid, uuid[], text, uuid) to service_role;

create or replace function public.fn_restaurar_viajes_excel(p_empresa uuid, p_ids uuid[], p_usuario uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  d record;
  cols text;
  n int := 0;
begin
  if (select count(*) from viajes_descartados where empresa_id = p_empresa and id = any (p_ids)) <> cardinality(p_ids) then
    raise exception 'Algún viaje quitado ya no existe en la lista de descartados';
  end if;
  -- todas las columnas menos las generadas (km_operativos); los triggers recalculan los km efectivos
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns where table_schema = 'public' and table_name = 'viajes' and is_generated = 'NEVER';
  for d in select * from viajes_descartados where empresa_id = p_empresa and id = any (p_ids) order by fecha, id loop
    execute format('insert into viajes (%1$s) select %1$s from jsonb_populate_record(null::viajes, $1)', cols) using d.respaldo;
    -- si la factura a la que estaba ligado ya no existe, el viaje vuelve sin ligar
    update viajes set factura_id = null, folio_factura = null
     where id = (d.respaldo ->> 'id')::uuid and factura_id is not null and not exists (select 1 from facturas f where f.id = viajes.factura_id);
    insert into auditoria_eliminaciones (empresa_id, accion, referencia, resumen, usuario_id)
    values (p_empresa, 'viaje_excel_restaurado', coalesce('Rem. ' || d.remision, d.import_key),
            jsonb_build_object('fecha', d.fecha, 'subtotal', d.subtotal), p_usuario);
    delete from viajes_descartados where id = d.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('viajes', n);
end;
$$;
revoke all on function public.fn_restaurar_viajes_excel(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.fn_restaurar_viajes_excel(uuid, uuid[], uuid) to service_role;

notify pgrst, 'reload schema';
