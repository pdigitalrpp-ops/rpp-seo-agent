import { supabase } from "@/lib/supabase"
import { getLastRunFinishedAt } from "@/lib/lastRun"
import CompetenciaClient, { Article, CompetitorSource } from "./CompetenciaClient"

export const revalidate = 60

export default async function CompetenciaPage() {
  const today = new Date().toISOString().split("T")[0]

  const [{ data }, { data: sourcesData }, lastRun] = await Promise.all([
    supabase
      .from("competitor_articles")
      .select("id, site, title, url, published_at, category, rpp_has_coverage, rpp_matched_title, rpp_matched_url")
      .eq("fetched_date", today)
      .order("published_at", { ascending: false })
      .limit(500),

    // Incluye los pausados (active=false): el panel deja reanudarlos, igual
    // que los temas en /radar.
    supabase
      .from("competitor_sources")
      .select("id, name, rss, domain, active")
      .order("created_at", { ascending: true }),

    getLastRunFinishedAt("radar"),
  ])

  const articles = (data as Article[]) ?? []
  const sources = (sourcesData as CompetitorSource[]) ?? []

  if (!articles.length) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Competencia</h1>
          <span className="text-sm text-gray-500">{today}</span>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-500 text-sm">
          Sin datos de competencia para hoy.
          {sources.length === 0 && " No hay ningún medio configurado."}
          {sources.length > 0 && !sources.some((s) => s.active) &&
            " Todos los medios están pausados."}
        </div>
      </div>
    )
  }

  return <CompetenciaClient articles={articles} sources={sources} date={today} lastRun={lastRun} />
}
