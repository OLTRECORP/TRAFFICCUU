-- Un cliente puede tener varios destinos: el lugar se nombra por su lugar de entrega y el cliente
-- queda en su propio campo. Idempotente. Va después de la 012.
alter table public.lugares add column if not exists cliente text;
notify pgrst, 'reload schema';
