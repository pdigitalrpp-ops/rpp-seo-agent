import { supabase } from "@/lib/supabase"
import TraficoClient, { ChannelRow } from "./TraficoClient"

export const revalidate = 60

async function latestDate(table: string): Promise<string | null> {
  const { data } = await supabase
    .from(table)
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
  return data?.[0]?.date ?? null
}

export default async function TraficoPage() {
  // 1) Intenta datos por canal (grano artículo × canal)
  const chDate = await latestDate("own_traffic_channels")
  let rows: ChannelRow[] = []
  let hasChannelData = false
  let date = chDate ?? new Date().toISOString().split("T")[0]

  if (chDate) {
    const { data } = await supabase
      .from("own_traffic_channels")
      .select("page_path, title, channel, pageviews, unique_users")
      .eq("date", chDate)
      .order("pageviews", { ascending: false })
      .limit(1000)
    rows = (data as ChannelRow[]) ?? []
    hasChannelData = rows.length > 0
  }

  // 2) Fallback: sin datos por canal, usa own_traffic (totales por artículo).
  //    El filtro por Folder sigue funcionando; el de canal queda deshabilitado.
  if (!hasChannelData) {
    const otDate = await latestDate("own_traffic")
    if (otDate) {
      date = otDate
      const { data } = await supabase
        .from("own_traffic")
        .select("page_path, title, sessions, unique_users")
        .eq("date", otDate)
        .order("sessions", { ascending: false })
        .limit(1000)
      rows = (data ?? []).map((r: any) => ({
        page_path: r.page_path,
        title: r.title ?? null,
        channel: null,
        pageviews: r.sessions ?? 0,
        unique_users: r.unique_users ?? null,
      }))
    }
  }

  return <TraficoClient rows={rows} hasChannelData={hasChannelData} date={date} />
}
