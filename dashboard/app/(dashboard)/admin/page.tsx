import { supabaseAdmin } from "@/lib/accessServer"
import AdminClient, { type AdminStats } from "./AdminClient"

/**
 * Panel de administración (solo ADMIN_EMAILS, lo impone el middleware).
 * Dinámico a propósito: son datos de acceso, no tiene sentido cachearlos, y
 * todo sale de una sola llamada a dashboard_admin_stats() con service_role.
 */
export const dynamic = "force-dynamic"

export default async function AdminPage() {
  let stats: AdminStats | null = null
  let error: string | null = null
  try {
    const { data, error: err } = await supabaseAdmin().rpc("dashboard_admin_stats")
    if (err) error = err.message
    else stats = data as AdminStats
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
  return <AdminClient stats={stats} />
}
