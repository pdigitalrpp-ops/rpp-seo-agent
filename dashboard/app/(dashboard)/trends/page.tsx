import { supabase } from "@/lib/supabase"

export const revalidate = 60

const CATEGORY_COLORS: Record<string, string> = {
  politica:        "bg-blue-100 text-blue-700",
  economia:        "bg-green-100 text-green-700",
  deportes:        "bg-yellow-100 text-yellow-700",
  entretenimiento: "bg-pink-100 text-pink-700",
  tecnologia:      "bg-purple-100 text-purple-700",
  salud:           "bg-teal-100 text-teal-700",
  mundo:           "bg-orange-100 text-orange-700",
  otros:           "bg-gray-100 text-gray-600",
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
        <h1 className="text-2xl font-bold text-gray-900">Tendencias en Perú</h1>
        <span className="text-sm text-gray-500">{today}</span>
      </div>

      {!trends?.length && (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-500 text-sm">
          Sin datos de tendencias para hoy.
        </div>
      )}

      {/* Lista de tendencias */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Top tendencias de hoy — Google Trends Perú</h2>
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
              <span className={`text-xs px-2 py-0.5 rounded font-medium shrink-0 ${CATEGORY_COLORS[t.category] ?? "bg-gray-100 text-gray-600"}`}>
                {t.category ?? "otros"}
              </span>

              {/* Score */}
              <div className="shrink-0 text-right w-16">
                <div className="text-sm font-bold text-red-600">{t.growth_score?.toFixed(1)}/10</div>
                <div className="w-full bg-gray-200 rounded-full h-1 mt-1">
                  <div
                    className="bg-red-500 h-1 rounded-full"
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
        <div className="bg-white rounded-xl border p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Últimas tendencias registradas</h2>
          <div className="flex flex-wrap gap-2">
            {Array.from(new Set(history.map((h: any) => h.keyword))).slice(0, 30).map(kw => (
              <span key={kw as string} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-full">
                {kw as string}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
