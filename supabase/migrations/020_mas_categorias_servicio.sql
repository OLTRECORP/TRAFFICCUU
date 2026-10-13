-- Más tipos de servicio en la bitácora de mantenimiento: carrocería, suspensión, llantas, frenos, transmisión.
-- Requiere 019. Idempotente; no cambia los registros existentes.
alter table public.servicios_mantenimiento drop constraint if exists servicios_mant_categoria_ck;
alter table public.servicios_mantenimiento
  add constraint servicios_mant_categoria_ck
  check (categoria is null or categoria in (
    'motor', 'electrico', 'mecanico', 'soldadura', 'hidraulico',
    'carroceria', 'suspension', 'llantas', 'frenos', 'transmision', 'otro'));

notify pgrst, 'reload schema';
