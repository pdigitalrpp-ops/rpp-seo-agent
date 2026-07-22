import { supabase } from "@/lib/supabase"
import { getLastRunFinishedAt } from "@/lib/lastRun"
import AlertasClient, { Alert, DecayItem } from "./AlertasClient"

export const revalidate = 60

// Las alertas son señales de "tendencia AHORA": pasadas unas horas el tema ya
// jugó/pasó y seguir mostrándolas como activas es engañoso (ver CLAUDE.md,
// mismo patrón que la vigencia de demanda en /busqueda y la ventana de
// /auditoria). No se auto-resuelven en la DB — se ocultan por antigüedad acá.
const ALERT_WINDOW_HOURS = 24

export default async function AlertasPage() {
  const cutoff = new Date(Date.now() - ALERT_WINDOW_HOURS * 60 * 60 * 1000).toISOString()

  const [{ data: activeAlerts }, { data: decayList }, lastRun] = await Promise.all([
    supabase
      .from("alerts")
      .select("id, severity, type, section, score, date, title, description, url")
      .eq("resolved", false)
      .gte("created_at", cutoff)
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
