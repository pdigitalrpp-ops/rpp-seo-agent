import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { isAllowedEmail, isSessionFresh } from "@/lib/access"
import { supabaseAdmin } from "@/lib/accessServer"

/**
 * Registro de visitas (ver components/PageViewTracker.tsx). El correo sale de
 * la sesión, nunca del cuerpo: nadie puede registrar visitas a nombre de otro.
 * Nunca falla hacia el usuario — perder una visita no importa.
 */
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || !isAllowedEmail(token.email) || !isSessionFresh(token.loginAt)) {
    return new NextResponse(null, { status: 204 })
  }
  let path = ""
  try { path = String((await req.json()).path ?? "") } catch { /* vacío */ }
  // Solo rutas internas y cortas: es un contador, no un campo libre.
  if (path.charAt(0) !== "/" || path.length > 120) return new NextResponse(null, { status: 204 })

  try {
    await supabaseAdmin().from("dashboard_page_views").insert({ email: String(token.email), path })
  } catch {
    /* sin registro */
  }
  return new NextResponse(null, { status: 204 })
}
