"use client"

import { useEffect, useState } from "react"
import { getSession, signOut } from "next-auth/react"

/**
 * Correo con el que se entró + salir. Reemplaza al badge "Agente SEO · 2026".
 *
 * La sesión se lee desde el NAVEGADOR: así el layout no depende de cookies. (Las
 * páginas ya se renderizan en cada visita desde el 2026-10-12, así que esto
 * dejó de ser un requisito; se mantiene porque funciona y evita un salto.)
 */
export function UserMenu() {
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    getSession().then((s) => setEmail(s?.user?.email ?? null)).catch(() => {})
  }, [])

  return (
    <div className="flex items-center gap-2 shrink-0">
      {email && (
        <span
          className="hidden sm:inline-flex max-w-[16rem] items-center truncate rounded-full bg-white/80 border border-rpp-ink/10 px-3 py-1 text-xs font-semibold text-rpp-ink/80"
          title={email}
        >
          {email}
        </span>
      )}
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="rounded-full bg-rpp-ink px-3 py-1 text-xs font-semibold text-white transition hover:bg-gray-800"
      >
        Salir
      </button>
    </div>
  )
}
