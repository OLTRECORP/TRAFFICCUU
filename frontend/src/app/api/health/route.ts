import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Proxy hacia el /health del backend en Render (evita CORS y mantiene RENDER_API_URL privada).
export async function GET() {
  const base = process.env.RENDER_API_URL;
  if (!base) return NextResponse.json({ status: "misconfigured" }, { status: 500 });
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.status === "online") return NextResponse.json({ status: "online" });
  } catch {
    /* timeout / DNS / servicio dormido */
  }
  return NextResponse.json({ status: "waking" }, { status: 503 });
}
