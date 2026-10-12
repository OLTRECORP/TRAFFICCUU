-- =====================================================================
-- ERP Logístico Multitenant (México) — Esquema Supabase / PostgreSQL
-- Ejecutar completo en: Supabase Dashboard > SQL Editor
--
-- Modelo multitenant: 1 usuario (auth.uid()) = 1 empresa. Todas las tablas
-- de negocio llevan empresa_id y RLS lo compara contra mi_empresa_id().
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. Empresa (tenant)
-- ---------------------------------------------------------------------
create table public.empresa_configuracion (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null unique references auth.users (id) on delete cascade,
  rfc             text not null check (rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  razon_social    text not null,
  regimen_fiscal  text not null,                -- clave c_RegimenFiscal (ej. 601)
  cer_path        text,                         -- ruta en Storage (bucket "fiel")
  key_path        text,
  password_sat    text,                         -- cifrado con Fernet por el backend; nunca legible desde el cliente
  logo_path       text,                         -- ruta en Storage (bucket público "logos")
  color_primario  text not null default '#0f5c80' check (color_primario ~ '^#[0-9a-fA-F]{6}$'),
  color_base      text not null default '#d8e9f0' check (color_base ~ '^#[0-9a-fA-F]{6}$'),
  color_acento    text not null default '#f06000' check (color_acento ~ '^#[0-9a-fA-F]{6}$'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Helper: empresa del usuario autenticado (SECURITY DEFINER evita recursión de RLS)
create or replace function public.mi_empresa_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.empresa_configuracion where user_id = auth.uid() limit 1
$$;

-- ---------------------------------------------------------------------
-- 2. Catálogos operativos
-- ---------------------------------------------------------------------
create table public.tractocamiones (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references public.empresa_configuracion (id) on delete cascade,
  placa               text not null,
  modelo              text,
  kilometraje_inicial numeric(12,2) not null default 0 check (kilometraje_inicial >= 0),
  kilometraje_actual  numeric(12,2) not null default 0 check (kilometraje_actual >= 0),
  unique (empresa_id, placa)
);

create table public.gondolas (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresa_configuracion (id) on delete cascade,
  placa       text not null,
  subtipo     text,                              -- ej. CTR_011 (c_SubTipoRem)
  unique (empresa_id, placa)
);

create table public.choferes (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresa_configuracion (id) on delete cascade,
  rfc         text not null,
  nombre      text not null,
  licencia    text,
  unique (empresa_id, rfc)
);

-- Ubicaciones de Carta Porte (IDUbicacion: OR000001 / DE000001) referenciadas por origen_id / destino_id
create table public.ubicaciones (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresa_configuracion (id) on delete cascade,
  id_ubicacion  text not null,                   -- IDUbicacion del XML
  nombre        text,
  municipio     text,
  estado        text,
  unique (empresa_id, id_ubicacion)
);

-- ---------------------------------------------------------------------
-- 3. Viajes
-- ---------------------------------------------------------------------
create table public.viajes (
  id                   uuid primary key default gen_random_uuid(),
  empresa_id           uuid not null references public.empresa_configuracion (id) on delete cascade,
  folio_factura        text,
  uuid                 uuid not null,            -- UUID del CFDI (TimbreFiscalDigital)
  origen_id            uuid references public.ubicaciones (id),
  destino_id           uuid references public.ubicaciones (id),
  distancia_xml        numeric(12,2) not null default 0 check (distancia_xml >= 0),       -- ida (suma de DistanciaRecorrida)
  distancia_operativa  numeric(12,2) not null default 0,                                  -- viaje redondo = ida * 2
  tracto_id            uuid references public.tractocamiones (id),
  gondola_id           uuid references public.gondolas (id),
  chofer_id            uuid references public.choferes (id),
  rfc_emisor           text,
  rfc_receptor         text,
  subtotal             numeric(14,2) not null default 0,
  total                numeric(14,2) not null default 0,
  fecha                timestamptz not null,
  created_at           timestamptz not null default now(),
  constraint viajes_distancia_operativa_chk check (distancia_operativa = distancia_xml * 2),
  unique (empresa_id, uuid)                       -- evita procesar dos veces el mismo CFDI
);

create index viajes_empresa_fecha_idx on public.viajes (empresa_id, fecha desc);
create index viajes_tracto_idx        on public.viajes (tracto_id);

-- ---------------------------------------------------------------------
-- 4. Mantenimiento
-- ---------------------------------------------------------------------
create table public.reglas_mantenimiento (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresa_configuracion (id) on delete cascade,
  tipo_servicio  text not null,                  -- Aceite, Balatas, ...
  intervalo_km   integer not null check (intervalo_km > 0),
  unique (empresa_id, tipo_servicio)
);

create table public.bitacora_mantenimiento (
  id                     uuid primary key default gen_random_uuid(),
  empresa_id             uuid not null references public.empresa_configuracion (id) on delete cascade,
  tracto_id              uuid not null references public.tractocamiones (id) on delete cascade,
  servicio_id            uuid not null references public.reglas_mantenimiento (id) on delete restrict,
  kilometraje_al_servicio numeric(12,2) not null check (kilometraje_al_servicio >= 0),
  fecha                  date not null default current_date,
  observaciones          text
);

create index bitacora_tracto_servicio_idx on public.bitacora_mantenimiento (tracto_id, servicio_id);

-- ---------------------------------------------------------------------
-- 5. Triggers
-- ---------------------------------------------------------------------

-- 5.1 Al insertar un viaje: suma distancia_operativa al kilometraje_actual del tracto.
create or replace function public.fn_viaje_suma_kilometraje()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tracto_id is not null then
    update public.tractocamiones
       set kilometraje_actual = kilometraje_actual + new.distancia_operativa
     where id = new.tracto_id
       and empresa_id = new.empresa_id;   -- nunca tocar tractos de otro tenant
  end if;
  return new;
end;
$$;

create trigger trg_viaje_suma_kilometraje
after insert on public.viajes
for each row execute function public.fn_viaje_suma_kilometraje();

-- 5.2 updated_at de empresa_configuracion
create or replace function public.fn_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_empresa_updated_at
before update on public.empresa_configuracion
for each row execute function public.fn_set_updated_at();

-- 5.3 Reglas de mantenimiento por defecto al crear la empresa
create or replace function public.fn_empresa_reglas_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.reglas_mantenimiento (empresa_id, tipo_servicio, intervalo_km) values
    (new.id, 'Aceite',  20000),
    (new.id, 'Balatas', 60000),
    (new.id, 'Llantas', 120000)
  on conflict (empresa_id, tipo_servicio) do nothing;
  return new;
end;
$$;

create trigger trg_empresa_reglas_default
after insert on public.empresa_configuracion
for each row execute function public.fn_empresa_reglas_default();

-- ---------------------------------------------------------------------
-- 6. Row Level Security
-- ---------------------------------------------------------------------
alter table public.empresa_configuracion  enable row level security;
alter table public.tractocamiones         enable row level security;
alter table public.gondolas               enable row level security;
alter table public.choferes               enable row level security;
alter table public.ubicaciones            enable row level security;
alter table public.viajes                 enable row level security;
alter table public.reglas_mantenimiento   enable row level security;
alter table public.bitacora_mantenimiento enable row level security;

create policy empresa_select_own on public.empresa_configuracion
  for select to authenticated using (user_id = auth.uid());
create policy empresa_insert_own on public.empresa_configuracion
  for insert to authenticated with check (user_id = auth.uid());
create policy empresa_update_own on public.empresa_configuracion
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy empresa_delete_own on public.empresa_configuracion
  for delete to authenticated using (user_id = auth.uid());

create policy tenant_tractocamiones on public.tractocamiones
  for all to authenticated
  using (empresa_id = public.mi_empresa_id())
  with check (empresa_id = public.mi_empresa_id());

create policy tenant_gondolas on public.gondolas
  for all to authenticated
  using (empresa_id = public.mi_empresa_id())
  with check (empresa_id = public.mi_empresa_id());

create policy tenant_choferes on public.choferes
  for all to authenticated
  using (empresa_id = public.mi_empresa_id())
  with check (empresa_id = public.mi_empresa_id());

create policy tenant_ubicaciones on public.ubicaciones
  for all to authenticated
  using (empresa_id = public.mi_empresa_id())
  with check (empresa_id = public.mi_empresa_id());

create policy tenant_viajes on public.viajes
  for all to authenticated
  using (empresa_id = public.mi_empresa_id())
  with check (empresa_id = public.mi_empresa_id());

create policy tenant_reglas on public.reglas_mantenimiento
  for all to authenticated
  using (exists (select 1 from public.empresa_configuracion e
                 where e.id = empresa_id and e.user_id = auth.uid()))
  with check (exists (select 1 from public.empresa_configuracion e
                      where e.id = empresa_id and e.user_id = auth.uid()));

create policy tenant_bitacora on public.bitacora_mantenimiento
  for all to authenticated
  using (empresa_id = public.mi_empresa_id())
  with check (empresa_id = public.mi_empresa_id());

-- password_sat: el cliente no puede leerlo ni escribirlo (solo el backend con service_role).
revoke all on public.empresa_configuracion from anon, authenticated;
grant select (id, user_id, rfc, razon_social, regimen_fiscal, cer_path, key_path, logo_path, color_primario, color_base, color_acento, created_at, updated_at)
  on public.empresa_configuracion to authenticated;
grant insert (user_id, rfc, razon_social, regimen_fiscal, cer_path, key_path, logo_path, color_primario, color_base, color_acento)
  on public.empresa_configuracion to authenticated;
grant update (rfc, razon_social, regimen_fiscal, cer_path, key_path, logo_path, color_primario, color_base, color_acento)
  on public.empresa_configuracion to authenticated;

-- ---------------------------------------------------------------------
-- 7. Storage: bucket privado "fiel" (.cer / .key), carpeta = auth.uid()
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('fiel', 'fiel', false)
on conflict (id) do nothing;

create policy fiel_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'fiel' and (storage.foldername(name))[1] = auth.uid()::text);

create policy fiel_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fiel' and (storage.foldername(name))[1] = auth.uid()::text);

create policy fiel_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'fiel' and (storage.foldername(name))[1] = auth.uid()::text);

create policy fiel_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'fiel' and (storage.foldername(name))[1] = auth.uid()::text);

-- Bucket público "logos" (el logo no es sensible); solo el dueño escribe en su carpeta.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 1048576, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy logos_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy logos_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy logos_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);
