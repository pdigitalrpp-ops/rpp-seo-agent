import type { NextRequest } from "next/server"

/**
 * ¿La petición trae el secreto del cron (`CRON_SECRET`)? Acepta Bearer o la
 * cabecera propia `x-cron-secret`. Lo usan las rutas que pg_cron llama desde
 * Supabase sin cookie: /api/run-agent y /api/notificar.
 */
export function esCronAutorizado(req: NextRequest): boolean {
  const esperado = process.env.CRON_SECRET
  if (!esperado) return false
  const auth = req.headers.get("authorization") ?? ""
  const propia = req.headers.get("x-cron-secret") ?? ""
  const recibido = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : propia
  // Comparación de longitud fija para no filtrar el secreto por tiempo.
  if (!recibido || recibido.length !== esperado.length) return false
  let dif = 0
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i)
  return dif === 0
}
