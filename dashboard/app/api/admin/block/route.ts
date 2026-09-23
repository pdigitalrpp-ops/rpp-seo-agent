import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { isAdmin, isAllowedEmail, normalizeEmail } from "@/lib/access"
import { supabaseAdmin } from "@/lib/accessServer"

/**
 * Bloquear / desbloquear a un usuario desde /admin. El middleware ya exige ser
 * admin para /api/admin/*; se vuelve a comprobar aquí porque es una escritura.
 *
 * OJO: bloquear impide el PRÓXIMO ingreso. Una sesión ya abierta dura hasta su
 * vencimiento (máx. 30 días), porque el middleware no consulta la base en cada
 * página — hacerlo costaría una consulta por visita.
 */
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || !isAdmin(token.email)) {
    return NextResponse.json({ error: "No tienes permiso." }, { status: 403 })
  }
  let body: { email?: unknown; blocked?: unknown } = {}
  try { body = await req.json() } catch { /* vacío */ }
  const email = normalizeEmail(body.email)
  if (!isAllowedEmail(email) || typeof body.blocked !== "boolean") {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 })
  }
  if (isAdmin(email)) {
    return NextResponse.json({ error: "No puedes bloquear a un administrador." }, { status: 400 })
  }
  const { error } = await supabaseAdmin().rpc("dashboard_set_blocked", { p_email: email, p_blocked: body.blocked })
  if (error) return NextResponse.json({ error: "No se pudo guardar." }, { status: 500 })
  return NextResponse.json({ ok: true })
}
