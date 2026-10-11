-- Color de acento + paleta por defecto inspirada en el logo GPN (azul petróleo y naranja).
alter table public.empresa_configuracion
  add column if not exists color_acento text not null default '#f06000' check (color_acento ~ '^#[0-9a-fA-F]{6}$');
alter table public.empresa_configuracion alter column color_primario set default '#0f5c80';
alter table public.empresa_configuracion alter column color_base set default '#d8e9f0';

revoke all on public.empresa_configuracion from anon, authenticated;
grant select (id, user_id, rfc, razon_social, regimen_fiscal, cer_path, key_path, logo_path, color_primario, color_base, color_acento, created_at, updated_at)
  on public.empresa_configuracion to authenticated;
grant insert (user_id, rfc, razon_social, regimen_fiscal, cer_path, key_path, logo_path, color_primario, color_base, color_acento)
  on public.empresa_configuracion to authenticated;
grant update (rfc, razon_social, regimen_fiscal, cer_path, key_path, logo_path, color_primario, color_base, color_acento)
  on public.empresa_configuracion to authenticated;
