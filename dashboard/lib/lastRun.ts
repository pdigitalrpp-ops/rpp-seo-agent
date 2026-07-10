import { supabase } from "./supabase"

export type RunKind = "morning" | "radar"

/**
 * Hora de fin (ISO) de la última corrida del agente del tipo dado, o null.
 * Cada pestaña se alimenta de un orquestador distinto (radar ≈ cada 10 min,
 * morning 1×/día), así que la "última actualización" real sale de ahí.
 */
export async function getLastRunFinishedAt(kind: RunKind): Promise<string | null> {
  const { data } = await supabase
    .from("agent_runs")
    .select("finished_at")
    .eq("kind", kind)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.finished_at ?? null
}
