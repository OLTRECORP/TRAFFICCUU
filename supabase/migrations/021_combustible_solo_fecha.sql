-- Combustible: la carga solo exige tracto y fecha; los litros pasan a ser opcionales (con litros se calcula km/l;
-- los km y viajes entre cargas salen de la Carta Porte). El odómetro (kilometraje) queda como dato histórico, ya no se captura.
-- Requiere 018. Idempotente. Los tipos nuevos de servicio de mantenimiento van en 020_mas_categorias_servicio.sql.
alter table public.cargas_combustible alter column litros drop not null;
alter table public.cargas_combustible drop constraint if exists cargas_combustible_litros_check;
alter table public.cargas_combustible drop constraint if exists cargas_comb_litros_ck;
alter table public.cargas_combustible add constraint cargas_comb_litros_ck check (litros is null or litros > 0);

notify pgrst, 'reload schema';
