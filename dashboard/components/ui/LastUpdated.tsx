import type { RunKind } from "@/lib/lastRun"

/** Cadencia legible por tipo de corrida. "mixed" = pestañas que mezclan ambas. */
const CADENCE: Record<RunKind | "mixed", string> = {
  radar:   "Se actualiza cada ~10 min (5 a.m.–11 p.m.)",
  morning: "Se actualiza 1 vez al día (~6 a.m.)",
  mixed:   "Se actualiza durante el día",
}

/**
 * Bloque "cada cuánto se actualiza + última actualización con hora" para el
 * header de cada pestaña. Presentacional (sirve en server y client). La hora se
 * fuerza a America/Lima (los Server Components de Vercel corren en UTC).
 */
export function LastUpdated({
  kind,
  finishedAt,
}: {
  kind: RunKind | "mixed"
  finishedAt: string | null | undefined
}) {
  const label = finishedAt
    ? new Date(finishedAt).toLocaleString("es-PE", {
        timeZone: "America/Lima",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "sin datos aún"

  return (
    <div className="text-right text-xs text-gray-500 leading-tight shrink-0">
      <div className="flex items-center justify-end gap-1">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-rpp-teal" aria-hidden />
        {CADENCE[kind]}
      </div>
      <div className="text-gray-400">Última actualización: {label}</div>
    </div>
  )
}
