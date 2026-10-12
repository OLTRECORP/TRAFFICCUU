-- Detener la descarga del SAT y subir XML en .zip. Requiere 009 y 010. Idempotente.
alter table public.sat_descargas
  add column if not exists cancelar boolean not null default false;     -- el usuario pidió detener la corrida

alter table public.sat_descargas drop constraint if exists sat_descargas_estado_check;
alter table public.sat_descargas
  add constraint sat_descargas_estado_check check (estado in ('pendiente', 'en_proceso', 'ok', 'error', 'cancelado'));

alter table public.sat_descargas drop constraint if exists sat_descargas_modo_check;
alter table public.sat_descargas
  add constraint sat_descargas_modo_check check (modo in ('anio', 'faltantes', 'reprocesar', 'zip'));

notify pgrst, 'reload schema';
