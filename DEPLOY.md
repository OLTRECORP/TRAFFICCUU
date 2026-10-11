# Despliegue (≈15 minutos)

Orden: **Supabase → Render → Vercel → conectar**. Necesitas cuentas en los tres (hay plan gratuito) y este repo en GitHub.

## 1. Supabase
1. Crea un proyecto en supabase.com.
2. **SQL Editor** → pega todo `supabase/schema.sql` → *Run*.
3. **Authentication → Users → Add user** (correo + contraseña, marca *Auto Confirm*).
4. **Project Settings → API**: copia **Project URL**, **anon key** y **service_role key**.

## 2. Render (backend)
1. render.com → **New → Blueprint** → elige este repo (lee `render.yaml`).
2. Pega cuando lo pida: `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. En `CORS_ORIGINS` pon `https://temporal.vercel.app` por ahora.
   `FERNET_KEY` se genera sola: no la cambies después, o la contraseña de FIEL guardada dejará de descifrarse.
3. Al terminar, abre `https://TU-SERVICIO.onrender.com/health` → debe mostrar `{"status":"online"}`. Copia esa URL.

## 3. Vercel (frontend)
1. vercel.com → **Add New → Project** → importa este repo.
2. **Root Directory: `frontend`** (único ajuste manual).
3. Variables de entorno:
   | Nombre | Valor |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
   | `RENDER_API_URL` | URL de Render, sin `/` final |
4. **Deploy**. Copia la URL final (ej. `https://mi-erp.vercel.app`).

## 4. Conectar
- Render → servicio → **Environment** → `CORS_ORIGINS` = URL de Vercel.
- Supabase → **Authentication → URL Configuration** → *Site URL* = URL de Vercel.

## 5. Probar
Inicia sesión → espera "Conectando al motor logístico..." → **Empresa**: captura RFC, logo, colores y FIEL → **Viajes**: sube un XML.

## Problemas comunes
- *Se queda en "Conectando..."*: revisa `RENDER_API_URL` y que `/health` abra en el navegador (el plan gratuito tarda ~1 min en despertar).
- *Error al subir XML*: guarda primero la empresa; el RFC emisor/receptor del XML debe ser el de tu empresa.
- *CORS / 401*: `CORS_ORIGINS` y *Site URL* deben ser exactamente la URL de Vercel (sin `/` final).
- Base creada antes del logo/colores: ejecuta `supabase/migrations/002_branding.sql`.
