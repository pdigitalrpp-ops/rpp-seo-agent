import { supabase } from "@/lib/supabase"
import { getLastRunFinishedAt } from "@/lib/lastRun"
import { isRealArticle } from "@/lib/articleFilter"
import TraficoClient, { ChannelRow } from "./TraficoClient"
import type { TrendChannelMeta, TrendPoint } from "./ChannelTrendChart"

export const revalidate = 60

const TREND_WINDOW_DAYS = 14
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

/** Snapshot de un día: prioriza tráfico por canal, cae a own_traffic (totales) si no hay. */
async function fetchDaySnapshot(date: string): Promise<{ rows: ChannelRow[]; hasChannelData: boolean }> {
  const { data: chData } = await supabase
    .from("own_traffic_channels")
    .select("page_path, title, channel, pageviews, unique_users")
    .eq("date", date)
    .limit(2000)

  if (chData && chData.length > 0) {
    return { rows: chData as ChannelRow[], hasChannelData: true }
  }

  const { data: otData } = await supabase
    .from("own_traffic")
    .select("page_path, title, sessions, unique_users")
    .eq("date", date)
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

export default async function TraficoPage({
  searchParams,
}: {
  searchParams: { date?: string }
}) {
  // Días con corrida matutina exitosa = días con datos de tráfico disponibles.
  const { data: runsData } = await supabase
    .from("agent_runs")
    .select("run_date")
    .eq("kind", "morning")
    .eq("status", "success")
    .order("run_date", { ascending: false })
    .limit(90)

  const availableDates = Array.from(new Set((runsData ?? []).map((r: any) => r.run_date as string))).sort()

  const todayIso = new Date().toISOString().slice(0, 10)
  const latestDate = availableDates[availableDates.length - 1] ?? todayIso
  const requested = searchParams.date
  const selectedDate = requested && availableDates.includes(requested) ? requested : latestDate

  const selIdx = availableDates.indexOf(selectedDate)
  const previousDate = selIdx > 0 ? availableDates[selIdx - 1] : null

  const [{ rows, hasChannelData }, prevSnapshot, lastRun] = await Promise.all([
    fetchDaySnapshot(selectedDate),
    previousDate ? fetchDaySnapshot(previousDate) : Promise.resolve(null),
    getLastRunFinishedAt("morning"),
  ])

  // ── Evolución por canal: ventana de TREND_WINDOW_DAYS terminando en la fecha vista ──
  const trendStart = addDaysIso(selectedDate, -(TREND_WINDOW_DAYS - 1))
  const { data: trendRaw } = await supabase
    .from("own_traffic_channels")
    .select("date, page_path, channel, pageviews")
    .gte("date", trendStart)
    .lte("date", selectedDate)
    .limit(15000)

  const trendRows = (trendRaw ?? []).filter((r: any) => isRealArticle(r.page_path))

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

  const byDate: Record<string, Record<string, number>> = {}
  for (const r of trendRows) {
    const rawC = r.channel || "Otros"
    const c = topChannels.includes(rawC) ? rawC : "Otros"
    byDate[r.date] ??= {}
    byDate[r.date][c] = (byDate[r.date][c] ?? 0) + (r.pageviews ?? 0)
  }
  const trendData: TrendPoint[] = Object.keys(byDate)
    .sort()
    .map((date) => ({ date, ...byDate[date] }))

  return (
    <TraficoClient
      rows={rows}
      hasChannelData={hasChannelData}
      date={selectedDate}
      availableDates={availableDates}
      prevRows={prevSnapshot?.rows ?? null}
      previousDate={previousDate}
      trendData={trendData}
      trendChannels={trendChannels}
      lastRun={lastRun}
    />
  )
}
