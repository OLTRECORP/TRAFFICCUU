-- Choferes, tractocamiones y góndolas: ficha completa + ID de negocio (codigo).
-- Idempotente: se puede ejecutar varias veces en Supabase > SQL Editor.
--
-- Las tablas choferes, tractocamiones y gondolas ya existen (schema.sql) con RLS
-- "tenant_*" (empresa_id = mi_empresa_id()). Aquí solo se agregan columnas.
-- Liga con facturas y carta porte: viajes.chofer_id / tracto_id / gondola_id
-- (cada viaje = un CFDI con Carta Porte) y viajes.folio_factura = facturas.folio.

-- 1. Columnas nuevas ----------------------------------------------------
alter table public.choferes
  add column if not exists codigo            text,
  add column if not exists curp              text,
  add column if not exists telefono          text,
  add column if not exists licencia_tipo     text,
  add column if not exists licencia_vigencia date,
  add column if not exists activo            boolean not null default true,
  add column if not exists notas             text,
  add column if not exists created_at        timestamptz not null default now(),
  add column if not exists updated_at        timestamptz not null default now();

alter table public.tractocamiones
  add column if not exists codigo             text,
  add column if not exists numero_economico   text,
  add column if not exists marca              text,
  add column if not exists anio               integer check (anio between 1950 and 2100),
  add column if not exists num_serie          text,
  add column if not exists config_vehicular   text,   -- c_ConfigAutotransporte (ej. T3S2)
  add column if not exists tipo_permiso_sct   text,   -- c_TipoPermiso (ej. TPAF01)
  add column if not exists num_permiso_sct    text,
  add column if not exists aseguradora        text,
  add column if not exists poliza_seguro      text,
  add column if not exists seguro_vigencia    date,
  add column if not exists activo             boolean not null default true,
  add column if not exists notas              text,
  add column if not exists created_at         timestamptz not null default now(),
  add column if not exists updated_at         timestamptz not null default now();

alter table public.gondolas
  add column if not exists codigo             text,
  add column if not exists numero_economico   text,
  add column if not exists marca              text,
  add column if not exists modelo             text,
  add column if not exists anio               integer check (anio between 1950 and 2100),
  add column if not exists num_serie          text,
  add column if not exists tipo_permiso_sct   text,
  add column if not exists num_permiso_sct    text,
  add column if not exists aseguradora        text,
  add column if not exists poliza_seguro      text,
  add column if not exists seguro_vigencia    date,
  add column if not exists activo             boolean not null default true,
  add column if not exists notas              text,
  add column if not exists created_at         timestamptz not null default now(),
  add column if not exists updated_at         timestamptz not null default now();

-- 2. ID de negocio por empresa: CHO-0001, TRC-0001, GON-0001 ------------
create or replace function public.fn_asignar_codigo()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  prefijo text := tg_argv[0];
  siguiente integer;
begin
  if tg_op = 'UPDATE' then
    if old.codigo is not null then
      new.codigo := old.codigo;                     -- el ID nunca cambia
    end if;
    return new;
  end if;
  if new.codigo is null or new.codigo = '' then
    perform pg_advisory_xact_lock(hashtext(new.empresa_id::text || prefijo));
    execute format(
      'select coalesce(max(substring(codigo from ''[0-9]+$'')::integer), 0) + 1 from public.%I where empresa_id = $1 and codigo ~ ''^%s-[0-9]+$''',
      tg_table_name, prefijo)
      into siguiente using new.empresa_id;
    new.codigo := prefijo || '-' || lpad(siguiente::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_choferes_codigo on public.choferes;
create trigger trg_choferes_codigo before insert or update on public.choferes
for each row execute function public.fn_asignar_codigo('CHO');
drop trigger if exists trg_tractos_codigo on public.tractocamiones;
create trigger trg_tractos_codigo before insert or update on public.tractocamiones
for each row execute function public.fn_asignar_codigo('TRC');
drop trigger if exists trg_gondolas_codigo on public.gondolas;
create trigger trg_gondolas_codigo before insert or update on public.gondolas
for each row execute function public.fn_asignar_codigo('GON');

-- 3. Asigna ID a los registros existentes (los creados desde XML) -------
do $$
declare t record; r record; n integer;
begin
  for t in select * from (values ('choferes','CHO'),('tractocamiones','TRC'),('gondolas','GON')) as x(tabla, pref) loop
    for r in execute format('select distinct empresa_id from public.%I where codigo is null', t.tabla) loop
      execute format('select coalesce(max(substring(codigo from ''[0-9]+$'')::integer), 0) from public.%I where empresa_id = $1 and codigo is not null', t.tabla)
        into n using r.empresa_id;
      execute format(
        'with sin as (select id, row_number() over (order by id) rn from public.%I where empresa_id = $1 and codigo is null)
         update public.%I c set codigo = %L || ''-'' || lpad(($2 + sin.rn)::text, 4, ''0'') from sin where c.id = sin.id',
        t.tabla, t.tabla, t.pref) using r.empresa_id, n;
    end loop;
  end loop;
end $$;

alter table public.choferes       alter column codigo set not null;
alter table public.tractocamiones alter column codigo set not null;
alter table public.gondolas       alter column codigo set not null;

create unique index if not exists choferes_codigo_uk       on public.choferes (empresa_id, codigo);
create unique index if not exists tractocamiones_codigo_uk on public.tractocamiones (empresa_id, codigo);
create unique index if not exists gondolas_codigo_uk       on public.gondolas (empresa_id, codigo);

-- 4. updated_at ------------------------------------------------------------
drop trigger if exists trg_choferes_updated_at on public.choferes;
create trigger trg_choferes_updated_at before update on public.choferes
for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_tractos_updated_at on public.tractocamiones;
create trigger trg_tractos_updated_at before update on public.tractocamiones
for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_gondolas_updated_at on public.gondolas;
create trigger trg_gondolas_updated_at before update on public.gondolas
for each row execute function public.fn_set_updated_at();

-- 5. Índices para consultar viajes (carta porte) por chofer/unidad ---------
create index if not exists viajes_chofer_idx  on public.viajes (chofer_id);
create index if not exists viajes_gondola_idx on public.viajes (gondola_id);
create index if not exists viajes_folio_idx   on public.viajes (empresa_id, folio_factura);

-- 6. RLS: ya habilitado con políticas tenant_* para ALL (schema.sql); se
--    recrean aquí por si faltaran en bases antiguas.
alter table public.choferes       enable row level security;
alter table public.tractocamiones enable row level security;
alter table public.gondolas       enable row level security;

drop policy if exists tenant_choferes on public.choferes;
create policy tenant_choferes on public.choferes for all to authenticated
  using (empresa_id = public.mi_empresa_id()) with check (empresa_id = public.mi_empresa_id());
drop policy if exists tenant_tractocamiones on public.tractocamiones;
create policy tenant_tractocamiones on public.tractocamiones for all to authenticated
  using (empresa_id = public.mi_empresa_id()) with check (empresa_id = public.mi_empresa_id());
drop policy if exists tenant_gondolas on public.gondolas;
create policy tenant_gondolas on public.gondolas for all to authenticated
  using (empresa_id = public.mi_empresa_id()) with check (empresa_id = public.mi_empresa_id());

grant select, insert, update, delete on public.choferes, public.tractocamiones, public.gondolas to authenticated;

notify pgrst, 'reload schema';
