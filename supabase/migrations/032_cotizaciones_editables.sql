-- Cotizaciones: folio consecutivo por empresa, vigencia, mercancía, condiciones y estado, para imprimirlas en un
-- formato profesional y editarlas. Requiere 030. Idempotente.

alter table public.cotizaciones add column if not exists folio         integer;
alter table public.cotizaciones add column if not exists vigencia_dias integer not null default 15 check (vigencia_dias > 0);
alter table public.cotizaciones add column if not exists mercancia     text;
alter table public.cotizaciones add column if not exists condiciones   text;
alter table public.cotizaciones add column if not exists estado        text not null default 'borrador'
  check (estado in ('borrador', 'enviada', 'aceptada', 'rechazada'));
alter table public.cotizaciones add column if not exists updated_at    timestamptz not null default now();

-- Folios de las cotizaciones que ya existían, por orden de captura
update public.cotizaciones c set folio = n.folio
from (select id, row_number() over (partition by empresa_id order by created_at, id) as folio from public.cotizaciones where folio is null) n
where c.id = n.id;

create unique index if not exists cotizaciones_folio_uk on public.cotizaciones (empresa_id, folio);
create index if not exists cotizaciones_origen_idx  on public.cotizaciones (empresa_id, origen);
create index if not exists cotizaciones_destino_idx on public.cotizaciones (empresa_id, destino);

-- Folio consecutivo por empresa al guardar (con candado para que dos cotizaciones simultáneas no repitan folio)
create or replace function public.fn_cotizacion_folio()
returns trigger
language plpgsql
as $$
begin
  if new.folio is null then
    perform pg_advisory_xact_lock(hashtext(new.empresa_id::text));
    select coalesce(max(folio), 0) + 1 into new.folio from public.cotizaciones where empresa_id = new.empresa_id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_cotizacion_folio on public.cotizaciones;
create trigger trg_cotizacion_folio before insert on public.cotizaciones
for each row execute function public.fn_cotizacion_folio();

drop trigger if exists trg_cotizaciones_updated_at on public.cotizaciones;
create trigger trg_cotizaciones_updated_at before update on public.cotizaciones
for each row execute function public.fn_set_updated_at();

notify pgrst, 'reload schema';
