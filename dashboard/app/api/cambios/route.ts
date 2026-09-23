import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { isAllowedEmail, isSessionFresh } from "@/lib/access"
import { supabaseAdmin } from "@/lib/accessServer"

/**
 * ÚNICA puerta de escritura para la configuración que el equipo edita desde el
 * panel: temas del Radar, medios de Competencia y descartes de hallazgos.
 *
 * Antes el navegador escribía directo en Supabase con la anon key (RLS
 * abierto). Así no había forma de saber QUIÉN hizo un cambio, y cualquiera con
 * la key podía escribir sin pasar por el dashboard. Ahora: sesión verificada →
 * cambio con service_role → fila en dashboard_change_log con el antes y el
 * después. Decisión del usuario (2026-09-23): todos pueden agregar, editar,
 * pausar y quitar; lo que se pide es que quede registrado.
 */
export const dynamic = "force-dynamic"

type Body = { entity?: string; action?: string; id?: string; data?: Record<string, unknown> }

const TABLAS = { tema: "watch_keywords", medio: "competitor_sources", hallazgo: "watch_hits" } as const
type Entidad = keyof typeof TABLAS

// Campos que el panel puede escribir en cada tabla. Todo lo demás se ignora:
// el cliente no decide ids, fechas ni columnas que maneja el agente.
const CAMPOS: Record<Entidad, string[]> = {
  tema: ["keyword", "label", "section", "extra_feeds"],
  medio: ["name", "rss", "domain"],
  hallazgo: [],
}
const ACCIONES: Record<Entidad, string[]> = {
  tema: ["crear", "editar", "activar", "borrar"],
  medio: ["crear", "activar", "borrar"],
  hallazgo: ["descartar"],
}

function err(msg: string, status: number, code?: string) {
  return NextResponse.json({ error: msg, code }, { status })
}

function limpiar(entity: Entidad, data: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = {}
  for (const k of CAMPOS[entity]) {
    if (!(k in data)) continue
    const v = data[k]
    if (k === "extra_feeds") {
      out[k] = Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.indexOf("http") === 0) : null
      if (Array.isArray(out[k]) && (out[k] as unknown[]).length === 0) out[k] = null
    } else {
      out[k] = typeof v === "string" ? (v.trim() || null) : null
    }
  }
  return out
}

function nombre(entity: Entidad, row: Record<string, unknown> | null): string | null {
  if (!row) return null
  if (entity === "tema") return String(row.label || row.keyword || "")
  if (entity === "medio") return String(row.name || "")
  return String(row.title || "")
}

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || !isAllowedEmail(token.email) || !isSessionFresh(token.loginAt)) {
    return err("Sesión vencida. Vuelve a ingresar.", 401)
  }
  const email = String(token.email)

  let body: Body = {}
  try { body = await req.json() } catch { /* vacío */ }
  const entity = body.entity as Entidad
  const action = String(body.action || "")
  if (!(entity in TABLAS) || ACCIONES[entity].indexOf(action) < 0) return err("Acción no válida.", 400)
  if (action !== "crear" && !body.id) return err("Falta el id.", 400)

  const db = supabaseAdmin()
  const tabla = TABLAS[entity]

  // Estado ANTES del cambio: es lo que permite ver o restaurar lo que se tocó.
  let antes: Record<string, unknown> | null = null
  if (action !== "crear") {
    const { data } = await db.from(tabla).select("*").eq("id", body.id!).maybeSingle()
    if (!data) return err("Ya no existe (quizá alguien lo borró).", 404)
    antes = data
    if (entity === "tema" && action === "borrar") {
      const { count } = await db.from("watch_hits").select("id", { count: "exact", head: true }).eq("keyword_id", body.id!)
      antes = { ...antes, hallazgos_borrados: count ?? 0 }
    }
  }

  let despues: Record<string, unknown> | null = null
  let accionLog = action
  let res
  if (action === "crear") {
    const campos = limpiar(entity, body.data)
    if (entity === "tema" && !campos.keyword) return err("Falta qué vigilar.", 400)
    if (entity === "medio" && (!campos.name || !campos.rss)) return err("Faltan datos del medio.", 400)
    res = await db.from(tabla).insert(campos).select().single()
  } else if (action === "editar") {
    const campos = limpiar(entity, body.data)
    if (entity === "tema" && !campos.keyword) return err("Falta qué vigilar.", 400)
    res = await db.from(tabla).update(campos).eq("id", body.id!).select().single()
  } else if (action === "activar") {
    const activo = body.data?.active === true
    accionLog = activo ? "reanudar" : "pausar"
    res = await db.from(tabla).update({ active: activo }).eq("id", body.id!).select().single()
  } else if (action === "descartar") {
    res = await db.from(tabla).update({ dismissed: true }).eq("id", body.id!).select().single()
  } else {
    res = await db.from(tabla).delete().eq("id", body.id!)
  }

  if (res.error) {
    // 23505 = unique_violation: ese tema o medio ya existe.
    if (res.error.code === "23505") return err("Ya está en la lista.", 409, "23505")
    return err("No se pudo guardar. Intenta de nuevo.", 500)
  }
  if (action !== "borrar") despues = (res.data as Record<string, unknown>) ?? null

  // El historial no debe tumbar el cambio: si falla, se avisa en los logs.
  const { error: errLog } = await db.from("dashboard_change_log").insert({
    email, entity, action: accionLog,
    target: nombre(entity, despues ?? antes),
    before: antes, after: despues,
  })
  if (errLog) console.error("[cambios] no se pudo registrar:", errLog.message)

  return NextResponse.json({ ok: true, data: despues })
}
