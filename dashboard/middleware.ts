import { NextRequest, NextResponse, type NextFetchEvent } from "next/server"
import { getToken } from "next-auth/jwt"
import { canAccessPath, isAllowedEmail, isSessionFresh } from "@/lib/access"

/**
 * Candado del dashboard (2026-09-23). Toda página y API exige una sesión de un
 * correo @gruporpp.com.pe ingresada hace menos de 30 días. Antes no había
 * middleware: el login existía pero ninguna página lo pedía.
 *
 * Fuera del candado (ver `matcher`): el login, las rutas de next-auth y de
 * pedido de código (las usa quien aún no entró), los estáticos, y
 * /api/run-agent — a esa la llama también pg_cron desde Supabase, sin cookie,
 * así que valida ella misma: CRON_SECRET o sesión.
 */
export async function middleware(req: NextRequest, event: NextFetchEvent) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const path = req.nextUrl.pathname

  if (token && isAllowedEmail(token.email) && isSessionFresh(token.loginAt)) {
    // Con sesión, pero pestaña restringida a otros correos: al Resumen.
    if (!canAccessPath(path, token.email)) {
      if (path.indexOf("/api/") === 0) {
        return NextResponse.json({ error: "No tienes permiso." }, { status: 403 })
      }
      const home = req.nextUrl.clone()
      home.pathname = "/"
      home.search = ""
      return NextResponse.redirect(home)
    }
    if (esVisita(req)) event.waitUntil(registrarVisita(String(token.email), path))
    return NextResponse.next()
  }

  if (path.indexOf("/api/") === 0) {
    return NextResponse.json({ error: "Sesión vencida. Vuelve a ingresar." }, { status: 401 })
  }
  const login = req.nextUrl.clone()
  login.pathname = "/login"
  login.search = ""
  login.searchParams.set("callbackUrl", path + req.nextUrl.search)
  if (token) login.searchParams.set("vencida", "1")
  return NextResponse.redirect(login)
}

/**
 * ¿Es una visita de verdad? Se descartan las APIs y los PREFETCH: Next precarga
 * en segundo plano cada pestaña del menú visible, y contarlos inflaría el uso
 * de todas por igual (justo lo que el panel /admin quiere distinguir). Una
 * navegación dentro del panel llega como petición RSC y SÍ cuenta.
 */
function esVisita(req: NextRequest): boolean {
  if (req.nextUrl.pathname.indexOf("/api/") === 0) return false
  if (req.method !== "GET") return false
  const h = req.headers
  return !(h.get("next-router-prefetch") || h.get("purpose") === "prefetch"
    || h.get("x-middleware-prefetch") || h.get("sec-purpose") === "prefetch")
}

/**
 * Guarda la visita en dashboard_page_views por la API REST de Supabase. Va en
 * waitUntil: la página no espera a que termine, y si falla solo se pierde el
 * registro — nunca el acceso.
 */
async function registrarVisita(email: string, path: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  try {
    await fetch(`${url}/rest/v1/dashboard_page_views`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ email, path }),
    })
  } catch {
    /* sin registro; el acceso no depende de esto */
  }
}

export const config = {
  matcher: [
    "/((?!login|api/auth|api/access|api/run-agent|_next/static|_next/image|favicon.ico|rpp-logo.png).*)",
  ],
}
