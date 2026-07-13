import { supabase } from "@/lib/supabase"
import { InfoTooltip } from "@/components/ui/InfoTooltip"
import { TagBadge } from "@/components/ui/Pill"
import type { RunKind } from "@/lib/lastRun"

export const revalidate = 60

const KIND_LABEL: Record<RunKind, string> = {
  morning: "Benchmark de la mañana",
  radar:   "Radar en tiempo real",
}

const KIND_CADENCE: Record<RunKind, string> = {
  morning: "1 vez al día (~6 a.m. Lima)",
  radar:   "cada ~10 min (5 a.m.–11 p.m. Lima)",
}

/** Pestañas del dashboard que se alimentan de cada orquestador. */
const KIND_FEEDS: Record<RunKind, string[]> = {
  morning: ["Tráfico", "Búsqueda & Discover", "Auditoría"],
  radar:   ["Recomendaciones", "Tendencias", "Competencia", "Alertas"],
}

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  success: { label: "OK",      color: "#16A34A" },
  partial: { label: "Parcial", color: "#F59E0B" },
  failed:  { label: "Falló",   color: "#DC2626" },
  unknown: { label: "Desconocido", color: "#6b7280" },
}

function fmt(iso: string | null | undefined) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export default async function StatusPage() {
  const { data: runs } = await supabase
    .from("agent_runs")
    .select("*")
    .order("finished_at", { ascending: false, nullsFirst: false })
    .limit(50)

  const kinds: RunKind[] = ["morning", "radar"]
  const lastByKind: Record<RunKind, any> = {
    morning: runs?.find((r) => r.kind === "morning") ?? null,
    radar:   runs?.find((r) => r.kind === "radar") ?? null,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          Estado del agente
          <InfoTooltip align="left">
            Historial de corridas del agente (benchmark de la mañana y radar en
            tiempo real): cuándo corrió cada una, si cumplió el cron, qué fuentes
            respondieron y qué pestañas alimenta. Útil para saber si un panel está
            desactualizado por falta de dato o porque la corrida falló.
          </InfoTooltip>
        </h1>
      </div>

      {/* Resumen por orquestador */}
      <div className="grid gap-4 md:grid-cols-2">
        {kinds.map((kind) => {
          const last = lastByKind[kind]
          const status = STATUS_STYLE[last?.status ?? "unknown"]
          return (
            <div
              key={kind}
              className="bg-white rounded-2xl border border-gray-200 p-4"
              style={{ borderLeftWidth: 4, borderLeftColor: status.color }}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {KIND_LABEL[kind]}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{KIND_CADENCE[kind]}</p>
                </div>
                <TagBadge color={status.color}>{status.label}</TagBadge>
              </div>

              <p className="text-sm text-gray-700 mt-3">
                Última corrida: <strong>{fmt(last?.finished_at)}</strong>
              </p>
              {last && (
                <p className="text-xs text-gray-400 mt-0.5">
                  Fuentes: {last.sources_ok?.length ?? 0} OK
                  {last.sources_failed?.length ? `, ${last.sources_failed.length} fallaron` : ""}
                </p>
              )}
              {!last && <p className="text-xs text-gray-400 mt-0.5">Aún no hay corridas registradas.</p>}

              <div className="flex flex-wrap gap-1.5 mt-3">
                {KIND_FEEDS[kind].map((tab) => (
                  <TagBadge key={tab} color="#8B5CF6">{tab}</TagBadge>
                ))}
              </div>

              {last?.error_log && (
                <p className="text-xs text-red-600 mt-3 font-mono break-words">{last.error_log}</p>
              )}
            </div>
          )
        })}
      </div>

      {/* Historial completo */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-1.5">
          Historial de corridas
          <InfoTooltip align="left">
            Últimas 50 corridas del agente, más recientes primero, con hora de inicio
            y fin (hora Lima), estado y qué fuentes fallaron. Si el cron se saltea o
            se retrasa (GitHub Actions lo hace en repos poco activos), se ve aquí como
            un hueco entre corridas.
          </InfoTooltip>
        </h2>
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-2 font-semibold">Tipo</th>
                  <th className="px-4 py-2 font-semibold">Inicio</th>
                  <th className="px-4 py-2 font-semibold">Fin</th>
                  <th className="px-4 py-2 font-semibold">Estado</th>
                  <th className="px-4 py-2 font-semibold">Fuentes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {runs?.map((run: any) => {
                  const status = STATUS_STYLE[run.status ?? "unknown"]
                  return (
                    <tr key={run.id}>
                      <td className="px-4 py-2 text-gray-700">
                        {run.kind ? KIND_LABEL[run.kind as RunKind] ?? run.kind : "—"}
                      </td>
                      <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{fmt(run.started_at)}</td>
                      <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{fmt(run.finished_at)}</td>
                      <td className="px-4 py-2">
                        <TagBadge color={status.color}>{status.label}</TagBadge>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {run.sources_ok?.map((s: string) => (
                            <TagBadge key={`${run.id}-${s}`} color="#16A34A">{s}</TagBadge>
                          ))}
                          {run.sources_failed?.map((s: string) => (
                            <TagBadge key={`${run.id}-${s}`} color="#DC2626">{s}</TagBadge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {!runs?.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                      Sin corridas registradas todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
