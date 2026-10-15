import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Solo se reenvían rutas conocidas del backend.
const ALLOWED = new Set(["xml/procesar", "sat/sincronizar", "empresa/password-sat", "importar/excel",
  "sat/descarga-masiva", "sat/descarga-masiva/cancelar", "xml/subir-zip", "sat/diagnostico", "mapas/geocodificar", "rutas/calcular", "viajes/calcular-km",
  "facturas/eliminar", "facturas/eliminar-vista-previa", "unidades/unificar", "unidades/unificar-vista-previa", "remisiones/importar", "clientes/similares", "clientes/unificar", "clientes/unificar-vista-previa"]);
const FACTURA_SAT = /^(facturas\/[0-9a-f-]{36}\/(sat|viajes-disponibles|ligar-viajes)|viajes\/[0-9a-f-]{36}\/lugares|clientes\/[0-9a-f-]{36}\/(semanas|ligar-semana|ligar-auto))$/i;
const PREFIX: Record<string, string> = { "empresa/password-sat": "/api/empresa/password-sat" };

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  const key = params.path.join("/");
  if (!ALLOWED.has(key) && !FACTURA_SAT.test(key)) return NextResponse.json({ detail: "Ruta no permitida" }, { status: 404 });

  const base = process.env.RENDER_API_URL;
  const auth = req.headers.get("authorization");
  if (!base) return NextResponse.json({ detail: "RENDER_API_URL no configurada" }, { status: 500 });
  if (!auth) return NextResponse.json({ detail: "No autenticado" }, { status: 401 });

  const headers: Record<string, string> = { authorization: auth };
  const ct = req.headers.get("content-type");
  if (ct) headers["content-type"] = ct;

  try {
    const upstream = await fetch(`${base.replace(/\/$/, "")}${PREFIX[key] ?? `/api/${key}`}`, {
      method: "POST",
      headers,
      body: await req.arrayBuffer(),
      signal: AbortSignal.timeout(55000),
    });
    return new NextResponse(upstream.status === 204 ? null : await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ detail: "El motor logístico no responde. Intenta de nuevo." }, { status: 502 });
  }
}
