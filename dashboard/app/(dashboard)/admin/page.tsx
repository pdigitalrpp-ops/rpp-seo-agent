import { supabaseAdmin } from "@/lib/accessServer"
import AdminClient, { type AdminStats, type CambioLog } from "./AdminClient"

/**
 * Panel de administración (solo ADMIN_EMAILS, lo impone el middleware).
 * Dinámico a propósito: son datos de acceso, no tiene sentido cachearlos, y
 * todo sale de una sola llamada a dashboard_admin_stats() con service_role.
 */
export const dynamic = "force-dynamic"

export default async function AdminPage() {
  let stats: AdminStats | null = null
  let cambios: CambioLog[] = []
  let error: string | null = null
  try {
    const db = supabaseAdmin()
    const [st, log] = await Promise.all([
      db.rpc("dashboard_admin_stats"),
      db.rpc("dashboard_change_log_recent", { p_limit: 200 }),
    ])
    if (st.error) error = st.error.message
    else stats = st.data as AdminStats
    cambios = (log.data as CambioLog[] | null) ?? []
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
  return <AdminClient stats={stats} cambios={cambios} />
}
