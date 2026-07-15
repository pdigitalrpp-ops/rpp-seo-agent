import { supabase } from "@/lib/supabase"
import { getLastRunFinishedAt } from "@/lib/lastRun"
import AlertasClient, { Alert, DecayItem } from "./AlertasClient"

export const revalidate = 60

export default async function AlertasPage() {
  const [{ data: activeAlerts }, { data: decayList }, lastRun] = await Promise.all([
    supabase
      .from("alerts")
      .select("id, severity, type, section, score, date, title, description, url")
      .eq("resolved", false)
      .order("created_at", { ascending: false })
      .limit(30),

    supabase
      .from("content_decay")
      .select("id, page_path, drop_percentage, peak_traffic, current_traffic, suggested_action")
      .eq("resolved", false)
      .order("drop_percentage", { ascending: false })
      .limit(20),

    getLastRunFinishedAt("radar"),
  ])

  return (
    <AlertasClient
      alerts={(activeAlerts as Alert[]) ?? []}
      decayList={(decayList as DecayItem[]) ?? []}
      lastRun={lastRun}
    />
  )
}
