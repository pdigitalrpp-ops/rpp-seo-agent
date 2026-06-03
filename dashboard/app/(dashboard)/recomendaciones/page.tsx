import { supabase } from "@/lib/supabase"

export const revalidate = 3600

const URGENCY_COLORS: Record<string, string> = {
  INMEDIATO:    "bg-red-100 text-red-700 border-red-200",
  HOY:          "bg-orange-100 text-orange-700 border-orange-200",
  "ESTA SEMANA": "bg-blue-100 text-blue-700 border-blue-200",
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
        <h1 className="text-2xl font-bold text-gray-900">Recomendaciones del día</h1>
        <span className="text-sm text-gray-500">{today}</span>
      </div>

      {!recs?.length && (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-500 text-sm">
          Sin recomendaciones para hoy. El agente aún no ha corrido o no encontró señales suficientes.
        </div>
      )}

      <div className="grid gap-4">
        {recs?.map((rec: any) => (
          <div key={rec.id} className="bg-white rounded-xl border p-5 space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-bold text-gray-400">#{rec.rank}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded border ${URGENCY_COLORS[rec.urgency] ?? "bg-gray-100 text-gray-600"}`}>
                  {rec.urgency}
                </span>
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{rec.format}</span>
                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">{rec.program}</span>
              </div>
              <div className="text-right shrink-0">
                <span className="text-xl font-bold text-red-600">{rec.score}</span>
                <span className="text-xs text-gray-400">/10</span>
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
