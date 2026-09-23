"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

/**
 * Registra una visita cuando una pestaña SE MUESTRA de verdad.
 *
 * Antes lo hacía el middleware, pero ahí no se distingue bien una visita de
 * una precarga: Next precarga en segundo plano todas las pestañas del menú, y
 * el 23-sep eso infló el conteo (ráfagas de 10 "visitas" en el mismo segundo,
 * 162 en 45 min para una sola persona). Desde el navegador solo cuenta lo que
 * se renderizó en pantalla, una vez por cambio de ruta.
 */
export function PageViewTracker() {
  const pathname = usePathname()
  useEffect(() => {
    if (!pathname) return
    fetch("/api/visita", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname }),
      keepalive: true,
    }).catch(() => {})
  }, [pathname])
  return null
}
