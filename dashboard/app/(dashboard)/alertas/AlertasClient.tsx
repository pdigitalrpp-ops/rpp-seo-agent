"use client"

import { useMemo, useState } from "react"
import { InfoTooltip } from "@/components/ui/InfoTooltip"
import { LastUpdated } from "@/components/ui/LastUpdated"
import { FilterCard, FilterItem, FilterChip } from "@/components/ui/FilterList"

export type Alert = {
  id: string
  severity: string | null
  type: string | null
  section: string | null
  score: number | null
  date: string | null
  title: string | null
  description: string | null
  url: string | null
}

export type DecayItem = {
  id: string
  page_path: string
  drop_percentage: number | null
  peak_traffic: number | null
  current_traffic: number | null
  suggested_action: string | null
}

const SEVERITY_STYLES: Record<string, string> = {
  high:   "border-l-4 border-red-500 bg-red-50",
  medium: "border-l-4 border-yellow-500 bg-yellow-50",
  low:    "border-l-4 border-blue-500 bg-blue-50",
}

const SEVERITY_BADGE: Record<string, string> = {
  high:   "bg-red-100 text-red-700",
  medium: "bg-yellow-100 text-yellow-700",
  low:    "bg-blue-100 text-blue-700",
}

const SEVERITY_LABEL: Record<string, string> = {
  high:   "Alta",
  medium: "Media",
  low:    "Baja",
}

const SEVERITY_ACCENT: Record<string, string> = {
  high:   "#DC2626",
  medium: "#CA8A04",
  low:    "#2563EB",
}

const SEVERITY_ORDER = ["high", "medium", "low"]

const TYPE_LABEL: Record<string, string> = {
  traffic_drop:   "Caída de tráfico",
  decay:          "Content decay",
  position_drop:  "Caída de posición",
  trending_topic: "Tema en tendencia",
}

const TODAS = "__todas__"

export default function AlertasClient({
  alerts,
  decayList,
  lastRun,
}: {
  alerts: Alert[]
  decayList: DecayItem[]
  lastRun: string | null
}) {
  const [severity, setSeverity] = useState<string>(TODAS)
  const [type, setType] = useState<string>(TODAS)

  const sevOf = (a: Alert) => a.severity ?? "low"
  const typeOf = (a: Alert) => a.type ?? "otros"

  // Conteos con filtrado cruzado (cada faceta cuenta bajo la otra activa)
  const severityCounts = useMemo(() => {
    const base = alerts.filter((a) => type === TODAS || typeOf(a) === type)
    const acc: Record<string, number> = {}
    for (const a of base) acc[sevOf(a)] = (acc[sevOf(a)] ?? 0) + 1
    return acc
  }, [alerts, type])

  const typeCounts = useMemo(() => {
    const base = alerts.filter((a) => severity === TODAS || sevOf(a) === severity)
    const acc: Record<string, number> = {}
    for (const a of base) acc[typeOf(a)] = (acc[typeOf(a)] ?? 0) + 1
    return Object.entries(acc).sort((a, b) => b[1] - a[1])
  }, [alerts, severity])

  const list = useMemo(
    () =>
      alerts.filter(
        (a) =>
          (severity === TODAS || sevOf(a) === severity) &&
          (type === TODAS || typeOf(a) === type)
      ),
    [alerts, severity, type]
  )

  const hasActiveFilters = severity !== TODAS || type !== TODAS

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          Alertas
          <InfoTooltip align="left">
            Avisos automáticos cuando el agente detecta algo que revisar: caídas de
            tráfico, caídas de posición en Google o content decay (notas que perdieron
            fuerza). Cada alerta trae severidad, sección afectada y la nota involucrada.
            Es el panel para reaccionar rápido a problemas.
          </InfoTooltip>
        </h1>
        <div className="flex flex-col items-end gap-1">
          <span
            className={`text-sm font-medium px-3 py-1 rounded-full ${
              !alerts.length ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
            }`}
          >
            {alerts.length} activa(s)
          </span>
          <LastUpdated kind="radar" finishedAt={lastRun} />
        </div>
      </div>

      {!alerts.length && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center">
          <p className="text-green-700 font-medium">Sin alertas activas</p>
          <p className="text-green-600 text-sm mt-1">El agente no detectó caídas significativas.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        {/* Panel de filtros */}
        {alerts.length > 0 && (
          <div className="space-y-4 self-start">
            <FilterCard
              title="Severidad"
              info="Filtra las alertas por qué tan urgente es atenderlas. Alta = revisar ya; Media = hoy; Baja = informativa. El número es cuántas alertas activas hay de cada nivel."
            >
              <FilterItem
                label="Todas"
                count={alerts.filter((a) => type === TODAS || typeOf(a) === type).length}
                active={severity === TODAS}
                onClick={() => setSeverity(TODAS)}
              />
              {SEVERITY_ORDER.filter((s) => severityCounts[s]).map((s) => (
                <FilterItem
                  key={s}
                  label={SEVERITY_LABEL[s] ?? s}
                  count={severityCounts[s] ?? 0}
                  active={severity === s}
                  onClick={() => setSeverity(severity === s ? TODAS : s)}
                  accent={SEVERITY_ACCENT[s]}
                />
              ))}
            </FilterCard>

            <FilterCard
              title="Tipo de alerta"
              info="Filtra por el tipo de problema detectado: caídas de tráfico o de posición, content decay o temas en tendencia que cruzaron el umbral de alerta."
            >
              <FilterItem
                label="Todos los tipos"
                count={alerts.filter((a) => severity === TODAS || sevOf(a) === severity).length}
                active={type === TODAS}
                onClick={() => setType(TODAS)}
              />
              {typeCounts.map(([t, count]) => (
                <FilterItem
                  key={t}
                  label={TYPE_LABEL[t] ?? t}
                  count={count}
                  active={type === t}
                  onClick={() => setType(type === t ? TODAS : t)}
                />
              ))}
            </FilterCard>
          </div>
        )}

        {/* Columna principal */}
        <div className={`space-y-6 min-w-0 ${!alerts.length ? "lg:col-span-2" : ""}`}>
          {hasActiveFilters && (
            <div className="flex items-center gap-2 flex-wrap">
              {severity !== TODAS && (
                <FilterChip onClear={() => setSeverity(TODAS)}>
                  Severidad: {SEVERITY_LABEL[severity] ?? severity}
                </FilterChip>
              )}
              {type !== TODAS && (
                <FilterChip onClear={() => setType(TODAS)}>
                  {TYPE_LABEL[type] ?? type}
                </FilterChip>
              )}
              <button
                onClick={() => { setSeverity(TODAS); setType(TODAS) }}
                className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
              >
                Limpiar filtros
              </button>
            </div>
          )}

          {/* Alertas activas */}
          {alerts.length > 0 && (
            <div className="space-y-3">
              {list.map((alert) => (
                <div
                  key={alert.id}
                  className={`rounded-2xl p-4 ${SEVERITY_STYLES[sevOf(alert)] ?? "bg-gray-50 border-l-4 border-gray-300"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${SEVERITY_BADGE[sevOf(alert)] ?? "bg-gray-100 text-gray-600"}`}>
                        {(SEVERITY_LABEL[sevOf(alert)] ?? sevOf(alert)).toUpperCase()}
                      </span>
                      <span className="text-xs text-gray-500">
                        {TYPE_LABEL[typeOf(alert)] ?? typeOf(alert)}
                      </span>
                      {alert.section && (
                        <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">📂 {alert.section}</span>
                      )}
                      {alert.score != null && (
                        <span className="text-xs font-bold text-red-600">{alert.score}/100</span>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">{alert.date}</span>
                  </div>
                  <p className="font-semibold text-gray-900 mt-2">{alert.title}</p>
                  {alert.description && (
                    <p className="text-sm text-gray-600 mt-1">{alert.description}</p>
                  )}
                  {alert.url && (
                    <p className="text-xs text-gray-400 mt-1 font-mono truncate">{alert.url}</p>
                  )}
                </div>
              ))}
              {!list.length && (
                <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-sm text-gray-500">
                  Ninguna alerta coincide con los filtros activos.
                </div>
              )}
            </div>
          )}

          {/* Content Decay */}
          {decayList.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-1.5">
                Content Decay detectado
                <InfoTooltip align="left">
                  Notas cuyo tráfico cayó más del 20% frente a su pico histórico. Suelen ser
                  buenas candidatas para actualizar y republicar (recuperar posiciones)
                  antes de perderlas del todo. Se muestra el pico, el tráfico actual y la
                  acción sugerida.
                </InfoTooltip>
              </h2>
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b bg-gray-50">
                  <p className="text-xs text-gray-500">
                    Artículos cuyo tráfico cayó más del 20% respecto a su pico histórico
                  </p>
                </div>
                <div className="divide-y max-h-96 overflow-y-auto">
                  {decayList.map((item) => (
                    <div key={item.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs text-gray-500 font-mono truncate flex-1">{item.page_path}</p>
                        <span className="text-sm font-bold text-red-600 shrink-0">
                          -{item.drop_percentage?.toFixed(0)}%
                        </span>
                      </div>
                      <div className="flex gap-4 mt-1 text-xs text-gray-500">
                        <span>Pico: <strong>{(item.peak_traffic ?? 0).toLocaleString()}</strong> ses.</span>
                        <span>Actual: <strong>{(item.current_traffic ?? 0).toLocaleString()}</strong> ses.</span>
                      </div>
                      {item.suggested_action && (
                        <p className="text-xs text-blue-600 mt-1">{item.suggested_action}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
