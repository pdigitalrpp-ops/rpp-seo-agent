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
    // `?desde=correo-<tipo>`: la visita viene de un enlace de los correos del
    // agente (lib/correoCta.ts). Se lee de window y no con useSearchParams,
    // que obligaría a envolver el layout en <Suspense>.
    let via: string | null = null
    try { via = new URLSearchParams(window.location.search).get("desde") } catch { /* sin via */ }
    fetch("/api/visita", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname, via }),
      keepalive: true,
    }).catch(() => {})
  }, [pathname])
  return null
}
