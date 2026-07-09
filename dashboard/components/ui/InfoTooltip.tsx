"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

type Align = "left" | "center" | "right"

const PANEL_W = 256 // = w-64
const VIEWPORT_MARGIN = 8
const CLOSE_DELAY_MS = 120

/**
 * Ícono "?" con tooltip explicativo. Se activa al pasar el cursor (desktop) o
 * al hacer clic/tap (touch); se cierra con Escape, tocando fuera, o al hacer
 * scroll. Pensado para acompañar títulos de pestañas y de secciones core:
 * explica QUÉ muestra el bloque y PARA QUÉ sirve.
 *
 * Es un client component (usa estado), pero se puede usar dentro de páginas
 * Server (RSC) sin problema — Next lo hidrata solo.
 *
 * El panel se renderiza en un portal a document.body con posición fija:
 * (1) no lo recortan las tarjetas con overflow-hidden (varias del dashboard
 * lo usan y con position:absolute el panel salía cortado cuando la tarjeta
 * estaba casi vacía), y (2) se clampa al viewport, así `align` es solo una
 * preferencia de anclaje. El cierre por mouseleave es diferido (120ms) para
 * poder mover el cursor del ícono al panel sin que se cierre en el trayecto.
 */
export function InfoTooltip({
  children,
  align = "center",
  className = "",
  label = "Más información",
}: {
  children: ReactNode
  align?: Align
  className?: string
  label?: string
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const open = pos !== null
  const id = useId()
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLSpanElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)

  const cancelClose = () => window.clearTimeout(closeTimer.current)

  const openPanel = () => {
    cancelClose()
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    let left =
      align === "right"  ? r.right - PANEL_W :
      align === "center" ? r.left + r.width / 2 - PANEL_W / 2 :
                           r.left
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - PANEL_W - VIEWPORT_MARGIN))
    setPos({ top: r.bottom + 6, left })
  }

  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => setPos(null), CLOSE_DELAY_MS)
  }

  // Limpiar el timer al desmontar.
  useEffect(() => cancelClose, [])

  // Abierto: cerrar al tocar fuera (clave en táctil), con Escape, o al hacer
  // scroll/resize (la posición fija quedaría desfasada del ícono).
  useEffect(() => {
    if (!open) return
    const close = () => setPos(null)
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return
      close()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
    }
  }, [open])

  return (
    <span className={`inline-flex align-middle ${className}`}>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={openPanel}
        onMouseLeave={scheduleClose}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          if (open) setPos(null)
          else openPanel()
        }}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] font-bold leading-none text-gray-400 transition hover:border-rpp-teal hover:text-rpp-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-rpp-teal/40"
      >
        ?
      </button>

      {open &&
        createPortal(
          <span
            ref={panelRef}
            id={id}
            role="tooltip"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: PANEL_W }}
            className="z-50 block rounded-xl border border-gray-200 bg-white p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-gray-600 shadow-lg"
          >
            {children}
          </span>,
          document.body
        )}
    </span>
  )
}
