import { createClient } from "@/lib/supabase/client";

/** POST autenticado hacia el backend FastAPI (vía proxy /api/backend). Lanza Error con el `detail` del backend. */
export async function postBackend<T = unknown>(path: string, body: BodyInit, contentType?: string): Promise<T> {
  const { data } = await createClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sesión expirada. Vuelve a iniciar sesión.");

  const res = await fetch(`/api/backend/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, ...(contentType ? { "Content-Type": contentType } : {}) },
    body,
  });
  if (res.status === 204) return undefined as T;
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = payload?.detail;
    throw new Error(typeof d === "string" ? d : Array.isArray(d) ? d.map((x: { msg: string }) => x.msg).join("; ") : `Error ${res.status}`);
  }
  return payload as T;
}
