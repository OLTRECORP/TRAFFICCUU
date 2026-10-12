# TRAFFICCUU — ERP Logístico Multitenant (México)

Control de fletes, CFDI con Carta Porte 2.0/3.x y mantenimiento de flotilla.

| Capa | Tecnología | Despliegue |
|---|---|---|
| BD / Auth / Storage | Supabase (Postgres + RLS) | Supabase |
| API | FastAPI (`backend/`) | Render (`backend/render.yaml`) |
| Web | Next.js 14 App Router + Tailwind + shadcn/ui (`frontend/`) | Vercel (root dir `frontend`) |

> **Desplegar en producción: ver [DEPLOY.md](DEPLOY.md).**

## Puesta en marcha (local)

1. **Supabase**: ejecuta `supabase/schema.sql` en el SQL Editor. Crea un usuario en Auth.
2. **Backend**: `cd backend && cp .env.example .env` (llena `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FERNET_KEY` = cualquier secreto largo),
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
- **Branding y tema**: logo (bucket público `logos`, PNG/JPG/WebP ≤1 MB) y 3 colores por empresa (principal = barra lateral/encabezado/botones, base = fondo, acento = indicadores y gráficas); `lib/theme.ts` deriva las variables CSS para claro y oscuro. Toggle claro/oscuro en el encabezado. Bases existentes: ejecutar `supabase/migrations/002_branding.sql` y `003_acento_y_paleta.sql`.
- **Facturas y órdenes de compra**: pantallas `/facturas` y `/ordenes`. El botón *Importar Excel* sube el Excel de administración de fletes (hojas `LISTA DE FACTURAS` y `RELACION DE ORDENES`) a `POST /api/importar/excel`; se puede repetir a diario, semana o mes: las facturas se identifican por folio y las órdenes por N° de orden, así que se actualizan sin duplicar. Requiere `supabase/migrations/004_facturas_ordenes.sql`.
- **Datos del SAT por factura**: al abrir una factura en `/facturas` el portal pide el CFDI por folio fiscal (UUID) al WS de Descarga Masiva del SAT (`POST /api/facturas/{id}/sat`), firmando con la FIEL ya cargada (`backend/app/sat.py`), y guarda el resumen y su Carta Porte en `facturas_sat`. Si ya hay datos del SAT no se vuelve a descargar; el botón *Actualizar desde SAT* fuerza la descarga. Requiere `supabase/migrations/008_facturas_sat_dashboard.sql`. El dashboard muestra estadísticas de facturas y órdenes (vistas `facturas_estadisticas`, `facturas_por_mes`).
- **Descarga masiva de XML** (`/facturas` → *Descargar XML del SAT*, `POST /api/sat/descarga-masiva`, `backend/app/descarga_masiva.py`): pide al SAT los CFDI emitidos mes por mes (todo el año o solo los meses con facturas sin XML, según la fecha de emisión), asigna cada XML a una factura y lo guarda en `facturas_sat.xml`. Asignación: 1) UUID; 2) si la factura no tiene UUID, folio (Folio o Serie+Folio, sin ceros ni guiones) **y** total (±1 centavo) con una sola candidata, y la factura recupera su UUID. Los que no se pueden asignar quedan listados en la corrida (`sat_descargas.sin_asignar`). Los complementos de pago (tipo P) se guardan en `complementos_pago` y se ligan por UUID a las facturas que cubren (`complemento_pago_documentos`), y por ellas a las órdenes de compra (se ven en el detalle de la orden). El avance se lee de `sat_descargas`.
- **Registro y diagnóstico del SAT**: cada corrida guarda una bitácora en vivo (`sat_descargas.bitacora`: autenticación, solicitud, estado del SAT, paquetes, asignaciones y errores) que se ve en *Facturas → Descargar XML del SAT*. *Probar conexión* (`POST /api/sat/diagnostico`) revisa migraciones, FIEL (vigencia y contraseña) y autenticación con el SAT y dice qué paso falla.
- **Carta Porte de cada XML**: al asignar un XML a su factura se registra el viaje (uno por factura, `viajes.factura_id`) con su chofer, tractocamión, góndola, origen y destino (que alimentan los catálogos y suman km al tracto). Los orígenes/destinos se crean en `lugares`, se ubican en el mapa por su dirección y calculan los km. *Procesar Carta Porte de XML guardados* hace lo mismo con los XML que ya estaban en `facturas_sat`. Los destinos tienen *precio por tonelada* de referencia. Requiere `supabase/migrations/010_bitacora_sat_carta_porte_precio.sql`.
- **Orígenes y destinos** (`/lugares`): catálogo de lugares (nombre/referencia, dirección, punto en el mapa) y distancias por carretera entre ellos (`rutas`), calculadas con OpenStreetMap (Nominatim para direcciones y OSRM para la ruta; sin llave). Cada viaje (uno por factura) se asocia a un origen y un destino; **km operativos = distancia de ida por mapa x 2**. `POST /api/viajes/calcular-km` asigna lugares por nombre a los viajes sin ellos y calcula los km faltantes. Variables opcionales del backend: `NOMINATIM_URL`, `OSRM_URL`, `MAPS_USER_AGENT`.
- **Dashboard**: la facturación total es la suma de las facturas vigentes (sin canceladas). Una factura con complemento de pago (columna del Excel o XML del SAT) cuenta como **pagada**, no como por cobrar. Requiere `supabase/migrations/009_descarga_masiva_complementos_lugares.sql`.
- **`/api/sat/sincronizar`** es un mock: valida el rango, lanza un background task y deja el punto de integración real en `backend/app/sat.py`.
- El backend usa `service_role` (ignora RLS), por eso valida el JWT y filtra manualmente por `empresa_id`; rechaza CFDI cuyo RFC emisor/receptor no sea el de la empresa.
