/**
 * Cliente de /api/cambios: la única vía por la que el panel modifica temas del
 * Radar, medios de Competencia y hallazgos. El servidor registra quién hizo
 * cada cambio (dashboard_change_log). Nunca lanza: devuelve `error` listo para
 * mostrar, y `code` = "23505" cuando el tema o medio ya existe.
 */
export type ResultadoCambio<T> = { data?: T; error?: string; code?: string }

export async function cambio<T = Record<string, unknown>>(body: {
  entity: "tema" | "medio" | "hallazgo"
  action: "crear" | "editar" | "activar" | "borrar" | "descartar"
  id?: string
  data?: Record<string, unknown>
}): Promise<ResultadoCambio<T>> {
  try {
    const res = await fetch("/api/cambios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { error: json.error ?? "No se pudo guardar.", code: json.code }
    return { data: json.data as T }
  } catch {
    return { error: "Error de conexión. Intenta de nuevo." }
  }
}
