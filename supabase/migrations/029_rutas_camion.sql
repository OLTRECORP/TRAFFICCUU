-- Rutas por calles y carreteras para camión de carga: además de los km de ida, se guarda el tiempo estimado y el
-- trazo (polilínea codificada, precisión 6) para dibujarlo en el mapa. Las rutas anteriores (OSRM/auto, sin trazo)
-- se conservan hasta recalcularlas desde Orígenes y destinos › «Recalcular con ruta de camión». Idempotente.

alter table public.rutas add column if not exists duracion_min integer check (duracion_min is null or duracion_min >= 0);
alter table public.rutas add column if not exists geometria    text;

notify pgrst, 'reload schema';
