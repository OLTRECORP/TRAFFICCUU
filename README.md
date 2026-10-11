# TRAFFICCUU — ERP Logístico Multitenant (México)

Control de fletes, CFDI con Carta Porte 2.0/3.x y mantenimiento de flotilla.

| Capa | Tecnología | Despliegue |
|---|---|---|
| BD / Auth / Storage | Supabase (Postgres + RLS) | Supabase |
| API | FastAPI (`backend/`) | Render (`backend/render.yaml`) |
| Web | Next.js 14 App Router + Tailwind + shadcn/ui (`frontend/`) | Vercel (root dir `frontend`) |

## Puesta en marcha

1. **Supabase**: ejecuta `supabase/schema.sql` en el SQL Editor. Crea un usuario en Auth.
2. **Backend**: `cd backend && cp .env.example .env` (llena `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FERNET_KEY`),
   `pip install -r requirements.txt && uvicorn main:app --reload`. Tests: `pytest`.
3. **Frontend**: `cd frontend && cp .env.example .env.local`
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `RENDER_API_URL`), `npm install && npm run dev`.
4. Entra a `/login`, completa `/settings` (RFC, FIEL) y sube un XML en `/dashboard`.

## Decisiones de diseño

- **Multitenant**: 1 usuario = 1 empresa. Toda tabla de negocio lleva `empresa_id`; RLS usa `mi_empresa_id()` (ligado a `auth.uid()`). Se añadió `empresa_id` a las tablas del spec y una tabla `ubicaciones` para `origen_id`/`destino_id`.
- **Trigger** `trg_viaje_suma_kilometraje`: al insertar un viaje suma `distancia_operativa` a `tractocamiones.kilometraje_actual` (solo del mismo tenant). `unique(empresa_id, uuid)` evita doble suma por reprocesar un CFDI.
- **Distancia**: `distancia_xml` = suma de `DistanciaRecorrida` de los destinos (ida); `distancia_operativa` = ida × 2.
- **password_sat**: el cliente no puede leer ni escribir la columna (privilegios por columna); el backend la cifra con Fernet vía `POST /api/empresa/password-sat`.
- **Cold start**: tras el login se muestra "Conectando al motor logístico..." y el hook `useBackendHealth` consulta `/api/health` (proxy servidor → `RENDER_API_URL/health`) cada 5 s hasta recibir 200.
- **Branding y tema**: logo (bucket público `logos`, PNG/JPG/WebP ≤1 MB) y colores principal/base por empresa; `lib/theme.ts` deriva las variables CSS para claro y oscuro. El toggle claro/oscuro está en la barra superior y se recuerda en `localStorage`. Bases existentes: ejecutar `supabase/migrations/002_branding.sql`.
- **`/api/sat/sincronizar`** es un mock: valida el rango, lanza un background task y deja el punto de integración real en `backend/app/sat.py`.
- El backend usa `service_role` (ignora RLS), por eso valida el JWT y filtra manualmente por `empresa_id`; rechaza CFDI cuyo RFC emisor/receptor no sea el de la empresa.
