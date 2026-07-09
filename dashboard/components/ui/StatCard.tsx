import type { ReactNode } from "react"
import { InfoTooltip } from "./InfoTooltip"

export function StatCard({
  label,
  value,
  subtitle,
  icon,
  info,
  accent = "#0D9488",
}: {
  label: string
  value: string | number
  subtitle?: string
  icon?: ReactNode
  /** Texto del tooltip "?" junto al label: qué mide este indicador y para qué sirve. */
  info?: ReactNode
  accent?: string
}) {
  return (
    <div
      className="bg-white rounded-2xl border border-gray-200 p-4"
      style={{ borderLeftWidth: 4, borderLeftColor: accent }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
        {icon}
        {label}
        {info && <InfoTooltip align="left">{info}</InfoTooltip>}
      </p>
      <p className="text-2xl font-bold text-gray-900 mt-1.5">{value}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  )
}
