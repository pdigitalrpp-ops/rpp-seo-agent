import { supabaseAdmin } from "@/lib/accessServer"
import AdminClient, { type AdminStats, type CambioLog } from "./AdminClient"
import type { Destinatario, OpcionSeccion, UltimoEnvio } from "./DestinatariosCard"
import { CATEGORIAS_TENDENCIAS } from "@/lib/tendenciasCorreo"
import { sectionGroup } from "@/lib/articleFilter"

/**
 * Panel de administración (solo ADMIN_EMAILS, lo impone el middleware).
 * Dinámico a propósito: son datos de acceso, no tiene sentido cachearlos, y
 * todo sale de una sola llamada a dashboard_admin_stats() con service_role.
 */
export const dynamic = "force-dynamic"
// force-dynamic NO basta: sin esto Next guarda los fetch de la página en su
// Data Cache sin vencimiento (ver supabaseAdmin en lib/accessServer.ts).
export const fetchCache = "force-no-store"

export default async function AdminPage() {
  let stats: AdminStats | null = null
  let cambios: CambioLog[] = []
  let destinatarios: Destinatario[] = []
  let envios: UltimoEnvio[] = []
  let secciones: OpcionSeccion[] = []
  let error: string | null = null
  try {
    const db = supabaseAdmin()
    const [st, log, dest, env, secs] = await Promise.all([
      db.rpc("dashboard_admin_stats"),
      db.rpc("dashboard_change_log_recent", { p_limit: 200 }),
      db.from("notification_recipients").select("*").order("created_at", { ascending: true }),
      db.from("notification_log").select("email, kind, sent_at")
        .gte("sent_at", new Date(Date.now() - 14 * 86400000).toISOString())
        .order("sent_at", { ascending: false }).limit(1000),
      db.from("own_traffic_sections").select("date, section, page_views")
        .order("date", { ascending: false }).limit(400),
    ])
    if (st.error) error = st.error.message
    else stats = st.data as AdminStats
    cambios = (log.data as CambioLog[] | null) ?? []
    destinatarios = (dest.data as Destinatario[] | null) ?? []
    envios = (env.data as UltimoEnvio[] | null) ?? []
    // Secciones para el correo de tráfico: las del último día con dato,
    // agrupadas como en /trafico (los deportes van juntos) y sin "Unknown",
    // que es el cajón de Marfeel para portada y homes.
    const filas = (secs.data ?? []) as { date: string; section: string; page_views: number }[]
    const ultimo = filas[0]?.date
    const porClave: Record<string, OpcionSeccion> = {}
    filas.filter((r) => r.date === ultimo).forEach((r) => {
      const key = sectionGroup(r.section)
      if (!key || key === "unknown" || r.section.indexOf(",") >= 0) return
      const o = porClave[key] ?? { key, label: key === "deportes" ? "Deportes" : r.section, page_views: 0 }
      o.page_views += r.page_views ?? 0
      porClave[key] = o
    })
    secciones = Object.keys(porClave).map((k) => porClave[k])
      .sort((a, b) => b.page_views - a.page_views).slice(0, 30)
  } catch (e) {
    error = e instanceof Error ? e.message : "Error desconocido"
  }

  if (!stats) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        No se pudieron cargar las estadísticas: {error}
      </div>
    )
  }
  return (
    <AdminClient
      stats={stats} cambios={cambios}
      destinatarios={destinatarios} envios={envios}
      categorias={CATEGORIAS_TENDENCIAS} secciones={secciones}
    />
  )
}
