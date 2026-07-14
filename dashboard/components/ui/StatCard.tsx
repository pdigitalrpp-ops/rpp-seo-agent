import type { ReactNode } from "react"
import Link from "next/link"
import { InfoTooltip } from "./InfoTooltip"

export function StatCard({
  label,
  value,
  subtitle,
  icon,
  info,
  accent = "#0D9488",
  href,
}: {
  label: string
  value: string | number
  subtitle?: string
  icon?: ReactNode
  /** Texto del tooltip "?" junto al label: qué mide este indicador y para qué sirve. */
  info?: ReactNode
  accent?: string
  /** Si se pasa, la tarjeta entera es un link a esa pestaña (el "?" no navega: InfoTooltip frena el click). */
  href?: string
}) {
  const card = (
    <div
      className={`bg-white rounded-2xl border border-gray-200 p-4 h-full ${
        href ? "transition group-hover:border-gray-300 group-hover:shadow-md" : ""
      }`}
      style={{ borderLeftWidth: 4, borderLeftColor: accent }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
        {icon}
        {label}
        {info && <InfoTooltip align="left">{info}</InfoTooltip>}
      </p>
      <p className="text-2xl font-bold text-gray-900 mt-1.5">{value}</p>
      {(subtitle || href) && (
        <p className="text-xs text-gray-400 mt-0.5 flex items-center justify-between gap-2">
          <span>{subtitle}</span>
          {href && (
            <span
              aria-hidden
              className="font-bold text-gray-300 transition group-hover:text-rpp-teal group-hover:translate-x-0.5"
            >
              →
            </span>
          )}
        </p>
      )}
    </div>
  )

  return href ? (
    <Link href={href} className="block group h-full">
      {card}
    </Link>
  ) : (
    card
  )
}
