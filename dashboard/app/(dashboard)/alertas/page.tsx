import { supabase } from "@/lib/supabase"
import { getLastRunFinishedAt } from "@/lib/lastRun"
import AlertasClient, { Alert, DecayItem } from "./AlertasClient"
import { WatchKeyword, WatchHit } from "./VigilanciaPanel"

export const revalidate = 60

// Las alertas son señales de "tendencia AHORA": pasadas unas horas el tema ya
// jugó/pasó y seguir mostrándolas como activas es engañoso (ver CLAUDE.md,
// mismo patrón que la vigencia de demanda en /busqueda y la ventana de
// /auditoria). No se auto-resuelven en la DB — se ocultan por antigüedad acá.
const ALERT_WINDOW_HOURS = 24

// La vigilancia por keyword usa una ventana más larga que las alertas de
// tendencia: no es "algo está rompiendo ahora" sino "esto se publicó sobre un
// tema que sigues", y un tema de nicho puede tener una sola nota en todo el día.
const WATCH_WINDOW_HOURS = 48

export default async function AlertasPage() {
  const cutoff = new Date(Date.now() - ALERT_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
  const watchCutoff = new Date(Date.now() - WATCH_WINDOW_HOURS * 60 * 60 * 1000).toISOString()

  const [
    { data: activeAlerts },
    { data: decayList },
    { data: watchKeywords },
    { data: watchHits },
    lastRun,
  ] = await Promise.all([
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

    // Incluye las pausadas (active=false): el panel deja reanudarlas.
    supabase
      .from("watch_keywords")
      .select("id, keyword, label, active, section, extra_feeds")
      .order("created_at", { ascending: true }),

    // Orden por fecha de PUBLICACIÓN, no por cuándo lo encontró el agente: lo
    // que importa es qué salió más reciente. nullsFirst:false manda al fondo
    // los feeds que no traen fecha.
    supabase
      .from("watch_hits")
      .select("id, keyword_id, keyword, title, url, source, published_at, found_via, created_at")
      .eq("dismissed", false)
      .gte("created_at", watchCutoff)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(200),

    getLastRunFinishedAt("radar"),
  ])

  return (
    <AlertasClient
      alerts={(activeAlerts as Alert[]) ?? []}
      decayList={(decayList as DecayItem[]) ?? []}
      watchKeywords={(watchKeywords as WatchKeyword[]) ?? []}
      watchHits={(watchHits as WatchHit[]) ?? []}
      lastRun={lastRun}
    />
  )
}
