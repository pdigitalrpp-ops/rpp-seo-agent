import { supabase } from "@/lib/supabase"
import { TagBadge } from "@/components/ui/Pill"
import { InfoTooltip } from "@/components/ui/InfoTooltip"

export const revalidate = 60

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

export default async function TrendsPage() {
  const today = new Date().toISOString().split("T")[0]

  const { data: trends } = await supabase
    .from("daily_trends")
    .select("*")
    .eq("date", today)
    .order("rank")
    .limit(20)

  const { data: history } = await supabase
    .from("daily_trends")
    .select("date, keyword, growth_score")
    .order("date", { ascending: false })
    .limit(100)

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
        <span className="text-sm text-gray-500">{today}</span>
      </div>

      {!trends?.length && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-500 text-sm">
          Sin datos de tendencias para hoy.
        </div>
      )}

      {/* Lista de tendencias */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            Top tendencias de hoy — Google Trends Perú
            <InfoTooltip align="left">
              Las tendencias del día ordenadas por relevancia. La barra teal indica el
              score de crecimiento (0–10): a mayor barra, más tracción está ganando el
              tema en las búsquedas de Perú.
            </InfoTooltip>
          </h2>
        </div>
        <div className="divide-y">
          {trends?.map((t: any) => (
            <div key={t.id} className="flex items-center gap-4 px-4 py-3">
              {/* Rank */}
              <span className="text-lg font-bold text-gray-300 w-8 shrink-0">#{t.rank}</span>

              {/* Keyword */}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{t.keyword}</p>
              </div>

              {/* Categoría */}
              <TagBadge color={CATEGORY_COLOR[t.category] ?? "#6B7280"} className="shrink-0">
                {t.category ?? "otros"}
              </TagBadge>

              {/* Score */}
              <div className="shrink-0 text-right w-16">
                <div className="text-sm font-bold text-rpp-teal">{t.growth_score?.toFixed(1)}/10</div>
                <div className="w-full bg-gray-200 rounded-full h-1 mt-1">
                  <div
                    className="bg-rpp-teal h-1 rounded-full"
                    style={{ width: `${Math.min(100, (t.growth_score ?? 0) * 10)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Historial reciente */}
      {history && history.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
            Últimas tendencias registradas
            <InfoTooltip align="left">
              Historial de temas que han sido tendencia en las corridas recientes (no
              solo hoy). Da contexto de qué se ha movido en los últimos días para
              detectar temas recurrentes o que siguen vigentes.
            </InfoTooltip>
          </h2>
          <div className="flex flex-wrap gap-2">
            {Array.from(new Set(history.map((h: any) => h.keyword))).slice(0, 30).map(kw => (
              <TagBadge key={kw as string} color="#6B7280">
                {kw as string}
              </TagBadge>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
