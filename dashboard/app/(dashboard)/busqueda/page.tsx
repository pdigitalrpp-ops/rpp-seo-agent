import { supabase } from "@/lib/supabase"

export const revalidate = 60

export default async function BusquedaPage() {
  // Cada corrida del benchmark guarda un SNAPSHOT completo (ventana de ~3 días
  // de GSC + 7 días de Discover) con date = día de corrida. Mostrar solo el
  // snapshot más reciente: mezclar varios días duplica todo (las ventanas se
  // solapan) y revive data vieja.
  const { data: latestRow } = await supabase
    .from("gsc_daily")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .single()
  const latestDate = latestRow?.date

  const { data: latestSerpRow } = await supabase
    .from("serp_opportunities")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .single()
  const latestSerpDate = latestSerpRow?.date

  const [{ data: quickWins }, { data: lowCtr }, { data: topQueries }, { data: discover }, { data: serpOpps }] =
    await Promise.all([
      // Quick wins: posición 4-10 con impresiones altas (solo búsqueda web)
      supabase
        .from("gsc_daily")
        .select("page, query, position, impressions, clicks, ctr")
        .eq("date", latestDate)
        .eq("search_type", "web")
        .gte("position", 4)
        .lte("position", 10)
        .gte("impressions", 200)
        .order("impressions", { ascending: false })
        .limit(20),

      // Low CTR: muchas impresiones pero poco CTR (solo búsqueda web)
      supabase
        .from("gsc_daily")
        .select("page, query, impressions, clicks, ctr")
        .eq("date", latestDate)
        .eq("search_type", "web")
        .gte("impressions", 500)
        .lte("ctr", 2)
        .order("impressions", { ascending: false })
        .limit(20),

      // Top queries por clics (solo búsqueda web)
      supabase
        .from("gsc_daily")
        .select("query, clicks, impressions, ctr, position")
        .eq("date", latestDate)
        .eq("search_type", "web")
        .order("clicks", { ascending: false })
        .limit(15),

      // Discover: por página, sin dimensión query ni posición
      supabase
        .from("gsc_daily")
        .select("page, clicks, impressions, ctr")
        .eq("date", latestDate)
        .eq("search_type", "Discover")
        .order("clicks", { ascending: false })
        .limit(15),

      // Oportunidades SERP (SerpApi) sobre las quick wins del día
      supabase
        .from("serp_opportunities")
        .select("query, gsc_page, gsc_position, has_featured_snippet, rpp_has_snippet, featured_snippet_source, paa_questions, top_stories, rpp_in_top_stories")
        .eq("date", latestSerpDate)
        .order("gsc_position", { ascending: true }),
    ])

  const discoverTotalClicks = (discover ?? []).reduce((sum: number, r: any) => sum + (r.clicks ?? 0), 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Búsqueda &amp; Discover</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Rendimiento en Google Search, Google Discover, y oportunidades detectadas en el SERP en vivo
        </p>
      </div>

      {/* Búsqueda web */}
      <div className="grid md:grid-cols-2 gap-6">
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

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Top queries por clics (últimos 3 días, búsqueda web)</h2>
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
            {!topQueries?.length && (
              <tr><td colSpan={5} className="px-4 py-6 text-sm text-gray-500 text-center">Sin datos.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Discover */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b bg-purple-50 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-purple-800">Google Discover (últimos 7 días)</h2>
            <p className="text-xs text-purple-600 mt-0.5">Sin dimensión de query ni posición — Discover no las reporta</p>
          </div>
          {discoverTotalClicks > 0 && (
            <span className="text-xs font-semibold text-purple-700 bg-purple-100 rounded-full px-2.5 py-1">
              {discoverTotalClicks.toLocaleString()} clics totales
            </span>
          )}
        </div>
        <div className="divide-y max-h-96 overflow-y-auto">
          {discover?.map((row: any, i: number) => (
            <div key={i} className="px-4 py-3 flex items-center justify-between gap-3">
              <p className="text-sm text-gray-800 truncate flex-1">{row.page}</p>
              <div className="flex gap-3 text-xs text-gray-500 shrink-0">
                <span className="font-semibold text-purple-700">{(row.clicks ?? 0).toLocaleString()} clics</span>
                <span>{(row.impressions ?? 0).toLocaleString()} imp.</span>
                <span>CTR: {row.ctr?.toFixed(1)}%</span>
              </div>
            </div>
          ))}
          {!discover?.length && (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">Sin datos de Discover todavía.</p>
          )}
        </div>
      </div>

      {/* Oportunidades SERP en vivo (SerpApi) */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b bg-teal-50">
          <h2 className="text-sm font-semibold text-teal-800">Oportunidades en el SERP (en vivo)</h2>
          <p className="text-xs text-teal-600 mt-0.5">
            Featured snippet, preguntas relacionadas y carrusel de noticias para las quick wins del día
          </p>
        </div>
        <div className="divide-y max-h-[32rem] overflow-y-auto">
          {serpOpps?.map((row: any, i: number) => (
            <div key={i} className="px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-gray-800 truncate">{row.query}</p>
                <span className="text-xs text-gray-500 shrink-0">Pos. GSC {row.gsc_position?.toFixed(1)}</span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {row.has_featured_snippet && (
                  <span
                    className={`text-xs rounded-full px-2 py-0.5 border ${
                      row.rpp_has_snippet
                        ? "bg-teal-50 border-teal-300 text-teal-700"
                        : "bg-red-50 border-red-300 text-red-700"
                    }`}
                  >
                    {row.rpp_has_snippet ? "✓ RPP tiene el featured snippet" : "Featured snippet de otro medio"}
                  </span>
                )}
                {row.rpp_in_top_stories && (
                  <span className="text-xs rounded-full px-2 py-0.5 border bg-teal-50 border-teal-300 text-teal-700">
                    ✓ RPP en el carrusel de noticias
                  </span>
                )}
                {!row.has_featured_snippet && (
                  <span className="text-xs rounded-full px-2 py-0.5 border bg-gray-50 border-gray-300 text-gray-500">
                    Sin featured snippet — oportunidad libre
                  </span>
                )}
              </div>

              {row.paa_questions?.length > 0 && (
                <p className="text-xs text-gray-500">
                  <span className="font-medium text-gray-600">La gente también pregunta:</span>{" "}
                  {row.paa_questions.slice(0, 2).map((p: any) => p.question).join(" · ")}
                </p>
              )}

              {row.top_stories?.length > 0 && (
                <p className="text-xs text-gray-500 truncate">
                  <span className="font-medium text-gray-600">En el carrusel:</span>{" "}
                  {row.top_stories.slice(0, 3).map((s: any) => s.source).join(", ")}
                </p>
              )}
            </div>
          ))}
          {!serpOpps?.length && (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">
              Sin datos aún — se llena en el benchmark de la mañana si <code className="text-xs">SERPAPI_KEY</code> está configurada.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
