import { supabase } from "@/lib/supabase"
import { getLastRunFinishedAt } from "@/lib/lastRun"
import TrendsClient, { Trend, TrendHistoryRow } from "./TrendsClient"
import { todayInLima } from "@/lib/dates"

export const revalidate = 60

export default async function TrendsPage() {
  // Día de LIMA, no de UTC: el agente escribe sus fechas bajo TZ=America/Lima
  // y el runtime de Vercel corre en UTC, así que de 19:00 a 23:59 hora de
  // Lima esto pedía el día siguiente y la página salía vacía. Ver lib/dates.ts.
  const today = todayInLima()

  const [{ data: trends }, { data: history }, lastRun] = await Promise.all([
    supabase
      .from("daily_trends")
      .select("id, rank, keyword, category, growth_score, approx_traffic, why_trending, news")
      .eq("date", today)
      .order("rank")
      .limit(20),
    supabase
      .from("daily_trends")
      .select("date, keyword, growth_score")
      .order("date", { ascending: false })
      .limit(100),
    getLastRunFinishedAt("radar"),
  ])

  return (
    <TrendsClient
      trends={(trends as Trend[]) ?? []}
      history={(history as TrendHistoryRow[]) ?? []}
      lastRun={lastRun}
    />
  )
}
