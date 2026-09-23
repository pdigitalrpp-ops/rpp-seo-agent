import { NextRequest, NextResponse } from "next/server"
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
export async function middleware(req: NextRequest) {
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

export const config = {
  matcher: [
    "/((?!login|api/auth|api/access|api/run-agent|_next/static|_next/image|favicon.ico|rpp-logo.png).*)",
  ],
}
