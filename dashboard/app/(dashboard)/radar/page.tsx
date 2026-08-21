import { supabase } from "@/lib/supabase"
import { getLastRunFinishedAt } from "@/lib/lastRun"
import RadarClient from "./RadarClient"
import type { WatchKeyword, WatchHit } from "./types"

export const revalidate = 60

/**
 * Se traen 7 DÍAS de hallazgos aunque la vista arranque en 48 h: el selector de
 * ventana del panel (24 h / 48 h / 7 días) filtra en cliente, así cambiar de
 * ventana es instantáneo y no dispara otra consulta. 500 filas es techo de
 * sobra — el tope real son WATCH_MAX_HITS_PER_KEYWORD (10) ×
 * WATCH_MAX_ACTIVE_KEYWORDS (25) por corrida, casi todo deduplicado por la
 * constraint (keyword_id, url).
 */
const FETCH_WINDOW_DAYS = 7

export default async function RadarPage() {
  const cutoff = new Date(
    Date.now() - FETCH_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  const [{ data: keywords }, { data: hits }, lastRun] = await Promise.all([
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
      .gte("created_at", cutoff)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(500),

    getLastRunFinishedAt("radar"),
  ])

  return (
    <RadarClient
      keywords={(keywords as WatchKeyword[]) ?? []}
      hits={(hits as WatchHit[]) ?? []}
      lastRun={lastRun}
      // La hora la fija el SERVIDOR y el cliente la reusa en su primer render.
      // Sin esto hay error de hidratacion (#425/#418/#423, visto en el preview):
      // esta pestaña deriva de la hora casi todo lo que pinta —la ventana, la
      // agrupacion por dia, los "hace X min"— asi que el HTML del servidor y el
      // primer render del cliente salen distintos por los milisegundos que los
      // separan. Ya montado, RadarClient pasa a su propio reloj.
      serverNow={Date.now()}
    />
  )
}
