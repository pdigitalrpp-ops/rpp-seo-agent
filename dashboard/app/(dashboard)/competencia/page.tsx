import { supabase } from "@/lib/supabase"
import { getLastRunFinishedAt } from "@/lib/lastRun"
import CompetenciaClient, { Article, CompetitorSource } from "./CompetenciaClient"
import { todayInLima } from "@/lib/dates"

export const revalidate = 60

export default async function CompetenciaPage() {
  // Día de LIMA, no de UTC: el agente escribe sus fechas bajo TZ=America/Lima
  // y el runtime de Vercel corre en UTC, así que de 19:00 a 23:59 hora de
  // Lima esto pedía el día siguiente y la página salía vacía. Ver lib/dates.ts.
  const today = todayInLima()

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

  // NO hay early return por falta de notas: la administracion de medios vive
  // dentro de CompetenciaClient, asi que cortar aqui la dejaba inalcanzable
  // justo cuando mas falta hace (sin medios configurados, o con todos
  // pausados, no habria forma de arreglarlo desde el panel). El cliente ya
  // sabe pintar su propio estado vacio.
  return <CompetenciaClient articles={articles} sources={sources} date={today} lastRun={lastRun} />
}
