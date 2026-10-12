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
- Base creada antes del logo/colores: ejecuta en orden `supabase/migrations/002_branding.sql`, `003_acento_y_paleta.sql`, `004_facturas_ordenes.sql` y `005_fix_rls_empresa.sql`. Para estadísticas de facturas/órdenes y datos del SAT en el popup de facturas, ejecuta también `007_choferes_unidades.sql` y `008_facturas_sat_dashboard.sql`; para la descarga masiva de XML, complementos de pago, orígenes/destinos y el nuevo cálculo del dashboard, ejecuta `009_descarga_masiva_complementos_lugares.sql` y después `010_bitacora_sat_carta_porte_precio.sql` (bitácora del SAT, Carta Porte por factura y precio por tonelada) y `011_cancelar_descarga_zip.sql` (detener la descarga y subir XML en .zip); en Render hay que redesplegar el backend (nueva dependencia `cfdiclient`).
- *new row violates row-level security policy al guardar la empresa*: ejecuta `supabase/migrations/005_fix_rls_empresa.sql`; si persiste, cierra sesión y vuelve a entrar (sesión expirada).
