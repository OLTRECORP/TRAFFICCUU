-- Categoría (tipo de servicio) en la bitácora de mantenimiento de tractos y góndolas.
-- Requiere 016. Idempotente. Los registros existentes quedan sin categoría (null).
alter table public.servicios_mantenimiento
  add column if not exists categoria text;
alter table public.servicios_mantenimiento drop constraint if exists servicios_mant_categoria_ck;
alter table public.servicios_mantenimiento
  add constraint servicios_mant_categoria_ck
  check (categoria is null or categoria in ('motor', 'electrico', 'mecanico', 'soldadura', 'hidraulico', 'otro'));

notify pgrst, 'reload schema';
