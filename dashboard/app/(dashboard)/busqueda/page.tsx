import { supabase } from "@/lib/supabase"
import { getLastRunFinishedAt } from "@/lib/lastRun"
import BusquedaClient from "./BusquedaClient"

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

  const today = new Date().toISOString().split("T")[0]
  const lastRun = await getLastRunFinishedAt("morning")

  // select("*") a propósito en las filas de acción: tolera que la columna
  // query_freshness aún no exista (migración pendiente) — el client tiene
  // fallback por reglas para filas sin clasificar.
  const [{ data: quickWins }, { data: ctrCandidates }, { data: topQueries },
         { data: discover }, { data: serpOpps }, { data: trendRows }] =
    await Promise.all([
      // Quick wins: posición 4-10 con impresiones altas (solo búsqueda web)
      supabase
        .from("gsc_daily")
        .select("*")
        .eq("date", latestDate)
        .eq("search_type", "web")
        .gte("position", 4)
        .lte("position", 10)
        .gte("impressions", 200)
        .order("impressions", { ascending: false })
        .limit(60),

      // Candidatas a CTR bajo lo esperado: el gap real se calcula en el client
      // comparando contra la curva de CTR esperado por posición
      supabase
        .from("gsc_daily")
        .select("*")
        .eq("date", latestDate)
        .eq("search_type", "web")
        .gte("impressions", 500)
        .lte("position", 15)
        .order("impressions", { ascending: false })
        .limit(300),

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
        .limit(200),

      // Oportunidades SERP (SerpApi) sobre las quick wins del día
      supabase
        .from("serp_opportunities")
        .select("query, gsc_page, gsc_position, has_featured_snippet, rpp_has_snippet, featured_snippet_source, paa_questions, top_stories, rpp_in_top_stories")
        .eq("date", latestSerpDate)
        .order("gsc_position", { ascending: true }),

      // Tendencias activas hoy: árbitro de vigencia para el fallback client-side
      supabase
        .from("daily_trends")
        .select("keyword")
        .eq("date", today),
    ])

  return (
    <BusquedaClient
      quickWins={quickWins ?? []}
      ctrCandidates={ctrCandidates ?? []}
      topQueries={topQueries ?? []}
      discover={discover ?? []}
      serpOpps={serpOpps ?? []}
      trendKeywords={(trendRows ?? []).map((r: any) => r.keyword)}
      lastRun={lastRun}
    />
  )
}
