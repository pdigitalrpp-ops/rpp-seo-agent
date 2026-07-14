import type { ReactNode } from "react"
import Link from "next/link"
import { InfoTooltip } from "./InfoTooltip"

/** Comparativa vs un período anterior (p.ej. el día previo con datos). */
export type StatDelta = {
  /** % de cambio, ya calculado ((actual-previo)/previo*100). null si no aplica (ver isNew). */
  pct: number | null
  /** true cuando el período anterior fue 0 y el actual no — no hay % que mostrar. */
  isNew?: boolean
  /** Texto del período comparado, p.ej. "vs 13 jul". */
  vsLabel: string
}

function deltaColor(d: StatDelta): string {
  if (d.isNew || d.pct === null || d.pct === 0) return "#6b7280" // gray-500
  return d.pct > 0 ? "#006300" : "#d03b3b"
}

function deltaIcon(d: StatDelta): string {
  if (d.isNew) return "✨"
  if (d.pct === null || d.pct === 0) return "→"
  return d.pct > 0 ? "▲" : "▼"
}

function deltaText(d: StatDelta): string {
  if (d.isNew) return `Sin dato el período anterior`
  if (d.pct === null) return `Sin comparación · ${d.vsLabel}`
  const sign = d.pct > 0 ? "+" : ""
  return `${sign}${d.pct.toFixed(0)}% ${d.vsLabel}`
}

export function StatCard({
  label,
  value,
  subtitle,
  icon,
  info,
  accent = "#0D9488",
  href,
  delta,
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
  /** Comparativa vs período anterior, mostrada como pill de color bajo el valor. */
  delta?: StatDelta
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
      {delta && (
        <p className="text-xs font-medium mt-1" style={{ color: deltaColor(delta) }}>
          {deltaIcon(delta)} {deltaText(delta)}
        </p>
      )}
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
