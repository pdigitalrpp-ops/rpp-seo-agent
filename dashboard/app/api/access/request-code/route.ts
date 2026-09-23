import { NextRequest, NextResponse } from "next/server"
import { isAllowedEmail, normalizeEmail, ALLOWED_DOMAIN } from "@/lib/access"
import {
  supabaseAdmin, generateCode, hashCode,
  CODE_TTL_MIN, RESEND_COOLDOWN_S, MAX_CODES_PER_EMAIL, MAX_CODES_PER_HOUR,
} from "@/lib/accessServer"
import { sendAccessCode } from "@/lib/mailer"

/**
 * Paso 1 del ingreso: valida el dominio y envía un código de 6 dígitos al
 * correo. Pública a propósito (el middleware la excluye): es lo que usa quien
 * todavía no tiene sesión.
 *
 * Límites, porque cada pedido manda un correo desde la cuenta de Gmail (~500
 * al día) y un abuso podría quemar la cuota o la reputación del remitente:
 * 1 pedido por minuto y 3 cada 15 min por correo, y 60 por hora en total.
 */
export const dynamic = "force-dynamic"

function error(msg: string, status: number) {
  return NextResponse.json({ error: msg }, { status })
}

export async function POST(req: NextRequest) {
  let body: { email?: unknown } = {}
  try { body = await req.json() } catch { /* cuerpo vacío o no-JSON */ }
  const email = normalizeEmail(body.email)
  if (!isAllowedEmail(email)) {
    return error(`Solo pueden ingresar correos @${ALLOWED_DOMAIN}.`, 400)
  }

  // Solo los NOMBRES de lo que falta, nunca los valores: sirve para leer en
  // los logs de Vercel qué variable no llegó a este entorno (Preview vs
  // Production es la confusión típica).
  const faltan = ["SUPABASE_SERVICE_ROLE_KEY", "GMAIL_USER", "GMAIL_APP_PASSWORD", "NEXTAUTH_SECRET"]
    .filter((k) => !process.env[k])
  if (faltan.length) {
    console.error(`[request-code] faltan variables en ${process.env.VERCEL_ENV ?? "?"}: ${faltan.join(", ")}`)
    return error("El acceso por correo no está configurado todavía.", 503)
  }

  let db: ReturnType<typeof supabaseAdmin>
  try { db = supabaseAdmin() } catch {
    return error("El acceso por correo no está configurado todavía.", 503)
  }

  const now = Date.now()
  const hace15 = new Date(now - 15 * 60_000).toISOString()
  const haceHora = new Date(now - 60 * 60_000).toISOString()

  const [{ data: recientes }, { count: enLaHora }] = await Promise.all([
    db.from("dashboard_access_codes").select("created_at")
      .eq("email", email).gte("created_at", hace15).order("created_at", { ascending: false }),
    db.from("dashboard_access_codes").select("id", { count: "exact", head: true })
      .gte("created_at", haceHora),
  ])

  const ultimo = recientes && recientes[0] ? new Date(recientes[0].created_at).getTime() : 0
  const espera = Math.ceil(RESEND_COOLDOWN_S - (now - ultimo) / 1000)
  if (espera > 0) return error(`Espera ${espera} s para pedir otro código.`, 429)
  if ((recientes?.length ?? 0) >= MAX_CODES_PER_EMAIL) {
    return error("Pediste varios códigos seguidos. Espera unos minutos e intenta de nuevo.", 429)
  }
  if ((enLaHora ?? 0) >= MAX_CODES_PER_HOUR) {
    return error("Hay demasiados pedidos en este momento. Intenta en unos minutos.", 429)
  }

  const code = generateCode()
  const { error: errInsert } = await db.from("dashboard_access_codes").insert({
    email,
    code_hash: hashCode(email, code),
    expires_at: new Date(now + CODE_TTL_MIN * 60_000).toISOString(),
  })
  if (errInsert) return error("No se pudo generar el código. Intenta de nuevo.", 500)

  try {
    await sendAccessCode(email, code)
  } catch (e) {
    console.error("[request-code] fallo el envío:", e instanceof Error ? e.message : e)
    return error("No se pudo enviar el correo. Intenta de nuevo en un momento.", 502)
  }

  return NextResponse.json({ ok: true, ttlMin: CODE_TTL_MIN })
}
