import { supabase } from "@/lib/supabase"

export const revalidate = 3600

export default async function TraficoPage() {
  const today = new Date().toISOString().split("T")[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0]

  const { data: topArticles } = await supabase
    .from("own_traffic")
    .select("*")
    .eq("date", yesterday)
    .order("sessions", { ascending: false })
    .limit(20)

  const { data: bySections } = await supabase
    .from("own_traffic")
    .select("page_path, sessions, source")
    .gte("date", new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0])

  // Agrupar por fuente
  const bySource: Record<string, number> = {}
  for (const row of bySections ?? []) {
    const src = row.source ?? "Direct"
    bySource[src] = (bySource[src] ?? 0) + (row.sessions ?? 0)
  }
  const totalSessions = Object.values(bySource).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Tráfico</h1>
        <span className="text-sm text-gray-500">Ayer: {yesterday}</span>
      </div>

      {/* Distribución por fuente */}
      <div className="bg-white rounded-xl border p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Distribución por canal (últimos 7 días)</h2>
        <div className="space-y-2">
          {Object.entries(bySource)
            .sort((a, b) => b[1] - a[1])
            .map(([src, sessions]) => {
              const pct = totalSessions > 0 ? Math.round((sessions / totalSessions) * 100) : 0
              return (
                <div key={src} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-36 shrink-0">{src}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-red-500 h-2 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-gray-700 w-12 text-right">{pct}%</span>
                  <span className="text-xs text-gray-400 w-20 text-right">{sessions.toLocaleString()} ses.</span>
                </div>
              )
            })}
        </div>
      </div>

      {/* Top artículos de ayer */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Top artículos de ayer</h2>
          <span className="text-xs text-gray-400">Por sesiones</span>
        </div>
        <div className="divide-y">
          {topArticles?.map((row: any, i: number) => (
            <div key={row.id} className="px-4 py-3 flex items-start gap-3">
              <span className="text-sm font-bold text-gray-300 w-6 shrink-0">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 truncate">{row.page_path}</p>
                <div className="flex gap-3 mt-0.5">
                  <span className="text-xs text-gray-500">
                    {row.source ?? "—"}
                  </span>
                  {row.bounce_rate != null && (
                    <span className="text-xs text-gray-400">
                      rebote: {(row.bounce_rate * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
              <span className="text-sm font-semibold text-gray-700 shrink-0">
                {(row.sessions ?? 0).toLocaleString()}
              </span>
            </div>
          ))}
          {!topArticles?.length && (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">Sin datos de tráfico.</p>
          )}
        </div>
      </div>
    </div>
  )
}
