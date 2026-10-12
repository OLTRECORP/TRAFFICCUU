import { createClient } from "@/lib/supabase/client";

/** Error del backend con el estado HTTP y la ruta, para mostrarlos en el código de error. */
export class ApiError extends Error {
  constructor(message: string, public status?: number, public path?: string) {
    super(message);
  }
}

/** POST autenticado hacia el backend FastAPI (vía proxy /api/backend). Lanza Error con el `detail` del backend. */
export async function postBackend<T = unknown>(path: string, body: BodyInit, contentType?: string): Promise<T> {
  const { data } = await createClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sesión expirada. Vuelve a iniciar sesión.");

  let res: Response;
  try {
    res = await fetch(`/api/backend/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, ...(contentType ? { "Content-Type": contentType } : {}) },
      body,
    });
  } catch {
    throw new ApiError("No hay conexión con el servidor", undefined, path);
  }
  if (res.status === 204) return undefined as T;
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = payload?.detail;
    throw new ApiError(typeof d === "string" ? d : Array.isArray(d) ? d.map((x: { msg: string }) => x.msg).join("; ") : `Error ${res.status}`, res.status, path);
  }
  return payload as T;
}
