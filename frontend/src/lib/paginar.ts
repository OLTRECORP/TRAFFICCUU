/** PostgREST (Supabase) devuelve máximo 1000 filas por consulta aunque se pida más con `.limit()`.
 *  Esto pide páginas de 1000 con `.range()` hasta traer todo. La consulta debe llevar un `order` estable
 *  (con un desempate único como `id`) para que ninguna fila se repita ni se pierda entre páginas. */
export const PAGINA = 1000;

export async function todo<T>(
  q: (desde: number, hasta: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let d = 0; ; d += PAGINA) {
    const { data, error } = await q(d, d + PAGINA - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < PAGINA) return out;
  }
}
