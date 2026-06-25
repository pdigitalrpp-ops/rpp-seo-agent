import { supabase } from "@/lib/supabase"

export const revalidate = 60

const SITES = ["El Comercio", "La República", "Gestión", "Peru21", "Infobae Perú"]

export default async function CompetenciaPage() {
  const today = new Date().toISOString().split("T")[0]

  const { data: articles } = await supabase
    .from("competitor_articles")
    .select("*")
    .eq("fetched_date", today)
    .order("published_at", { ascending: false })
    .limit(100)

  // Agrupar por sitio
  const bySite: Record<string, any[]> = {}
  for (const a of articles ?? []) {
    if (!bySite[a.site]) bySite[a.site] = []
    bySite[a.site].push(a)
  }

  // Agrupar por categoría para el resumen
  const byCategory: Record<string, number> = {}
  for (const a of articles ?? []) {
    byCategory[a.category ?? "otros"] = (byCategory[a.category ?? "otros"] ?? 0) + 1
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Competencia</h1>
        <span className="text-sm text-gray-500">{today}</span>
      </div>

      {/* Resumen por sitio */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {SITES.map(site => (
          <div key={site} className="bg-white rounded-xl border p-3 text-center">
            <p className="text-2xl font-bold text-gray-800">{bySite[site]?.length ?? 0}</p>
            <p className="text-xs text-gray-500 mt-1">{site}</p>
          </div>
        ))}
      </div>

      {/* Resumen por categoría */}
      <div className="bg-white rounded-xl border p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Cobertura por categoría hoy</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(byCategory)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, count]) => (
              <span key={cat} className="text-xs bg-gray-100 text-gray-700 px-3 py-1 rounded-full">
                {cat}: <strong>{count}</strong>
              </span>
            ))}
        </div>
      </div>

      {/* Artículos por sitio */}
      {SITES.map(site => {
        const siteArticles = bySite[site] ?? []
        if (!siteArticles.length) return null
        return (
          <div key={site} className="bg-white rounded-xl border overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">{site}</h2>
              <span className="text-xs text-gray-400">{siteArticles.length} artículos</span>
            </div>
            <div className="divide-y max-h-72 overflow-y-auto">
              {siteArticles.slice(0, 15).map((a: any) => (
                <div key={a.id} className="px-4 py-2 flex items-start gap-3">
                  <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                    {a.category ?? "otros"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 line-clamp-2">{a.title}</p>
                    {a.published_at && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(a.published_at).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {!articles?.length && (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-500 text-sm">
          Sin datos de competencia para hoy.
        </div>
      )}
    </div>
  )
}
