-- Viajes manuales: un cliente nuevo con viajes distintos se captura a mano (origen_registro = 'manual'). Se tratan como
-- los del Excel de remisiones: se corrigen, se quitan (con respaldo) y cuentan en comisiones, km y ganancia; quedan sin
-- factura hasta ligarlos desde Facturas. Idempotente. Requiere 022 y 033.
alter table public.viajes drop constraint if exists viajes_origen_registro_chk;
alter table public.viajes add constraint viajes_origen_registro_chk check (origen_registro in ('xml', 'excel', 'manual'));

create or replace function public.fn_quitar_viajes_excel(p_empresa uuid, p_ids uuid[], p_motivo text, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v record;
  n int := 0; total numeric := 0;
begin
  if (select count(*) from viajes where empresa_id = p_empresa and id = any (p_ids) and origen_registro <> 'xml') <> cardinality(p_ids) then
    raise exception 'Algún viaje no existe o es de un XML (los viajes de un XML se eliminan con su factura)';
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
