import { supabase } from "@/lib/supabase"
import { getLastRunFinishedAt } from "@/lib/lastRun"
import AuditoriaClient from "./AuditoriaClient"

export const revalidate = 60

export default async function AuditoriaPage() {
  // Solo la última semana: las auditorías viejas salen de la vista para que la
  // lista no crezca sin límite (el morning re-audita lo que sigue rindiendo).
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)

  const [{ data: audits }, { data: checkRows }, lastRun] = await Promise.all([
    supabase
      .from("onpage_audits")
      .select("*")
      .gte("audited_date", weekAgo)
      .order("audited_date", { ascending: false })
      .order("score", { ascending: true })
      .limit(100),
    // Estado del checklist (marcado manual del equipo). Tabla pequeña: se trae entera.
    supabase.from("audit_check_state").select("id, done"),
    getLastRunFinishedAt("morning"),
  ])

  const checks: Record<string, boolean> = {}
  for (const r of checkRows ?? []) checks[r.id] = !!r.done

  return <AuditoriaClient audits={audits ?? []} initialChecks={checks} lastRun={lastRun} />
}
