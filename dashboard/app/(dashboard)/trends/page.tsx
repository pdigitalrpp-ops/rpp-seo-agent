import { supabase } from "@/lib/supabase"
import { getLastRunFinishedAt } from "@/lib/lastRun"
import TrendsClient, { Trend, TrendHistoryRow } from "./TrendsClient"

export const revalidate = 60

export default async function TrendsPage() {
  const today = new Date().toISOString().split("T")[0]

  const [{ data: trends }, { data: history }, lastRun] = await Promise.all([
    supabase
      .from("daily_trends")
      .select("id, rank, keyword, category, growth_score, why_trending, news")
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
