import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { isAllowedEmail, isSessionFresh } from "@/lib/access"
import { supabaseAdmin } from "@/lib/accessServer"
import { esFrecuencia } from "@/lib/avisosTemas"

/**
 * Avisos por correo de un tema del Radar, para QUIEN ESTÁ CONECTADO. El correo
 * sale siempre de la sesión, nunca del cuerpo de la petición: nadie puede
 * suscribir a otra persona. Solo @gruporpp.com.pe (ya lo exige el middleware;
 * se vuelve a comprobar porque es una escritura).
 *
 * Cuerpo: { keyword_id, frecuencia: "inmediato" | "horarios" | "diario" | null }
 *   null = dejar de recibir.
 * O bien { keyword_id, accion: "probar" }: le manda AHORA un correo de muestra
 * con lo último de ese tema (vía /api/notificar, que tiene la lógica del correo).
 *
 * Cada cambio queda en dashboard_change_log (entity "suscripcion").
 */
export const dynamic = "force-dynamic"

type Body = { keyword_id?: unknown; frecuencia?: unknown; accion?: unknown }

const err = (msg: string, status: number) => NextResponse.json({ error: msg }, { status })

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || !isAllowedEmail(token.email) || !isSessionFresh(token.loginAt)) {
    return err("Sesión vencida. Vuelve a ingresar.", 401)
  }
  const email = String(token.email).trim().toLowerCase()

  let body: Body = {}
  try { body = await req.json() } catch { /* vacío */ }
  const keywordId = typeof body.keyword_id === "string" ? body.keyword_id : ""
  if (!/^[0-9a-f-]{36}$/i.test(keywordId)) return err("Tema no válido.", 400)

  const db = supabaseAdmin()
  const { data: tema } = await db.from("watch_keywords").select("id, keyword, label").eq("id", keywordId).maybeSingle()
  if (!tema) return err("Ese tema ya no existe.", 404)
  const nombre = String(tema.label || tema.keyword)

  if (body.accion === "probar") {
    const secreto = process.env.CRON_SECRET
    if (!secreto) return err("Falta CRON_SECRET en Vercel.", 503)
    const res = await fetch(new URL("/api/notificar", req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": secreto },
      body: JSON.stringify({ prueba: "temas", para: email, keyword_id: keywordId }),
      cache: "no-store",
    })
    const r = await res.json().catch(() => ({}))
    if (!res.ok) return err(r.error || "No se pudo enviar la prueba.", 502)
    if (r.enviado === 0) return NextResponse.json({ ok: true, enviado: false, nota: "Este tema no trajo publicaciones en las últimas 24 horas: no hay nada que mostrar todavía." })
    return NextResponse.json({ ok: true, enviado: true, para: email })
  }

  const frecuencia = body.frecuencia
  if (frecuencia !== null && !esFrecuencia(frecuencia)) return err("Frecuencia no válida.", 400)

  const { data: antes } = await db.from("watch_subscriptions")
    .select("keyword_id, email, frequency, created_at, updated_at")
    .eq("keyword_id", keywordId).eq("email", email).maybeSingle()

  let despues: Record<string, unknown> | null = null
  let accion: string
  if (frecuencia === null) {
    if (!antes) return NextResponse.json({ ok: true, frecuencia: null })
    const { error } = await db.from("watch_subscriptions").delete().eq("keyword_id", keywordId).eq("email", email)
    if (error) return err("No se pudo guardar. Intenta de nuevo.", 500)
    accion = "borrar"
  } else {
    if (antes && antes.frequency === frecuencia) return NextResponse.json({ ok: true, frecuencia })
    const { data, error } = await db.from("watch_subscriptions")
      .upsert({ keyword_id: keywordId, email, frequency: frecuencia, updated_at: new Date().toISOString() }, { onConflict: "keyword_id,email" })
      .select("keyword_id, email, frequency, created_at, updated_at").single()
    if (error) return err("No se pudo guardar. Intenta de nuevo.", 500)
    despues = data
    accion = antes ? "editar" : "crear"
  }

  // El historial no debe tumbar el cambio: si falla, queda en los logs.
  const { error: errLog } = await db.from("dashboard_change_log").insert({
    email, entity: "suscripcion", action: accion, target: nombre,
    before: antes ? { ...antes, tema: nombre } : null,
    after: despues ? { ...despues, tema: nombre } : null,
  })
  if (errLog) console.error("[suscripcion] no se pudo registrar el cambio:", errLog.message)

  return NextResponse.json({ ok: true, frecuencia })
}
