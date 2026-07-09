import { supabase } from "@/lib/supabase"
import { TagBadge } from "@/components/ui/Pill"
import { InfoTooltip } from "@/components/ui/InfoTooltip"

export const revalidate = 60

const URGENCY_COLOR: Record<string, string> = {
  INMEDIATO:      "#DC2626",
  HOY:            "#F97316",
  "ESTA SEMANA":  "#2563EB",
}

export default async function RecomendacionesPage() {
  const today = new Date().toISOString().split("T")[0]

  const { data: recs } = await supabase
    .from("recommendations")
    .select("*")
    .eq("date", today)
    .order("rank")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          Recomendaciones del día
          <InfoTooltip align="left">
            Oportunidades de contenido que el agente sugiere cubrir hoy, ordenadas por
            un score 0–100 que combina tendencia de mercado, brecha frente a la
            competencia y potencial en Discover. Cada tarjeta trae un título sugerido,
            el ángulo diferencial, por qué es momento de publicarlo y la ventana ideal.
          </InfoTooltip>
        </h1>
        <span className="text-sm text-gray-500">{today}</span>
      </div>

      {!recs?.length && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-500 text-sm">
          Sin recomendaciones para hoy. El agente aún no ha corrido o no encontró señales suficientes.
        </div>
      )}

      <div className="grid gap-4">
        {recs?.map((rec: any) => (
          <div key={rec.id} className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-bold text-gray-400">#{rec.rank}</span>
                <TagBadge color={URGENCY_COLOR[rec.urgency] ?? "#6b7280"}>{rec.urgency}</TagBadge>
                <TagBadge color="#6b7280">{rec.format}</TagBadge>
                {rec.section && <TagBadge color="#8B5CF6">📂 {rec.section}</TagBadge>}
              </div>
              <div className="text-right shrink-0">
                <span className="text-xl font-bold text-gray-900">{rec.score}</span>
                <span className="text-xs text-gray-400">/100</span>
              </div>
            </div>

            {/* Título sugerido */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Título sugerido</p>
              <p className="font-semibold text-gray-900">{rec.title_suggested}</p>
            </div>

            {/* Ángulo */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Ángulo diferencial</p>
              <p className="text-sm text-gray-700">{rec.angle}</p>
            </div>

            {/* Por qué ahora */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <p className="text-xs font-semibold text-amber-700 mb-0.5">Por qué ahora</p>
              <p className="text-xs text-amber-800">{rec.why_now}</p>
            </div>

            {/* Metadata */}
            <div className="flex flex-wrap gap-3 text-xs text-gray-500">
              <span>🕐 Publicar: <strong>{rec.publish_window}</strong></span>
              <span>📁 Categoría: <strong>{rec.category}</strong></span>
              <span>📡 Fuente: <strong>{rec.data_source}</strong></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
