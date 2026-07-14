import { supabase } from "@/lib/supabase"
import { TagBadge } from "@/components/ui/Pill"
import { InfoTooltip } from "@/components/ui/InfoTooltip"
import { LastUpdated } from "@/components/ui/LastUpdated"
import { getLastRunFinishedAt } from "@/lib/lastRun"

export const revalidate = 60

const URGENCY_COLOR: Record<string, string> = {
  INMEDIATO:      "#DC2626",
  HOY:            "#F97316",
  "ESTA SEMANA":  "#2563EB",
}

export default async function RecomendacionesPage() {
  const today = new Date().toISOString().split("T")[0]

  const [{ data: recs }, lastRun] = await Promise.all([
    supabase.from("recommendations").select("*").eq("date", today).order("rank"),
    getLastRunFinishedAt("radar"),
  ])

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
        <LastUpdated kind="radar" finishedAt={lastRun} />
      </div>

      {!recs?.length && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-500 text-sm">
          Sin recomendaciones para hoy. El agente aún no ha corrido o no encontró señales suficientes.
        </div>
      )}

      <div className="grid gap-4">
        {recs?.map((rec: any) => {
          const urgencyColor = URGENCY_COLOR[rec.urgency] ?? "#6b7280"
          return (
            <div
              key={rec.id}
              className="bg-white rounded-2xl border border-gray-200 p-5 transition hover:border-gray-300 hover:shadow-sm"
              style={{ borderLeftWidth: 4, borderLeftColor: urgencyColor }}
            >
              <div className="flex gap-4 md:gap-5">
                {/* Panel de score (izquierda) — rank + puntaje + barra por urgencia */}
                <div className="shrink-0 w-16 md:w-20 flex flex-col items-center text-center border-r border-gray-100 pr-4">
                  <span className="text-xs font-bold text-gray-300">#{rec.rank}</span>
                  <span className="text-3xl font-extrabold text-gray-900 leading-none mt-1">{rec.score}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mt-0.5">
                    score /100
                  </span>
                  <div className="h-1.5 w-full rounded-full bg-gray-100 mt-2">
                    <div
                      className="h-1.5 rounded-full"
                      style={{ width: `${Math.min(100, rec.score ?? 0)}%`, backgroundColor: urgencyColor }}
                    />
                  </div>
                </div>

                {/* Contenido (derecha) */}
                <div className="min-w-0 flex-1 space-y-3">
                  {/* Badges */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <TagBadge color={urgencyColor}>{rec.urgency}</TagBadge>
                    <TagBadge color="#6b7280">{rec.format}</TagBadge>
                    {rec.section && <TagBadge color="#8B5CF6">📂 {rec.section}</TagBadge>}
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
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
