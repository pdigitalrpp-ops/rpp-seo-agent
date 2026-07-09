"use client"

import { useId, useState, type ReactNode } from "react"

type Align = "left" | "center" | "right"

const ALIGN_CLASS: Record<Align, string> = {
  left:   "left-0",
  center: "left-1/2 -translate-x-1/2",
  right:  "right-0",
}

/**
 * Ícono "?" con tooltip explicativo. Se activa al pasar el cursor (desktop) o
 * al hacer clic/tap (touch). Pensado para acompañar títulos de pestañas y de
 * secciones core: explica QUÉ muestra el bloque y PARA QUÉ sirve.
 *
 * Es un client component (usa estado), pero se puede usar dentro de páginas
 * Server (RSC) sin problema — Next lo hidrata solo.
 *
 * `align` controla el anclaje horizontal del panel para evitar que se corte en
 * los bordes (usar "left"/"right" cuando el ícono está pegado a un borde).
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
  const [open, setOpen] = useState(false)
  const id = useId()

  return (
    <span
      className={`relative inline-flex align-middle ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          setOpen((v) => !v)
        }}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] font-bold leading-none text-gray-400 transition hover:border-rpp-teal hover:text-rpp-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-rpp-teal/40"
      >
        ?
      </button>

      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute top-6 z-30 w-64 rounded-xl border border-gray-200 bg-white p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-gray-600 shadow-lg ${ALIGN_CLASS[align]}`}
        >
          {children}
        </span>
      )}
    </span>
  )
}
