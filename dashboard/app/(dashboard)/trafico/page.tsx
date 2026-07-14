import { supabase } from "@/lib/supabase"
import { getLastRunFinishedAt } from "@/lib/lastRun"
import { isRealArticle } from "@/lib/articleFilter"
import TraficoClient, { ChannelRow } from "./TraficoClient"
import type { TrendChannelMeta, TrendPoint } from "./ChannelTrendChart"

export const revalidate = 60

const TREND_WINDOW_DAYS = 7
const MAX_INDIVIDUAL_CHANNELS = 5
// Paleta categórica validada (references/palette.md de la skill dataviz), en
// orden fijo por ranking de volumen — el color de un canal no cambia si otro
// canal sube o baja de puesto entre corridas.
const CHANNEL_COLORS = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7"]
const OTHER_COLOR = "#9ca3af"

function addDaysIso(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/**
 * SEMÁNTICA DE FECHAS (clave): el benchmark que corre el día X guarda en
 * own_traffic/own_traffic_channels filas con date=X, pero el tráfico medido
 * es el del día COMPLETO anterior (X-1, "yesterday" de Marfeel). Toda la UI
 * de esta pestaña habla en "día del dato" (X-1); estas dos funciones traducen.
 */
function dataDayOf(runDate: string): string {
  return addDaysIso(runDate, -1)
}
function runDateOf(dataDay: string): string {
  return addDaysIso(dataDay, 1)
}

/** Snapshot de un día de dato: prioriza tráfico por canal, cae a own_traffic si no hay. */
async function fetchDaySnapshot(dataDay: string): Promise<{ rows: ChannelRow[]; hasChannelData: boolean }> {
  const runDate = runDateOf(dataDay)
  const { data: chData } = await supabase
    .from("own_traffic_channels")
    .select("page_path, title, channel, pageviews, unique_users")
    .eq("date", runDate)
    .limit(2000)

  if (chData && chData.length > 0) {
    return { rows: chData as ChannelRow[], hasChannelData: true }
  }

  const { data: otData } = await supabase
    .from("own_traffic")
    .select("page_path, title, sessions, unique_users")
    .eq("date", runDate)
    .limit(2000)

  const rows: ChannelRow[] = (otData ?? []).map((r: any) => ({
    page_path: r.page_path,
    title: r.title ?? null,
    channel: null,
    pageviews: r.sessions ?? 0,
    unique_users: r.unique_users ?? null,
  }))
  return { rows, hasChannelData: false }
}

/**
 * Trae TODAS las filas por canal de un rango de fechas de corrida, paginando.
 * PostgREST capea cada respuesta a ~1000 filas aunque se pida .limit(15000) —
 * por eso el gráfico salía "incompleto" (solo llegaban los primeros días del
 * rango). El orden por (date, page_path, channel) hace la paginación estable.
 */
async function fetchChannelRowsPaged(startRunDate: string, endRunDate: string) {
  const PAGE = 1000
  const all: { date: string; page_path: string; channel: string | null; pageviews: number | null }[] = []
  for (let from = 0; from < 20000; from += PAGE) {
    const { data } = await supabase
      .from("own_traffic_channels")
      .select("date, page_path, channel, pageviews")
      .gte("date", startRunDate)
      .lte("date", endRunDate)
      .order("date", { ascending: true })
      .order("page_path", { ascending: true })
      .order("channel", { ascending: true })
      .range(from, from + PAGE - 1)
    if (!data || data.length === 0) break
    all.push(...(data as any[]))
    if (data.length < PAGE) break
  }
  return all
}

export default async function TraficoPage({
  searchParams,
}: {
  searchParams: { date?: string }
}) {
  // Días con corrida matutina exitosa → días de dato disponibles (run - 1).
  const { data: runsData } = await supabase
    .from("agent_runs")
    .select("run_date")
    .eq("kind", "morning")
    .eq("status", "success")
    .order("run_date", { ascending: false })
    .limit(90)

  const availableDataDays = Array.from(
    new Set((runsData ?? []).map((r: any) => dataDayOf(r.run_date as string))),
  ).sort()

  const yesterdayIso = addDaysIso(new Date().toISOString().slice(0, 10), -1)
  const latestDataDay = availableDataDays[availableDataDays.length - 1] ?? yesterdayIso
  const requested = searchParams.date
  const selectedDay = requested && availableDataDays.includes(requested) ? requested : latestDataDay

  const selIdx = availableDataDays.indexOf(selectedDay)
  const previousDay = selIdx > 0 ? availableDataDays[selIdx - 1] : null

  const [{ rows, hasChannelData }, prevSnapshot, lastRun] = await Promise.all([
    fetchDaySnapshot(selectedDay),
    previousDay ? fetchDaySnapshot(previousDay) : Promise.resolve(null),
    getLastRunFinishedAt("morning"),
  ])

  // ── Evolución por canal: ventana fija de los últimos TREND_WINDOW_DAYS días
  // de dato, terminando en el último disponible (ayer si el benchmark ya corrió).
  const windowDays: string[] = Array.from({ length: TREND_WINDOW_DAYS }, (_, i) =>
    addDaysIso(latestDataDay, -(TREND_WINDOW_DAYS - 1 - i)),
  )
  const trendRaw = await fetchChannelRowsPaged(runDateOf(windowDays[0]), runDateOf(latestDataDay))
  const trendRows = trendRaw.filter((r) => isRealArticle(r.page_path))

  const totalsByChannel: Record<string, number> = {}
  for (const r of trendRows) {
    const c = r.channel || "Otros"
    totalsByChannel[c] = (totalsByChannel[c] ?? 0) + (r.pageviews ?? 0)
  }
  const rankedChannels = Object.entries(totalsByChannel).sort((a, b) => b[1] - a[1])
  const topChannels = rankedChannels.slice(0, MAX_INDIVIDUAL_CHANNELS).map(([c]) => c)
  const hasOtros = rankedChannels.length > MAX_INDIVIDUAL_CHANNELS

  const trendChannels: TrendChannelMeta[] = topChannels.map((c, i) => ({
    key: c,
    label: c,
    color: CHANNEL_COLORS[i % CHANNEL_COLORS.length],
  }))
  if (hasOtros) trendChannels.push({ key: "Otros", label: "Otros canales", color: OTHER_COLOR })

  const byDataDay: Record<string, Record<string, number>> = {}
  for (const r of trendRows) {
    const day = dataDayOf(r.date)
    const rawC = r.channel || "Otros"
    const c = topChannels.includes(rawC) ? rawC : "Otros"
    byDataDay[day] ??= {}
    byDataDay[day][c] = (byDataDay[day][c] ?? 0) + (r.pageviews ?? 0)
  }
  // Un punto por día calendario de la ventana. Día con corrida: canal ausente = 0
  // (la línea no se corta); día SIN corrida: sin claves → hueco que connectNulls puentea.
  const trendData: TrendPoint[] = windowDays.map((day) => {
    const perChannel = byDataDay[day]
    if (!perChannel) return { date: day }
    const point: TrendPoint = { date: day }
    for (const ch of trendChannels) point[ch.key] = perChannel[ch.key] ?? 0
    return point
  })

  return (
    <TraficoClient
      rows={rows}
      hasChannelData={hasChannelData}
      date={selectedDay}
      availableDates={availableDataDays}
      prevRows={prevSnapshot?.rows ?? null}
      previousDate={previousDay}
      trendData={trendData}
      trendChannels={trendChannels}
      lastRun={lastRun}
    />
  )
}
