-- 1) Combustible: la carga solo exige tracto y fecha; los litros pasan a ser opcionales (con litros se calcula km/l;
--    los km y viajes entre cargas salen de la Carta Porte). El odómetro (kilometraje) queda como dato histórico, ya no se captura.
-- 2) Mantenimiento: más tipos de servicio. Requiere 018 y 019. Idempotente.
alter table public.cargas_combustible alter column litros drop not null;
alter table public.cargas_combustible drop constraint if exists cargas_combustible_litros_check;
alter table public.cargas_combustible drop constraint if exists cargas_comb_litros_ck;
alter table public.cargas_combustible add constraint cargas_comb_litros_ck check (litros is null or litros > 0);

alter table public.servicios_mantenimiento drop constraint if exists servicios_mant_categoria_ck;
alter table public.servicios_mantenimiento
  add constraint servicios_mant_categoria_ck
  check (categoria is null or categoria in
    ('motor', 'electrico', 'mecanico', 'hidraulico', 'soldadura', 'carroceria', 'suspension', 'frenos', 'llantas', 'transmision', 'otro'));

notify pgrst, 'reload schema';
