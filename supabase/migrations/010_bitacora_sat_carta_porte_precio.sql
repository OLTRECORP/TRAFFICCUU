-- Bitácora en vivo de la descarga del SAT, viaje ligado a su factura (Carta Porte) y precio por tonelada
-- en los destinos. Requiere 009. Idempotente.

-- 1. Bitácora y contador de viajes por corrida; modo "reprocesar" (Carta Porte de XML ya guardados)
alter table public.sat_descargas
  add column if not exists bitacora jsonb not null default '[]'::jsonb,   -- [{t, n: info|ok|aviso|error, m}]
  add column if not exists viajes integer not null default 0;
alter table public.sat_descargas drop constraint if exists sat_descargas_modo_check;
alter table public.sat_descargas
  add constraint sat_descargas_modo_check check (modo in ('anio', 'faltantes', 'reprocesar'));

-- 2. Un viaje por factura: el viaje que sale de la Carta Porte del XML queda ligado a su factura
alter table public.viajes
  add column if not exists factura_id uuid references public.facturas (id) on delete set null;
create index if not exists viajes_factura_idx on public.viajes (factura_id);

-- Liga los viajes ya existentes con su factura por UUID
update public.viajes v
   set factura_id = f.id
  from public.facturas f
 where v.factura_id is null and f.empresa_id = v.empresa_id and f.uuid = v.uuid;

-- 3. Precio por tonelada de referencia del destino
alter table public.lugares
  add column if not exists precio_tonelada numeric(12,2) check (precio_tonelada is null or precio_tonelada >= 0);

notify pgrst, 'reload schema';
