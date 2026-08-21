"use client"

import type { ReactNode } from "react"
import { InfoTooltip } from "./InfoTooltip"

/**
 * Componentes compartidos del panel lateral de filtros (Competencia, Tráfico…):
 * mismas tarjetas, filas y chips en todas las pestañas para que los filtros se
 * sientan como una sola herramienta.
 */

/** Tarjeta contenedora de una faceta de filtro, con título + tooltip consistentes. */
export function FilterCard({ title, info, children }: { title: string; info: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4">
      <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
        {title}
        <InfoTooltip align="left">{info}</InfoTooltip>
      </h2>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  )
}

/**
 * Fila de filtro. `count` admite string ya formateado; `barPct` pinta una
 * minibarra de volumen; `action` cuelga controles a la derecha (p.ej. pausar /
 * borrar el ítem que se está filtrando, en Radar de temas).
 *
 * `action` va FUERA del <button> del filtro, no dentro: anidar botones es HTML
 * inválido y además el click en "borrar" burbujearía como "filtrar por esto".
 * Por eso el <li> es el flex container y el botón de filtro es el que crece.
 */
export function FilterItem({
  icon,
  label,
  title,
  count,
  active,
  onClick,
  accent = "#0D9488",
  barPct,
  action,
  muted = false,
}: {
  icon?: ReactNode
  label: string
  /** Tooltip nativo de la fila; útil cuando el label va truncado. */
  title?: string
  count: ReactNode
  active: boolean
  onClick: () => void
  accent?: string
  barPct?: number
  action?: ReactNode
  /** Atenúa la fila sin desactivarla (ítem pausado, sin datos…). */
  muted?: boolean
}) {
  return (
    <li className="group flex items-center gap-0.5">
      <button
        onClick={onClick}
        title={title}
        className={`flex min-w-0 flex-1 flex-col rounded-lg px-2 py-1.5 text-sm transition ${
          active ? "font-semibold" : muted ? "text-gray-400 hover:bg-gray-50" : "text-gray-700 hover:bg-gray-50"
        }`}
        style={active ? { backgroundColor: `${accent}14`, color: accent } : undefined}
      >
        <span className="flex w-full items-center gap-2">
          {icon ?? <span className="w-4 shrink-0" />}
          <span className={`truncate flex-1 text-left ${muted ? "line-through" : ""}`}>{label}</span>
          <span className="text-xs shrink-0" style={{ color: active ? accent : "#9ca3af" }}>
            {count}
          </span>
        </span>
        {barPct !== undefined && (
          <span className="mt-1 block h-1 w-full rounded-full bg-gray-100">
            <span
              className="block h-1 rounded-full"
              style={{ width: `${Math.max(barPct, 2)}%`, backgroundColor: active ? accent : `${accent}66` }}
            />
          </span>
        )}
      </button>
      {action && (
        // En desktop se revela al pasar el cursor: las acciones destructivas no
        // deben competir con el conteo en reposo. Por debajo de `lg` quedan
        // visibles (atenuadas) porque en táctil no existe el hover y si no
        // serían inalcanzables.
        <span className="flex shrink-0 items-center gap-0.5 opacity-60 transition group-hover:opacity-100 group-focus-within:opacity-100 lg:opacity-0">
          {action}
        </span>
      )}
    </li>
  )
}

/** Chip de filtro activo con botón para quitarlo, sobre la lista de resultados. */
export function FilterChip({ children, onClear }: { children: ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 text-rpp-teal border border-teal-200 pl-2.5 pr-1 py-0.5 text-xs font-medium">
      {children}
      <button
        onClick={onClear}
        aria-label="Quitar filtro"
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-teal-100 leading-none"
      >
        ×
      </button>
    </span>
  )
}
