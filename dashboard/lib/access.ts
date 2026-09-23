/**
 * Reglas de acceso al dashboard, compartidas por el middleware (edge), el
 * login (navegador) y las rutas del servidor. Sin imports de Node a propósito:
 * el middleware corre en el runtime edge y no tiene `crypto` de Node.
 *
 * Flujo (2026-09-23): correo @gruporpp.com.pe → código de 6 dígitos al correo
 * → sesión de 30 días FIJOS desde el ingreso. Pasado ese plazo hay que volver a
 * pedir un código, aunque se haya usado el panel todos los días.
 */

export const ALLOWED_DOMAIN = "gruporpp.com.pe"

/** Duración del acceso, contada desde el ingreso (no se renueva con el uso). */
export const SESSION_DAYS = 30
export const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000

export function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : ""
}

/**
 * Solo el dominio exacto: `x@gruporpp.com.pe`. Un subdominio
 * (`x@mail.gruporpp.com.pe`) o un dominio que lo contenga
 * (`x@gruporpp.com.pe.evil.com`) NO pasan — por eso regex anclado y no
 * `endsWith`/`includes`.
 */
const EMAIL_RE = /^[a-z0-9._%+-]+@gruporpp\.com\.pe$/

export function isAllowedEmail(email: unknown): boolean {
  return EMAIL_RE.test(normalizeEmail(email))
}

/** ¿Sigue vigente un ingreso hecho en `loginAt` (ms)? */
export function isSessionFresh(loginAt: unknown, now: number = Date.now()): boolean {
  return typeof loginAt === "number" && now - loginAt >= 0 && now - loginAt < SESSION_MS
}

/**
 * Pestañas restringidas a correos concretos (2026-09-23, pedido del usuario:
 * Búsqueda & Discover y Auditoría solo para él). El middleware BLOQUEA la ruta
 * y el menú la OCULTA; lo que decide es el middleware, ocultar es cortesía.
 * Para dar acceso a alguien más, agregar su correo a la lista.
 */
export const RESTRICTED_ROUTES: { prefix: string; emails: string[] }[] = [
  { prefix: "/busqueda",  emails: ["flozano@gruporpp.com.pe"] },
  { prefix: "/auditoria", emails: ["flozano@gruporpp.com.pe"] },
]

/** ¿Puede este correo ver esta ruta? Las rutas no listadas son para todos. */
export function canAccessPath(pathname: string, email: unknown): boolean {
  const e = normalizeEmail(email)
  return RESTRICTED_ROUTES.every((r) =>
    !(pathname === r.prefix || pathname.indexOf(r.prefix + "/") === 0) || r.emails.indexOf(e) >= 0
  )
}

/** Destino tras ingresar: solo rutas internas, para no abrir una redirección a otro sitio. */
export function safeCallback(raw: string | null | undefined): string {
  if (!raw || raw.charAt(0) !== "/" || raw.charAt(1) === "/" || raw.charAt(1) === "\\") return "/"
  return raw.indexOf("/login") === 0 ? "/" : raw
}
