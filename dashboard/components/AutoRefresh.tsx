"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

/** Con la pestaña a la vista, cada cuánto se vuelven a pedir los datos. */
const REFRESH_MS = 5 * 60 * 1000
/** Al volver a la pestaña, se refresca si pasó al menos esto desde la última vez. */
const STALE_ON_RETURN_MS = 60 * 1000

/**
 * Mantiene al día una pestaña del panel que se queda ABIERTA.
 *
 * Las páginas se renderizan en cada visita, pero una pestaña abierta desde
 * ayer sigue mostrando lo de ayer hasta que alguien recarga. `router.refresh()`
 * vuelve a pedir los datos al servidor sin recargar la página: los filtros y
 * el scroll se conservan. No corre con la pestaña oculta (no gasta consultas
 * por pestañas olvidadas); al volver a ella, se pone al día de inmediato.
 */
export function AutoRefresh() {
  const router = useRouter()
  const last = useRef(Date.now())

  useEffect(() => {
    const refresh = () => {
      last.current = Date.now()
      router.refresh()
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last.current >= STALE_ON_RETURN_MS) {
        refresh()
      }
    }
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh()
    }, REFRESH_MS)
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", onVisible)
    }
  }, [router])

  return null
}
