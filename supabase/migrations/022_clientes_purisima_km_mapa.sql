-- Clientes (tasa de comisión, km por mapa, factura semanal), tarifas por ruta, viajes importados desde Excel
-- (p. ej. remisiones de Pétreos La Purísima) y km efectivos por mapa. Requiere 004-021. Idempotente.
--
--  * Un viaje puede venir de un XML (Carta Porte, un viaje por factura) o de un Excel de remisiones (sin XML:
--    cada renglón es un viaje y una factura semanal agrupa los viajes de lunes a domingo).
--  * Km efectivos del viaje (distancia_operativa): ida del XML x 2; si el cliente usa «km por mapa» y el viaje
--    ya tiene distancia por mapa, ida por mapa x 2. El tracto suma/resta la diferencia cuando cambian.
--  * Comisión del chofer por viaje: % de la tarifa de la ruta (excepción) o % del cliente, o 12 %.

-- 1. Clientes ------------------------------------------------------------------------------------------------------
create table if not exists public.clientes (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresa_configuracion (id) on delete cascade,
  nombre           text not null,
  rfc              text,                                   -- RFC receptor de sus facturas
  alias            text[] not null default '{}',           -- otros nombres con que aparece (XML o Excel)
  comision_pct     numeric(5,2) not null default 12 check (comision_pct between 0 and 100),
  km_por_mapa      boolean not null default false,         -- km de sus viajes = distancia por mapa (no la del XML)
  factura_semanal  boolean not null default false,         -- una factura agrupa sus viajes de lunes a domingo
  notas            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (empresa_id, nombre)
);

drop trigger if exists trg_clientes_updated_at on public.clientes;
create trigger trg_clientes_updated_at before update on public.clientes
for each row execute function public.fn_set_updated_at();

alter table public.clientes enable row level security;
drop policy if exists tenant_clientes on public.clientes;
create policy tenant_clientes on public.clientes for all to authenticated
  using (empresa_id = public.mi_empresa_id()) with check (empresa_id = public.mi_empresa_id());
grant select, insert, update, delete on public.clientes to authenticated;

-- 2. Lugares: alias y si se pueden ubicar solos por su nombre -------------------------------------------------------
alter table public.lugares
  add column if not exists alias       text[] not null default '{}',
  add column if not exists auto_ubicar boolean not null default true;   -- false: el nombre no basta (ej. «COX»), se marca a mano

-- 3. Tarifas por ruta y cliente (hoja PRECIOS) ---------------------------------------------------------------------
create table if not exists public.tarifas (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresa_configuracion (id) on delete cascade,
  cliente_id    uuid not null references public.clientes (id) on delete cascade,
  origen_id     uuid not null references public.lugares (id) on delete cascade,
  destino_id    uuid not null references public.lugares (id) on delete cascade,
  precio        numeric(12,2) not null check (precio >= 0),
  unidad        text not null default 'M3',
  comision_pct  numeric(5,2) check (comision_pct is null or comision_pct between 0 and 100),   -- excepción de la ruta
  notas         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (cliente_id, origen_id, destino_id)
);

drop trigger if exists trg_tarifas_updated_at on public.tarifas;
create trigger trg_tarifas_updated_at before update on public.tarifas
for each row execute function public.fn_set_updated_at();

alter table public.tarifas enable row level security;
drop policy if exists tenant_tarifas on public.tarifas;
create policy tenant_tarifas on public.tarifas for all to authenticated
  using (empresa_id = public.mi_empresa_id()) with check (empresa_id = public.mi_empresa_id());
grant select, insert, update, delete on public.tarifas to authenticated;

-- 4. Viajes: los del Excel no tienen UUID; datos de la remisión ----------------------------------------------------
alter table public.viajes alter column uuid drop not null;
alter table public.viajes drop constraint if exists viajes_distancia_operativa_chk;   -- ahora puede venir del mapa
alter table public.viajes
  add column if not exists cliente_id      uuid references public.clientes (id) on delete set null,
  add column if not exists km_por_mapa     boolean not null default false,
  add column if not exists origen_registro text not null default 'xml',
  add column if not exists remision        text,
  add column if not exists material        text,
  add column if not exists cantidad        numeric(12,3),
  add column if not exists unidad          text,
  add column if not exists precio_unitario numeric(12,2),
  add column if not exists import_key      text;
alter table public.viajes drop constraint if exists viajes_origen_registro_chk;
alter table public.viajes add constraint viajes_origen_registro_chk check (origen_registro in ('xml', 'excel'));
alter table public.viajes drop constraint if exists viajes_import_key_uk;
alter table public.viajes add constraint viajes_import_key_uk unique (empresa_id, import_key);   -- reimportar no duplica
create index if not exists viajes_cliente_fecha_idx on public.viajes (cliente_id, fecha);

-- 5. Km efectivos y su efecto en el odómetro del tracto ------------------------------------------------------------
create or replace function public.fn_viaje_km_efectivo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.km_por_mapa := coalesce((select c.km_por_mapa from clientes c where c.id = new.cliente_id), false);
  new.distancia_operativa := round(
    case when new.km_por_mapa and new.distancia_mapa_km is not null then new.distancia_mapa_km * 2
         else coalesce(new.distancia_xml, 0) * 2 end, 2);
  return new;
end;
$$;
drop trigger if exists trg_viaje_km_efectivo on public.viajes;
create trigger trg_viaje_km_efectivo before insert or update on public.viajes
for each row execute function public.fn_viaje_km_efectivo();

-- El insert ya suma (trg_viaje_suma_kilometraje) y el delete resta; aquí solo el cambio de km de un viaje existente.
-- No reacciona a mover el viaje de tracto (la unificación de unidades ya hace sus propias cuentas).
create or replace function public.fn_viaje_ajusta_kilometraje()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.tracto_id is not null then
    update tractocamiones set kilometraje_actual = greatest(0, kilometraje_actual - old.distancia_operativa)
     where id = old.tracto_id and empresa_id = old.empresa_id;
  end if;
  if new.tracto_id is not null then
    update tractocamiones set kilometraje_actual = kilometraje_actual + new.distancia_operativa
     where id = new.tracto_id and empresa_id = new.empresa_id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_viaje_ajusta_kilometraje on public.viajes;
create trigger trg_viaje_ajusta_kilometraje after update on public.viajes
for each row when (old.distancia_operativa is distinct from new.distancia_operativa)
execute function public.fn_viaje_ajusta_kilometraje();

-- Cambiar «km por mapa» de un cliente recalcula los km de todos sus viajes.
create or replace function public.fn_cliente_recalcula_km()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update viajes set km_por_mapa = new.km_por_mapa where cliente_id = new.id and empresa_id = new.empresa_id;
  return new;
end;
$$;
drop trigger if exists trg_cliente_recalcula_km on public.clientes;
create trigger trg_cliente_recalcula_km after update on public.clientes
for each row when (old.km_por_mapa is distinct from new.km_por_mapa)
execute function public.fn_cliente_recalcula_km();

-- 6. Clientes existentes: los nombres de cliente de los destinos (Carta Porte) ------------------------------------
insert into public.clientes (empresa_id, nombre)
select distinct l.empresa_id, btrim(l.cliente)
  from public.lugares l
 where l.cliente is not null and btrim(l.cliente) <> ''
on conflict (empresa_id, nombre) do nothing;

update public.viajes v
   set cliente_id = c.id
  from public.lugares l
  join public.clientes c on c.empresa_id = l.empresa_id and c.nombre = btrim(l.cliente)
 where v.lugar_destino_id = l.id and v.cliente_id is null;

-- Triturados Roca: sus km salen del mapa (comisión 12 %, la general).
update public.clientes set km_por_mapa = true
 where upper(nombre) like '%TRITURADOS ROCA%' and not km_por_mapa;

-- 7. Comisiones: tasa por viaje, remisión y cliente ----------------------------------------------------------------
create or replace view public.comisiones_viajes with (security_invoker = true) as
select v.id                                   as viaje_id,
       v.empresa_id,
       v.chofer_id,
       v.factura_id,
       coalesce(f.folio, v.folio_factura)     as folio,
       (coalesce(v.fecha_salida, v.fecha) at time zone 'UTC')::date as fecha_viaje,
       v.subtotal,
       v.total,
       f.estado                               as estado_factura,
       coalesce(lo.nombre, uo.nombre, nullif(concat_ws(', ', uo.municipio, uo.estado), '')) as origen,
       coalesce(ld.nombre, ud.nombre, nullif(concat_ws(', ', ud.municipio, ud.estado), '')) as destino,
       coalesce(c.nombre, ld.cliente)         as cliente,
       v.remision,
       coalesce(t.comision_pct, c.comision_pct, 12) as tasa_comision,
       v.cliente_id,
       v.material
from public.viajes v
left join public.facturas    f  on f.id  = v.factura_id
left join public.lugares     lo on lo.id = v.lugar_origen_id
left join public.lugares     ld on ld.id = v.lugar_destino_id
left join public.ubicaciones uo on uo.id = v.origen_id
left join public.ubicaciones ud on ud.id = v.destino_id
left join public.clientes    c  on c.id  = v.cliente_id
left join public.tarifas     t  on t.cliente_id = v.cliente_id and t.origen_id = v.lugar_origen_id and t.destino_id = v.lugar_destino_id
where f.estado is distinct from 'cancelado';

grant select on public.comisiones_viajes to authenticated;

-- 8. Eliminar facturas: solo borra los viajes que nacieron de su XML; los del Excel quedan sin factura ---------------
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
    'viajes',         (select count(*) from viajes v where v.empresa_id = p_empresa and v.factura_id = any (p_ids) and v.origen_registro = 'xml'),
    'viajes_desligados', (select count(*) from viajes v where v.empresa_id = p_empresa and v.factura_id = any (p_ids) and v.origen_registro <> 'xml'),
    'km_a_restar',    (select coalesce(sum(v.distancia_operativa), 0) from viajes v where v.empresa_id = p_empresa and v.factura_id = any (p_ids) and v.origen_registro = 'xml'),
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
                         'viajes', (select count(*) from viajes v where v.factura_id = f.id and v.origen_registro = 'xml'),
                         'viajes_desligados', (select count(*) from viajes v where v.factura_id = f.id and v.origen_registro <> 'xml')),
      jsonb_build_object('factura', to_jsonb(f),
                         'xml_sat', (select to_jsonb(s) from facturas_sat s where s.factura_id = f.id),
                         'viajes', (select coalesce(jsonb_agg(to_jsonb(v)), '[]') from viajes v where v.factura_id = f.id)),
      p_usuario);
    -- el viaje del XML nace de la factura: se borra (el trigger devuelve sus km al tracto)
    delete from viajes where factura_id = f.id and empresa_id = p_empresa and origen_registro = 'xml';
    get diagnostics k = row_count; n_viajes := n_viajes + k;
    -- los viajes del Excel existen sin factura: quedan sin ligar
    update viajes set factura_id = null, folio_factura = null
     where factura_id = f.id and empresa_id = p_empresa and origen_registro <> 'xml';
    select count(*) into k from facturas_sat where factura_id = f.id and xml is not null; n_xml := n_xml + k;
    delete from facturas where id = f.id and empresa_id = p_empresa;          -- facturas_sat se va por cascade
    n_fact := n_fact + 1;
  end loop;
  return jsonb_build_object('facturas', n_fact, 'viajes', n_viajes, 'xml', n_xml);
end;
$$;
revoke all on function public.fn_eliminar_facturas(uuid, uuid[], text, uuid) from public, anon, authenticated;
grant execute on function public.fn_eliminar_facturas(uuid, uuid[], text, uuid) to service_role;

notify pgrst, 'reload schema';
