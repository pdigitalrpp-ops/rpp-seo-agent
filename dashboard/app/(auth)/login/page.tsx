"use client"

import Image from "next/image"
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { signIn } from "next-auth/react"
import { ALLOWED_DOMAIN, SESSION_DAYS, isAllowedEmail, normalizeEmail, safeCallback } from "@/lib/access"

/**
 * Ingreso al dashboard: el panel se ve BLOQUEADO (un esqueleto borroso, sin
 * datos reales — el middleware no deja pasar ni una consulta) con una tarjeta
 * encima en dos pasos: correo @gruporpp.com.pe → código de 6 dígitos.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <Login />
    </Suspense>
  )
}

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rpp-teal/40 focus:border-rpp-teal disabled:bg-gray-50"

function Login() {
  const router = useRouter()
  const params = useSearchParams()
  const destino = safeCallback(params.get("callbackUrl"))
  const vencida = params.get("vencida") === "1"

  const [paso, setPaso] = useState<"correo" | "codigo">("correo")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState("")
  const [aviso, setAviso] = useState("")
  const [espera, setEspera] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)

  // Cuenta regresiva para "Reenviar código" (el servidor exige 60 s).
  useEffect(() => {
    if (espera <= 0) return
    const id = setTimeout(() => setEspera(espera - 1), 1000)
    return () => clearTimeout(id)
  }, [espera])

  useEffect(() => {
    if (paso === "codigo") codeRef.current?.focus()
  }, [paso])

  async function pedirCodigo(e?: FormEvent) {
    e?.preventDefault()
    const limpio = normalizeEmail(email)
    setError(""); setAviso("")
    if (!isAllowedEmail(limpio)) {
      setError(`Usa tu correo corporativo @${ALLOWED_DOMAIN}.`)
      return
    }
    setEnviando(true)
    try {
      const res = await fetch("/api/access/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: limpio }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "No se pudo enviar el código.")
        return
      }
      setEmail(limpio)
      setCode("")
      setPaso("codigo")
      setEspera(60)
      setAviso(`Te enviamos un código a ${limpio}. Vence en ${body.ttlMin ?? 10} minutos. ` +
        "Si no lo ves, revisa el correo no deseado.")
    } catch {
      setError("Error de conexión. Intenta de nuevo.")
    } finally {
      setEnviando(false)
    }
  }

  async function verificar(e: FormEvent) {
    e.preventDefault()
    setError("")
    const limpio = code.replace(/\D/g, "")
    if (limpio.length !== 6) {
      setError("El código tiene 6 dígitos.")
      return
    }
    setEnviando(true)
    const res = await signIn("email-code", { email, code: limpio, redirect: false })
    setEnviando(false)
    if (res?.ok && !res.error) {
      router.replace(destino)
      router.refresh()
      return
    }
    setError(res?.error && res.error !== "CredentialsSignin" ? res.error : "Código incorrecto.")
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50">
      <DashboardBloqueado />

      <div className="absolute inset-0 flex items-start sm:items-center justify-center px-4 pt-24 sm:pt-0 bg-gray-900/10">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center gap-3 rounded-t-2xl bg-rpp-yellow px-5 py-4">
            <Image src="/rpp-logo.png" alt="RPP" width={36} height={36} className="h-9 w-9 rounded-full ring-2 ring-white" />
            <div className="leading-tight">
              <p className="font-extrabold text-rpp-ink">SEO Agent</p>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-rpp-ink/60">Acceso restringido</p>
            </div>
            <span className="ml-auto text-xl" aria-hidden>🔒</span>
          </div>

          <div className="space-y-4 p-5">
            {vencida && paso === "correo" && (
              <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                Tu acceso venció (dura {SESSION_DAYS} días). Pide un código nuevo para seguir.
              </p>
            )}

            {paso === "correo" ? (
              <form onSubmit={pedirCodigo} className="space-y-3">
                <p className="text-sm text-gray-600">
                  El dashboard es solo para el equipo del Grupo RPP. Ingresa tu correo
                  corporativo y te enviaremos un código de acceso.
                </p>
                <div>
                  <label htmlFor="email" className="mb-1 block text-xs font-medium text-gray-600">Correo corporativo</label>
                  <input
                    id="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={`nombre@${ALLOWED_DOMAIN}`}
                    className={inputCls}
                    disabled={enviando}
                  />
                </div>
                <button
                  type="submit"
                  disabled={enviando || !email.trim()}
                  className="w-full rounded-full bg-rpp-ink py-2.5 text-sm font-bold text-white transition hover:bg-gray-800 disabled:opacity-40"
                >
                  {enviando ? "Enviando…" : "Enviar código"}
                </button>
              </form>
            ) : (
              <form onSubmit={verificar} className="space-y-3">
                {aviso && <p className="text-sm text-gray-600">{aviso}</p>}
                <div>
                  <label htmlFor="code" className="mb-1 block text-xs font-medium text-gray-600">Código de acceso</label>
                  <input
                    id="code"
                    ref={codeRef}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={7}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
                    placeholder="123 456"
                    className={`${inputCls} text-center text-xl font-bold tracking-[0.4em]`}
                    disabled={enviando}
                  />
                </div>
                <button
                  type="submit"
                  disabled={enviando || code.replace(/\D/g, "").length !== 6}
                  className="w-full rounded-full bg-rpp-ink py-2.5 text-sm font-bold text-white transition hover:bg-gray-800 disabled:opacity-40"
                >
                  {enviando ? "Verificando…" : "Entrar al dashboard"}
                </button>
                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => { setPaso("correo"); setError(""); setAviso("") }}
                    className="font-medium text-gray-500 hover:text-gray-800"
                  >
                    ← Cambiar correo
                  </button>
                  <button
                    type="button"
                    onClick={() => pedirCodigo()}
                    disabled={espera > 0 || enviando}
                    className="font-medium text-rpp-teal hover:underline disabled:text-gray-400 disabled:no-underline"
                  >
                    {espera > 0 ? `Reenviar en ${espera} s` : "Reenviar código"}
                  </button>
                </div>
              </form>
            )}

            {error && (
              <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}

            <p className="border-t border-gray-100 pt-3 text-[11px] text-gray-400">
              El acceso queda guardado en este navegador por {SESSION_DAYS} días.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Silueta del dashboard, borrosa y sin datos: se ve qué hay detrás, no qué dice. */
function DashboardBloqueado() {
  return (
    <div aria-hidden className="pointer-events-none select-none blur-[3px] opacity-70">
      <div className="bg-rpp-yellow">
        <div className="mx-auto max-w-screen-xl px-4 pt-3 pb-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-white/80" />
            <div className="space-y-1.5">
              <div className="h-3 w-28 rounded bg-rpp-ink/70" />
              <div className="h-2 w-20 rounded bg-rpp-ink/30" />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            {[84, 120, 96, 110, 76, 140, 90].map((w, i) => (
              <div key={i} className="h-7 rounded-full bg-white/70" style={{ width: w }} />
            ))}
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-screen-xl space-y-6 px-4 py-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl border border-gray-200 bg-white" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex gap-3">
                <div className="h-12 w-12 rounded-lg bg-gray-100" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-3 w-3/4 rounded bg-gray-200" />
                  <div className="h-2.5 w-1/2 rounded bg-gray-100" />
                </div>
              </div>
            ))}
          </div>
          <div className="h-80 rounded-2xl border border-gray-200 bg-white" />
        </div>
      </div>
    </div>
  )
}
