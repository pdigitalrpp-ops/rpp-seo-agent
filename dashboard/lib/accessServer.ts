import { createHash, randomInt, timingSafeEqual } from "crypto"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { normalizeEmail } from "./access"

/**
 * Lado servidor del acceso por código: generar, guardar y verificar.
 *
 * Las tablas dashboard_access_codes / dashboard_users tienen RLS activado SIN
 * políticas: la anon key (pública, viaja en el JS del navegador) no puede
 * leerlas. Por eso aquí se usa la service_role key, que solo existe en el
 * servidor de Vercel (SUPABASE_SERVICE_ROLE_KEY) y nunca llega al navegador.
 */

export const CODE_TTL_MIN = 10          // vigencia del código
export const MAX_ATTEMPTS = 5           // intentos por código antes de invalidarlo
export const RESEND_COOLDOWN_S = 60     // espera entre dos pedidos del mismo correo
export const MAX_CODES_PER_EMAIL = 3    // por ventana de 15 min
export const MAX_CODES_PER_HOUR = 60    // global: protege la cuota de Gmail (~500/día)

let admin: SupabaseClient | null = null

/**
 * Cliente con service_role, creado a demanda (el build no tiene la key).
 *
 * Todas sus consultas van con `cache: "no-store"`. Sin eso, Next 14 guarda la
 * respuesta en su Data Cache SIN vencimiento cuando la llama una página con
 * `dynamic = "force-dynamic"` (force-dynamic re-renderiza la página, pero no
 * apaga la caché de fetch) — y esa caché sobrevive a los deploys. Pasó en
 * /admin: la RPC de estadísticas quedó congelada en su primera respuesta y el
 * panel mostró 1 usuario con 3 en la base (2026-09-23). Son datos de acceso y
 * de escritura: nunca deben salir de una caché.
 */
export function supabaseAdmin(): SupabaseClient {
  if (admin) return admin
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en Vercel")
  admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  })
  return admin
}

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0")
}

/**
 * Se guarda el HASH, no el código: quien lea la tabla no puede entrar. El
 * correo y NEXTAUTH_SECRET entran en el hash para que un código de 6 dígitos
 * (un millón de valores) no se pueda revertir con una tabla precalculada.
 */
export function hashCode(email: string, code: string): string {
  return createHash("sha256")
    .update(`${normalizeEmail(email)}:${code}:${process.env.NEXTAUTH_SECRET ?? ""}`)
    .digest("hex")
}

function sameHash(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex")
  const bb = Buffer.from(b, "hex")
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/** Error con un mensaje apto para mostrar tal cual en el login. */
export class AccessError extends Error {}

/**
 * Verifica el último código vigente del correo. Lanza AccessError con el
 * motivo si no sirve; si sirve lo consume (y a los demás pendientes del mismo
 * correo) y registra el ingreso.
 */
export async function verifyCode(emailRaw: unknown, codeRaw: unknown): Promise<string> {
  const email = normalizeEmail(emailRaw)
  const code = typeof codeRaw === "string" ? codeRaw.replace(/\D/g, "") : ""
  if (code.length !== 6) throw new AccessError("El código tiene 6 dígitos.")

  const db = supabaseAdmin()
  const nowIso = new Date().toISOString()
  const { data: row, error } = await db
    .from("dashboard_access_codes")
    .select("id, code_hash, attempts")
    .eq("email", email)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new AccessError("No se pudo verificar el código. Intenta de nuevo.")
  if (!row) throw new AccessError("El código venció o ya se usó. Pide uno nuevo.")
  if (row.attempts >= MAX_ATTEMPTS) {
    throw new AccessError("Demasiados intentos con este código. Pide uno nuevo.")
  }

  if (!sameHash(row.code_hash, hashCode(email, code))) {
    await db.from("dashboard_access_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id)
    const quedan = MAX_ATTEMPTS - row.attempts - 1
    throw new AccessError(
      quedan > 0
        ? `Código incorrecto. Te quedan ${quedan} intento${quedan === 1 ? "" : "s"}.`
        : "Código incorrecto. Pide uno nuevo."
    )
  }

  // Consumir este y cualquier otro pendiente: un código sirve una sola vez.
  await db.from("dashboard_access_codes").update({ used_at: nowIso })
    .eq("email", email).is("used_at", null)

  const { data: permitido, error: errLogin } = await db.rpc("dashboard_register_login", { p_email: email })
  if (errLogin) throw new AccessError("No se pudo registrar el ingreso. Intenta de nuevo.")
  if (permitido === false) throw new AccessError("Tu acceso al dashboard está bloqueado.")
  return email
}
