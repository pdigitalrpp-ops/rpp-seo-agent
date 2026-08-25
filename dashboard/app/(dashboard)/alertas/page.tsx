import { supabase } from "@/lib/supabase"
import { getLastRunFinishedAt } from "@/lib/lastRun"
import { todayInLima } from "@/lib/dates"
import AlertasClient, { Alert, DecayItem } from "./AlertasClient"

export const revalidate = 60

// Las alertas son señales de "tendencia AHORA": pasadas unas horas el tema ya
// jugó/pasó y seguir mostrándolas como activas es engañoso (ver CLAUDE.md,
// mismo patrón que la vigencia de demanda en /busqueda y la ventana de
// /auditoria). No se auto-resuelven en la DB — se ocultan por antigüedad acá.
//
// Filtro por DÍA CALENDARIO de Lima (2026-08-25, a pedido del usuario), no por
// una ventana rolling de 24h: con `created_at >= ahora-24h` el panel mezclaba
// alertas de ayer con las de hoy (a las 10 de la mañana, todavía quedaban 14h
// de ayer dentro de la ventana). Mismo criterio que ya usan Recomendaciones,
// Tendencias y Competencia (ver lib/dates.ts) — se filtra por la columna
// `date`, no por `created_at`.
export default async function AlertasPage() {
  const today = todayInLima()

  const [{ data: activeAlerts, count: totalAlerts }, { data: decayList }, lastRun] = await Promise.all([
    supabase
      .from("alerts")
      // `count: exact` porque el badge decía "30 activa(s)" cuando 30 era el
      // LÍMITE de la consulta, no el número real (el 21-ago había 31).
      .select("id, severity, type, section, score, date, title, description, url",
              { count: "exact" })
      .eq("resolved", false)
      .eq("date", today)
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
      totalAlerts={totalAlerts ?? null}
      decayList={(decayList as DecayItem[]) ?? []}
      lastRun={lastRun}
    />
  )
}
