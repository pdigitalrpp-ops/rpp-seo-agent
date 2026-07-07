import { supabase } from "@/lib/supabase"

export const revalidate = 60

export default async function SearchConsolePage() {
  // Cada corrida del benchmark guarda un SNAPSHOT completo (ventana de ~3 días
  // de GSC) con date = día de corrida. Mostrar solo el snapshot más reciente:
  // mezclar varios días duplica todo (las ventanas se solapan) y revive data vieja.
  const { data: latestRow } = await supabase
    .from("gsc_daily")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .single()
  const latestDate = latestRow?.date

  const [{ data: quickWins }, { data: lowCtr }, { data: topQueries }] = await Promise.all([
    // Quick wins: posición 4-10 con impresiones altas
    supabase
      .from("gsc_daily")
      .select("page, query, position, impressions, clicks, ctr")
      .eq("date", latestDate)
      .gte("position", 4)
      .lte("position", 10)
      .gte("impressions", 200)
      .order("impressions", { ascending: false })
      .limit(20),

    // Low CTR: muchas impresiones pero poco CTR
    supabase
      .from("gsc_daily")
      .select("page, query, impressions, clicks, ctr")
      .eq("date", latestDate)
      .gte("impressions", 500)
      .lte("ctr", 2)
      .order("impressions", { ascending: false })
      .limit(20),

    // Top queries por clics
    supabase
      .from("gsc_daily")
      .select("query, clicks, impressions, ctr, position")
      .eq("date", latestDate)
      .order("clicks", { ascending: false })
      .limit(15),
  ])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Search Console</h1>

      {/* Tabs de contenido */}
      <div className="grid md:grid-cols-2 gap-6">

        {/* Quick Wins */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b bg-amber-50">
            <h2 className="text-sm font-semibold text-amber-800">Quick Wins (posición 4–10)</h2>
            <p className="text-xs text-amber-600 mt-0.5">Optimizar estos artículos puede subir posición rápidamente</p>
          </div>
          <div className="divide-y max-h-96 overflow-y-auto">
            {quickWins?.map((row: any, i: number) => (
              <div key={i} className="px-4 py-3">
                <p className="text-xs text-gray-500 truncate mb-1">{row.page}</p>
                <p className="text-sm font-medium text-gray-800 truncate">{row.query}</p>
                <div className="flex gap-3 mt-1 text-xs text-gray-500">
                  <span>Pos. <strong className="text-orange-600">{row.position?.toFixed(1)}</strong></span>
                  <span>{(row.impressions ?? 0).toLocaleString()} imp.</span>
                  <span>CTR: {row.ctr?.toFixed(1)}%</span>
                </div>
              </div>
            ))}
            {!quickWins?.length && (
              <p className="px-4 py-6 text-sm text-gray-500 text-center">Sin datos.</p>
            )}
          </div>
        </div>

        {/* Low CTR */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b bg-blue-50">
            <h2 className="text-sm font-semibold text-blue-800">CTR bajo (≤2%)</h2>
            <p className="text-xs text-blue-600 mt-0.5">Reescribir title/meta puede multiplicar los clics</p>
          </div>
          <div className="divide-y max-h-96 overflow-y-auto">
            {lowCtr?.map((row: any, i: number) => (
              <div key={i} className="px-4 py-3">
                <p className="text-xs text-gray-500 truncate mb-1">{row.page}</p>
                <p className="text-sm font-medium text-gray-800 truncate">{row.query}</p>
                <div className="flex gap-3 mt-1 text-xs text-gray-500">
                  <span>{(row.impressions ?? 0).toLocaleString()} imp.</span>
                  <span className="text-red-600 font-semibold">CTR: {row.ctr?.toFixed(2)}%</span>
                  <span>{row.clicks ?? 0} clics</span>
                </div>
              </div>
            ))}
            {!lowCtr?.length && (
              <p className="px-4 py-6 text-sm text-gray-500 text-center">Sin datos.</p>
            )}
          </div>
        </div>
      </div>

      {/* Top queries */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Top queries por clics (últimos 3 días de GSC)</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 border-b bg-gray-50">
              <th className="text-left px-4 py-2">Query</th>
              <th className="text-right px-4 py-2">Clics</th>
              <th className="text-right px-4 py-2">Impresiones</th>
              <th className="text-right px-4 py-2">CTR</th>
              <th className="text-right px-4 py-2">Posición</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {topQueries?.map((row: any, i: number) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-800 max-w-xs truncate">{row.query}</td>
                <td className="px-4 py-2 text-right font-semibold text-gray-700">{(row.clicks ?? 0).toLocaleString()}</td>
                <td className="px-4 py-2 text-right text-gray-500">{(row.impressions ?? 0).toLocaleString()}</td>
                <td className="px-4 py-2 text-right text-gray-500">{row.ctr?.toFixed(1)}%</td>
                <td className="px-4 py-2 text-right text-gray-500">{row.position?.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
