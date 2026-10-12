-- Corrige "new row violates row-level security policy" al subir el logo (Storage).
-- Idempotente: ejecutar en Supabase > SQL Editor.
--
-- Causa: el frontend sube con upsert:true. Un upsert en storage.objects (INSERT ... ON CONFLICT
-- DO UPDATE) exige además una política SELECT para el rol authenticated, que el bucket "logos"
-- no tenía (solo insert/update/delete). Además se recrean las demás políticas por si faltaban.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 1048576, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists logos_select_own on storage.objects;
drop policy if exists logos_insert_own on storage.objects;
drop policy if exists logos_update_own on storage.objects;
drop policy if exists logos_delete_own on storage.objects;

create policy logos_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy logos_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy logos_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy logos_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Lo mismo para la FIEL (bucket privado), que también sube con upsert.
drop policy if exists fiel_select_own on storage.objects;
create policy fiel_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'fiel' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';
