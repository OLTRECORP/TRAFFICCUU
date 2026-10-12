-- Descarga masiva de XML del SAT, complementos de pago, orígenes/destinos con distancias y
-- estadísticas del dashboard (facturas con complemento = pagadas). Idempotente.

-- 1. Corridas de descarga masiva (el backend escribe, el portal lee el avance) --------
create table if not exists public.sat_descargas (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references public.empresa_configuracion (id) on delete cascade,
  modo               text not null check (modo in ('anio', 'faltantes')),
  anio               integer not null,
  meses              integer[] not null default '{}',     -- meses (1-12) que se piden al SAT
  estado             text not null default 'pendiente' check (estado in ('pendiente', 'en_proceso', 'ok', 'error')),
  detalle            jsonb not null default '[]'::jsonb,  -- una entrada por mes: estado, xml recibidos, mensaje
  xml_recibidos      integer not null default 0,
  facturas_asignadas integer not null default 0,
  complementos       integer not null default 0,
  sin_asignar        jsonb not null default '[]'::jsonb,  -- XML emitidos que no corresponden a ninguna factura
  error              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists sat_descargas_empresa_idx on public.sat_descargas (empresa_id, created_at desc);

drop trigger if exists trg_sat_descargas_updated_at on public.sat_descargas;
create trigger trg_sat_descargas_updated_at before update on public.sat_descargas
for each row execute function public.fn_set_updated_at();

-- 2. Complementos de pago (CFDI tipo P) y los documentos que pagan -------------------
create table if not exists public.complementos_pago (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresa_configuracion (id) on delete cascade,
  uuid           uuid not null,
  serie          text,
  folio          text,
  fecha_emision  timestamptz,
  fecha_pago     date,
  monto          numeric(14,2),
  datos          jsonb,
  xml            text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (empresa_id, uuid)
);

-- Un complemento paga varios documentos (facturas). Se liga a la factura por UUID, así que el
-- vínculo se resuelve solo aunque la factura se importe del Excel después que el complemento.
create table if not exists public.complemento_pago_documentos (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresa_configuracion (id) on delete cascade,
  complemento_id   uuid not null references public.complementos_pago (id) on delete cascade,
  uuid_documento   uuid not null,
  parcialidad      integer,
  imp_pagado       numeric(14,2),
  unique (complemento_id, uuid_documento)
);
create index if not exists comp_pago_doc_uuid_idx on public.complemento_pago_documentos (empresa_id, uuid_documento);

drop trigger if exists trg_complementos_pago_updated_at on public.complementos_pago;
create trigger trg_complementos_pago_updated_at before update on public.complementos_pago
for each row execute function public.fn_set_updated_at();

-- Complemento -> factura -> orden de compra
create or replace view public.complementos_pago_facturas with (security_invoker = true) as
select d.empresa_id, d.complemento_id, d.uuid_documento, d.parcialidad, d.imp_pagado,
       f.id as factura_id, f.folio, f.orden_compra
from public.complemento_pago_documentos d
left join public.facturas f on f.empresa_id = d.empresa_id and f.uuid = d.uuid_documento;

-- 3. Orígenes y destinos y distancia entre ellos -------------------------------------
create table if not exists public.lugares (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresa_configuracion (id) on delete cascade,
  nombre      text not null,                              -- nombre o referencia (ej. "Planta Chihuahua")
  tipo        text not null default 'ambos' check (tipo in ('origen', 'destino', 'ambos')),
  direccion   text,
  referencia  text,
  lat         numeric(9,6),
  lng         numeric(9,6),
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (empresa_id, nombre)
);

-- Distancia por carretera de ida entre dos lugares (caché: se calcula una vez con el mapa).
create table if not exists public.rutas (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresa_configuracion (id) on delete cascade,
  origen_id    uuid not null references public.lugares (id) on delete cascade,
  destino_id   uuid not null references public.lugares (id) on delete cascade,
  distancia_km numeric(10,2) not null check (distancia_km >= 0),
  fuente       text not null default 'osrm',
  calculada_en timestamptz not null default now(),
  unique (empresa_id, origen_id, destino_id)
);

drop trigger if exists trg_lugares_updated_at on public.lugares;
create trigger trg_lugares_updated_at before update on public.lugares
for each row execute function public.fn_set_updated_at();

-- El viaje (uno por factura) apunta a su origen y destino; km operativos = ida x 2 (redondo).
alter table public.viajes
  add column if not exists lugar_origen_id  uuid references public.lugares (id) on delete set null,
  add column if not exists lugar_destino_id uuid references public.lugares (id) on delete set null,
  add column if not exists distancia_mapa_km numeric(10,2),
  add column if not exists km_operativos numeric(10,2) generated always as (distancia_mapa_km * 2) stored;

-- Si cambia la ubicación de un lugar (o se borra), sus distancias guardadas dejan de valer.
create or replace function public.fn_lugar_invalida_rutas()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' or new.lat is distinct from old.lat or new.lng is distinct from old.lng then
    delete from public.rutas where origen_id = old.id or destino_id = old.id;
    update public.viajes set distancia_mapa_km = null
     where lugar_origen_id = old.id or lugar_destino_id = old.id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists trg_lugar_invalida_rutas on public.lugares;
create trigger trg_lugar_invalida_rutas before update or delete on public.lugares
for each row execute function public.fn_lugar_invalida_rutas();

-- 4. RLS: lectura/escritura por empresa para catálogos; el resto solo lectura -------
alter table public.sat_descargas               enable row level security;
alter table public.complementos_pago           enable row level security;
alter table public.complemento_pago_documentos enable row level security;
alter table public.lugares                     enable row level security;
alter table public.rutas                       enable row level security;

drop policy if exists tenant_sat_descargas_select on public.sat_descargas;
create policy tenant_sat_descargas_select on public.sat_descargas
  for select to authenticated using (empresa_id = public.mi_empresa_id());
drop policy if exists tenant_complementos_select on public.complementos_pago;
create policy tenant_complementos_select on public.complementos_pago
  for select to authenticated using (empresa_id = public.mi_empresa_id());
drop policy if exists tenant_comp_docs_select on public.complemento_pago_documentos;
create policy tenant_comp_docs_select on public.complemento_pago_documentos
  for select to authenticated using (empresa_id = public.mi_empresa_id());

drop policy if exists tenant_lugares on public.lugares;
create policy tenant_lugares on public.lugares for all to authenticated
  using (empresa_id = public.mi_empresa_id()) with check (empresa_id = public.mi_empresa_id());
drop policy if exists tenant_rutas on public.rutas;
create policy tenant_rutas on public.rutas for all to authenticated
  using (empresa_id = public.mi_empresa_id()) with check (empresa_id = public.mi_empresa_id());

grant select on public.sat_descargas, public.complementos_pago, public.complemento_pago_documentos,
  public.complementos_pago_facturas to authenticated;
grant select, insert, update, delete on public.lugares, public.rutas to authenticated;

-- 5. XML pendientes por mes de emisión (facturas vigentes sin XML del SAT) -------------
create or replace view public.facturas_xml_por_mes with (security_invoker = true) as
select f.empresa_id,
       extract(year from f.fecha_emision)::int  as anio,
       extract(month from f.fecha_emision)::int as mes,
       count(*)                                 as total,
       count(*) filter (where s.estado = 'ok' and s.xml is not null) as con_xml
from public.facturas f
left join public.facturas_sat s on s.factura_id = f.id
where f.fecha_emision is not null and f.estado is distinct from 'cancelado'
group by f.empresa_id, 2, 3;

-- 6. Dashboard: una factura con complemento (Excel o XML del SAT) cuenta como pagada ---
drop view if exists public.facturas_estadisticas;
create view public.facturas_estadisticas with (security_invoker = true) as
select empresa_id,
       coalesce(estado, 'sin estado')             as estado,
       coalesce(complemento, 'SIN COMPLEMENTO')   as complemento,
       (orden_compra is not null)                 as con_orden,
       con_complemento,
       count(*)                                   as n,
       coalesce(sum(total), 0)                    as total
from (
  select f.*,
         (coalesce(f.complemento = 'COMPLEMENTO LISTO', false) or exists (
            select 1 from public.complemento_pago_documentos d
            where d.empresa_id = f.empresa_id and d.uuid_documento = f.uuid)) as con_complemento
  from public.facturas f
) x
group by empresa_id, 2, 3, 4, con_complemento;

create or replace view public.facturas_por_dia with (security_invoker = true) as
select empresa_id, fecha_emision as dia, count(*) as n, coalesce(sum(total), 0) as total
from public.facturas
where fecha_emision is not null and estado is distinct from 'cancelado'
group by empresa_id, fecha_emision;

grant select on public.facturas_xml_por_mes, public.facturas_estadisticas, public.facturas_por_dia to authenticated;

notify pgrst, 'reload schema';
