import { supabase } from "@/lib/supabase"
import CompetenciaClient, { Article } from "./CompetenciaClient"

export const revalidate = 60

export default async function CompetenciaPage() {
  const today = new Date().toISOString().split("T")[0]

  const { data } = await supabase
    .from("competitor_articles")
    .select("id, site, title, url, published_at, category")
    .eq("fetched_date", today)
    .order("published_at", { ascending: false })
    .limit(500)

  const articles = (data as Article[]) ?? []

  if (!articles.length) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Competencia</h1>
          <span className="text-sm text-gray-500">{today}</span>
        </div>
        <div className="bg-white rounded-xl border p-8 text-center text-gray-500 text-sm">
          Sin datos de competencia para hoy.
        </div>
      </div>
    )
  }

  return <CompetenciaClient articles={articles} date={today} />
}
