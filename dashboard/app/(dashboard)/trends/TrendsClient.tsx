"use client"

import { useMemo, useState } from "react"
import { TagBadge } from "@/components/ui/Pill"
import { InfoTooltip } from "@/components/ui/InfoTooltip"
import { LastUpdated } from "@/components/ui/LastUpdated"
import { FilterCard, FilterItem, FilterChip } from "@/components/ui/FilterList"

export type Trend = {
  id: string
  rank: number
  keyword: string
  category: string | null
  growth_score: number | null
}

export type TrendHistoryRow = {
  date: string
  keyword: string
  growth_score: number | null
}

const CATEGORY_COLOR: Record<string, string> = {
  politica:        "#2563EB",
  economia:        "#16A34A",
  deportes:        "#CA8A04",
  entretenimiento: "#DB2777",
  tecnologia:      "#7C3AED",
  salud:           "#0D9488",
  mundo:           "#EA580C",
  otros:           "#6B7280",
}

const TODAS = "__todas__"

const catOf = (t: Trend) => t.category ?? "otros"

export default function TrendsClient({
  trends,
  history,
  lastRun,
}: {
  trends: Trend[]
  history: TrendHistoryRow[]
  lastRun: string | null
}) {
  const [category, setCategory] = useState<string>(TODAS)

  const categoryCounts = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const t of trends) acc[catOf(t)] = (acc[catOf(t)] ?? 0) + 1
    return Object.entries(acc).sort((a, b) => b[1] - a[1])
  }, [trends])

  const maxCount = Math.max(1, ...categoryCounts.map(([, c]) => c))

  const list = useMemo(
    () => trends.filter((t) => category === TODAS || catOf(t) === category),
    [trends, category]
  )

  // Temas recurrentes: cuántas corridas recientes trajeron cada keyword.
  const recurrent = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const h of history) acc[h.keyword] = (acc[h.keyword] ?? 0) + 1
    return Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 30)
  }, [history])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          Tendencias en Perú
          <InfoTooltip align="left">
            Qué está buscando la gente en Perú ahora mismo, según Google Trends. Cada
            tema trae una categoría y un score de crecimiento (0–10) basado en su
            volumen de búsquedas. Sirve para detectar temas calientes y decidir
            coberturas antes que la competencia.
          </InfoTooltip>
        </h1>
        <LastUpdated kind="radar" finishedAt={lastRun} />
      </div>

      {!trends.length && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-500 text-sm">
          Sin datos de tendencias para hoy.
        </div>
      )}

      {trends.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
          {/* Panel de filtros */}
          <div className="space-y-4 self-start">
            <FilterCard
              title="Categoría"
              info="Cuántas tendencias de hoy caen en cada categoría. Ayuda a ver hacia dónde se mueve el interés de búsqueda. Selecciona una para filtrar; vuelve a hacer clic para quitarla."
            >
              <FilterItem
                label="Todas las categorías"
                count={trends.length}
                active={category === TODAS}
                onClick={() => setCategory(TODAS)}
              />
              {categoryCounts.map(([cat, count]) => (
                <FilterItem
                  key={cat}
                  label={cat}
                  count={count}
                  active={category === cat}
                  onClick={() => setCategory(category === cat ? TODAS : cat)}
                  accent={CATEGORY_COLOR[cat] ?? "#6B7280"}
                  barPct={(count / maxCount) * 100}
                />
              ))}
            </FilterCard>
          </div>

          {/* Lista de tendencias */}
          <div className="space-y-4 min-w-0">
            {category !== TODAS && (
              <div className="flex items-center gap-2 flex-wrap">
                <FilterChip onClear={() => setCategory(TODAS)}>{category}</FilterChip>
                <button
                  onClick={() => setCategory(TODAS)}
                  className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
                >
                  Limpiar filtros
                </button>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b bg-gray-50">
                <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                  Top tendencias de hoy — Google Trends Perú
                  <InfoTooltip align="left">
                    Las tendencias del día ordenadas por relevancia. El score de
                    crecimiento (0–10) sale del volumen aproximado de búsquedas: a mayor
                    barra, más tracción está ganando el tema en Perú.
                  </InfoTooltip>
                </h2>
              </div>
              <div className="divide-y">
                {list.map((t) => {
                  const color = CATEGORY_COLOR[catOf(t)] ?? "#6B7280"
                  const score = t.growth_score ?? 0
                  return (
                    <div key={t.id} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition">
                      {/* Panel de score (izquierda), como en Recomendaciones */}
                      <div className="shrink-0 w-16 flex flex-col items-center text-center border-r border-gray-100 pr-4">
                        <span className="text-xs font-bold text-gray-300">#{t.rank}</span>
                        <span className="text-xl font-extrabold text-gray-900 leading-none mt-0.5">
                          {score.toFixed(1)}
                        </span>
                        <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">
                          /10
                        </span>
                        <div className="h-1 w-full rounded-full bg-gray-100 mt-1">
                          <div
                            className="h-1 rounded-full"
                            style={{ width: `${Math.min(100, score * 10)}%`, backgroundColor: color }}
                          />
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{t.keyword}</p>
                      </div>

                      <TagBadge color={color} className="shrink-0">
                        {catOf(t)}
                      </TagBadge>
                    </div>
                  )
                })}
                {!list.length && (
                  <p className="px-4 py-6 text-sm text-gray-500 text-center">
                    Sin tendencias en esta categoría hoy.
                  </p>
                )}
              </div>
            </div>

            {/* Temas recurrentes */}
            {recurrent.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 p-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
                  Temas recurrentes en corridas recientes
                  <InfoTooltip align="left">
                    Keywords que han sido tendencia en las corridas recientes (no solo
                    hoy). El número indica en cuántas corridas apareció cada una: los
                    temas que se repiten siguen vigentes y suelen merecer cobertura
                    propia o actualización.
                  </InfoTooltip>
                </h2>
                <p className="text-xs text-gray-400 mb-3">
                  El número indica en cuántas corridas recientes apareció el tema.
                </p>
                <div className="flex flex-wrap gap-2">
                  {recurrent.map(([kw, count]) => (
                    <span
                      key={kw}
                      className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs text-gray-700"
                    >
                      {kw}
                      {count > 1 && (
                        <span className="font-semibold text-rpp-teal">×{count}</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
