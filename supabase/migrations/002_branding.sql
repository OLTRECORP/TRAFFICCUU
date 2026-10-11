-- Para bases ya creadas con schema.sql anterior: logo y colores de la empresa.
alter table public.empresa_configuracion
  add column if not exists logo_path text,
  add column if not exists color_primario text not null default '#1d4ed8' check (color_primario ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists color_base text not null default '#f1f5f9' check (color_base ~ '^#[0-9a-fA-F]{6}$');

revoke all on public.empresa_configuracion from anon, authenticated;
grant select (id, user_id, rfc, razon_social, regimen_fiscal, cer_path, key_path, logo_path, color_primario, color_base, created_at, updated_at)
  on public.empresa_configuracion to authenticated;
grant insert (user_id, rfc, razon_social, regimen_fiscal, cer_path, key_path, logo_path, color_primario, color_base)
  on public.empresa_configuracion to authenticated;
grant update (rfc, razon_social, regimen_fiscal, cer_path, key_path, logo_path, color_primario, color_base)
  on public.empresa_configuracion to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 1048576, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy logos_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy logos_update_own on storage.objects for update to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy logos_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);
