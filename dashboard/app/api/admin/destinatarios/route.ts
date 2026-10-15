import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { isAdmin, isAllowedEmail, normalizeEmail } from "@/lib/access"
import { supabaseAdmin } from "@/lib/accessServer"
import { CATEGORIAS_TENDENCIAS } from "@/lib/tendenciasCorreo"

/**
 * Destinatarios de los correos automáticos (resumen, alertas, tendencias y
 * tráfico por sección), desde /admin. Antes se administraban por SQL.
 *
 * Acciones:
 *  - "guardar": alta o edición de un correo (@gruporpp.com.pe).
 *  - "borrar":  quita al destinatario (deja de recibir todo).
 *  - "probar":  le manda AHORA un correo de prueba de un tipo, sin tocar el
 *               registro de envíos. Lo envía /api/notificar, que es quien
 *               tiene la lógica de cada correo; aquí solo se le pasa el secreto.
 *
 * Cada cambio queda en dashboard_change_log (entity "destinatario"), igual que
 * los temas y los medios. El middleware ya exige admin para /api/admin/*; se
 * vuelve a comprobar porque es una escritura.
 */
export const dynamic = "force-dynamic"

const SEVERIDADES = ["low", "medium", "high"]
const CATEGORIAS = CATEGORIAS_TENDENCIAS.map(([k]) => k)
const PRUEBAS = ["resumen", "alertas", "tendencias", "trafico"]

type Body = { action?: string; email?: unknown; data?: Record<string, unknown>; tipo?: string }

const err = (msg: string, status: number) => NextResponse.json({ error: msg }, { status })

/** Lista de claves: minúsculas, sin tildes, sin repetidos, solo letras/espacios/guiones. */
function claves(v: unknown, permitidas?: string[]): string[] | null {
  if (!Array.isArray(v)) return null
  const out: string[] = []
  v.forEach((x) => {
    if (typeof x !== "string") return
    const k = x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
    if (!k || !/^[a-z0-9 ,-]{1,40}$/.test(k) || out.indexOf(k) >= 0) return
    if (permitidas && permitidas.indexOf(k) < 0) return
    out.push(k)
  })
  return out.length ? out : null
}

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || !isAdmin(token.email)) return err("No tienes permiso.", 403)
  const quien = String(token.email)

  let body: Body = {}
  try { body = await req.json() } catch { /* vacío */ }
  const email = normalizeEmail(body.email)
  if (!isAllowedEmail(email)) return err("Solo correos @gruporpp.com.pe.", 400)

  const db = supabaseAdmin()
  const { data: antes } = await db.from("notification_recipients").select("*").eq("email", email).maybeSingle()

  if (body.action === "probar") {
    if (!antes) return err("Primero guarda al destinatario.", 400)
    if (!body.tipo || PRUEBAS.indexOf(body.tipo) < 0) return err("Tipo de prueba no válido.", 400)
    if (body.tipo === "trafico" && !(antes.traffic_sections && antes.traffic_sections.length)) {
      return err("Elige al menos una sección de tráfico.", 400)
    }
    const secreto = process.env.CRON_SECRET
    if (!secreto) return err("Falta CRON_SECRET en Vercel.", 503)
    const res = await fetch(new URL("/api/notificar", req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": secreto },
      body: JSON.stringify({
        prueba: body.tipo, para: email,
        secciones: antes.traffic_sections, categorias: antes.trend_categories,
      }),
      cache: "no-store",
    })
    const r = await res.json().catch(() => ({}))
    if (!res.ok) return err(r.error || "No se pudo enviar la prueba.", 502)
    if (r.enviado === 0) return NextResponse.json({ ok: true, enviado: false, nota: r.nota || "No había datos para ese correo." })
    return NextResponse.json({ ok: true, enviado: true })
  }

  let despues: Record<string, unknown> | null = null
  let accion: string
  if (body.action === "guardar") {
    const d = body.data ?? {}
    const fila = {
      email,
      active:             d.active !== false,
      digest:             d.digest === true,
      alerts:             d.alerts === true,
      alert_min_severity: SEVERIDADES.indexOf(String(d.alert_min_severity)) >= 0 ? String(d.alert_min_severity) : "medium",
      trends:             d.trends === true,
      trend_categories:   claves(d.trend_categories, CATEGORIAS),
      traffic:            d.traffic === true,
      traffic_sections:   claves(d.traffic_sections),
    }
    if (fila.traffic && !fila.traffic_sections) return err("Para el correo de tráfico elige al menos una sección.", 400)
    const { data, error } = await db.from("notification_recipients").upsert(fila, { onConflict: "email" }).select().single()
    if (error) return err("No se pudo guardar.", 500)
    despues = data
    accion = antes ? "editar" : "crear"
  } else if (body.action === "borrar") {
    if (!antes) return err("Ya no existe.", 404)
    const { error } = await db.from("notification_recipients").delete().eq("email", email)
    if (error) return err("No se pudo borrar.", 500)
    accion = "borrar"
  } else {
    return err("Acción no válida.", 400)
  }

  // El historial no debe tumbar el cambio: si falla, queda en los logs.
  const { error: errLog } = await db.from("dashboard_change_log").insert({
    email: quien, entity: "destinatario", action: accion, target: email, before: antes ?? null, after: despues,
  })
  if (errLog) console.error("[destinatarios] no se pudo registrar el cambio:", errLog.message)
  return NextResponse.json({ ok: true, destinatario: despues })
}
