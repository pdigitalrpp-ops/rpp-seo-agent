"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter, usePathname } from "next/navigation"

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"]

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function fmtIso(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`
}

function parseIso(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number)
  return { y, m: m - 1, d }
}

function fmtLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

function monthLabel(y: number, m: number): string {
  const s = new Date(Date.UTC(y, m, 1)).toLocaleDateString("es-PE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Celdas del grid del mes: null = relleno antes del día 1 (semana empieza en lunes). */
function buildGrid(y: number, m: number): (string | null)[] {
  const firstWeekday = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7 // Mon=0
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const cells: (string | null)[] = Array(firstWeekday).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(fmtIso(y, m, d))
  return cells
}

/**
 * Selector de fecha con navegación día a día + calendario mensual, para ver
 * el snapshot de Tráfico de días anteriores. Solo los días con corrida exitosa
 * del benchmark matutino (`availableDates`) son seleccionables.
 */
export function DatePicker({ availableDates, selected }: { availableDates: string[]; selected: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const availableSet = useMemo(() => new Set(availableDates), [availableDates])
  const selIdx = availableDates.indexOf(selected)
  const prevDate = selIdx > 0 ? availableDates[selIdx - 1] : null
  const nextDate = selIdx >= 0 && selIdx < availableDates.length - 1 ? availableDates[selIdx + 1] : null
  const isLatest = availableDates.length > 0 && selIdx === availableDates.length - 1

  const initial = parseIso(selected)
  const [viewY, setViewY] = useState(initial.y)
  const [viewM, setViewM] = useState(initial.m)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  function go(iso: string) {
    router.push(`${pathname}?date=${iso}`)
    setOpen(false)
  }

  function openPicker() {
    const p = parseIso(selected)
    setViewY(p.y)
    setViewM(p.m)
    setOpen(true)
  }

  function shiftMonth(delta: number) {
    let y = viewY
    let m = viewM + delta
    if (m < 0) { m = 11; y -= 1 }
    if (m > 11) { m = 0; y += 1 }
    setViewY(y)
    setViewM(m)
  }

  const grid = useMemo(() => buildGrid(viewY, viewM), [viewY, viewM])

  if (availableDates.length === 0) return null

  return (
    <div ref={rootRef} className="relative inline-flex items-center gap-1">
      <button
        onClick={() => prevDate && go(prevDate)}
        disabled={!prevDate}
        aria-label="Día anterior con datos"
        className="h-7 w-7 inline-flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        ‹
      </button>

      <button
        onClick={openPicker}
        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-gray-300"
      >
        📅 {fmtLabel(selected)}
      </button>

      <button
        onClick={() => nextDate && go(nextDate)}
        disabled={!nextDate}
        aria-label="Día siguiente con datos"
        className="h-7 w-7 inline-flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        ›
      </button>

      {!isLatest && (
        <button
          onClick={() => go(availableDates[availableDates.length - 1])}
          className="text-xs font-semibold text-rpp-teal hover:text-teal-700 ml-1"
        >
          Hoy
        </button>
      )}

      {open && (
        <div className="absolute right-0 top-full mt-2 z-20 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => shiftMonth(-1)}
              aria-label="Mes anterior"
              className="h-6 w-6 inline-flex items-center justify-center rounded text-gray-500 hover:bg-gray-100"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-gray-800">{monthLabel(viewY, viewM)}</span>
            <button
              onClick={() => shiftMonth(1)}
              aria-label="Mes siguiente"
              className="h-6 w-6 inline-flex items-center justify-center rounded text-gray-500 hover:bg-gray-100"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-gray-400 mb-1">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {grid.map((iso, i) => {
              if (!iso) return <span key={i} />
              const has = availableSet.has(iso)
              const isSel = iso === selected
              return (
                <button
                  key={iso}
                  disabled={!has}
                  onClick={() => go(iso)}
                  className={`h-7 rounded-lg text-xs transition ${
                    isSel
                      ? "bg-rpp-teal text-white font-bold"
                      : has
                      ? "text-gray-700 hover:bg-teal-50 hover:text-rpp-teal font-medium"
                      : "text-gray-300 cursor-not-allowed"
                  }`}
                >
                  {Number(iso.slice(8))}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
