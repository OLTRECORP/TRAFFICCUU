-- Corrige "new row violates row-level security policy" al agregar una empresa.
-- Idempotente: se puede ejecutar varias veces en Supabase > SQL Editor.
--
-- Causa: al insertar en empresa_configuracion, el trigger fn_empresa_reglas_default
-- inserta las reglas de mantenimiento por defecto. Esa inserción evaluaba la política
-- tenant_reglas (empresa_id = mi_empresa_id()), que falla si el dueño de la función
-- no omite RLS. Ahora la política de reglas se valida directo contra el dueño de la
-- empresa (user_id = auth.uid()) y la función corre como "postgres".

-- 1. Política de empresa: separada por comando y explícita.
drop policy if exists empresa_owner on public.empresa_configuracion;
drop policy if exists empresa_select_own on public.empresa_configuracion;
drop policy if exists empresa_insert_own on public.empresa_configuracion;
drop policy if exists empresa_update_own on public.empresa_configuracion;
drop policy if exists empresa_delete_own on public.empresa_configuracion;

create policy empresa_select_own on public.empresa_configuracion
  for select to authenticated using (user_id = auth.uid());
create policy empresa_insert_own on public.empresa_configuracion
  for insert to authenticated with check (user_id = auth.uid());
create policy empresa_update_own on public.empresa_configuracion
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy empresa_delete_own on public.empresa_configuracion
  for delete to authenticated using (user_id = auth.uid());

-- 2. Reglas de mantenimiento: validar por dueño de la empresa (no depende del helper).
drop policy if exists tenant_reglas on public.reglas_mantenimiento;
create policy tenant_reglas on public.reglas_mantenimiento
  for all to authenticated
  using (exists (select 1 from public.empresa_configuracion e
                 where e.id = empresa_id and e.user_id = auth.uid()))
  with check (exists (select 1 from public.empresa_configuracion e
                      where e.id = empresa_id and e.user_id = auth.uid()));

-- 3. Trigger de reglas por defecto: security definer, propiedad de postgres, idempotente.
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
alter function public.fn_empresa_reglas_default() owner to postgres;
alter function public.mi_empresa_id() owner to postgres;
alter function public.fn_viaje_suma_kilometraje() owner to postgres;

-- 4. Permisos de columna (por si faltan en bases antiguas).
grant select (id, user_id, rfc, razon_social, regimen_fiscal, cer_path, key_path, logo_path, color_primario, color_base, color_acento, created_at, updated_at)
  on public.empresa_configuracion to authenticated;
grant insert (user_id, rfc, razon_social, regimen_fiscal, cer_path, key_path, logo_path, color_primario, color_base, color_acento)
  on public.empresa_configuracion to authenticated;
grant update (rfc, razon_social, regimen_fiscal, cer_path, key_path, logo_path, color_primario, color_base, color_acento)
  on public.empresa_configuracion to authenticated;
