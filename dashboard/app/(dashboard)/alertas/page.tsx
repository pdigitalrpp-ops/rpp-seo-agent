import { supabase } from "@/lib/supabase"

export const revalidate = 60

const SEVERITY_STYLES: Record<string, string> = {
  high:   "border-l-4 border-red-500 bg-red-50",
  medium: "border-l-4 border-yellow-500 bg-yellow-50",
  low:    "border-l-4 border-blue-500 bg-blue-50",
}

const SEVERITY_BADGE: Record<string, string> = {
  high:   "bg-red-100 text-red-700",
  medium: "bg-yellow-100 text-yellow-700",
  low:    "bg-blue-100 text-blue-700",
}

const TYPE_LABEL: Record<string, string> = {
  traffic_drop:   "Caída de tráfico",
  decay:          "Content decay",
  position_drop:  "Caída de posición",
  trending_topic: "Tema en tendencia",
}

export default async function AlertasPage() {
  const [{ data: activeAlerts }, { data: decayList }] = await Promise.all([
    supabase
      .from("alerts")
      .select("*")
      .eq("resolved", false)
      .order("created_at", { ascending: false })
      .limit(30),

    supabase
      .from("content_decay")
      .select("*")
      .eq("resolved", false)
      .order("drop_percentage", { ascending: false })
      .limit(20),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Alertas</h1>
        <span className={`text-sm font-medium px-3 py-1 rounded-full ${
          !activeAlerts?.length ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
        }`}>
          {activeAlerts?.length ?? 0} activa(s)
        </span>
      </div>

      {/* Alertas activas */}
      <div className="space-y-3">
        {!activeAlerts?.length && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
            <p className="text-green-700 font-medium">Sin alertas activas</p>
            <p className="text-green-600 text-sm mt-1">El agente no detectó caídas significativas.</p>
          </div>
        )}
        {activeAlerts?.map((alert: any) => (
          <div key={alert.id} className={`rounded-xl p-4 ${SEVERITY_STYLES[alert.severity] ?? "bg-gray-50 border-l-4 border-gray-300"}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${SEVERITY_BADGE[alert.severity] ?? "bg-gray-100 text-gray-600"}`}>
                  {alert.severity?.toUpperCase()}
                </span>
                <span className="text-xs text-gray-500">
                  {TYPE_LABEL[alert.type] ?? alert.type}
                </span>
                {alert.section && (
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">📂 {alert.section}</span>
                )}
                {alert.score != null && (
                  <span className="text-xs font-bold text-red-600">{alert.score}/100</span>
                )}
              </div>
              <span className="text-xs text-gray-400 shrink-0">
                {alert.date}
              </span>
            </div>
            <p className="font-semibold text-gray-900 mt-2">{alert.title}</p>
            {alert.description && (
              <p className="text-sm text-gray-600 mt-1">{alert.description}</p>
            )}
            {alert.url && (
              <p className="text-xs text-gray-400 mt-1 font-mono truncate">{alert.url}</p>
            )}
          </div>
        ))}
      </div>

      {/* Content Decay */}
      {decayList && decayList.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">Content Decay detectado</h2>
          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50">
              <p className="text-xs text-gray-500">Artículos cuyo tráfico cayó más del 20% respecto a su pico histórico</p>
            </div>
            <div className="divide-y max-h-96 overflow-y-auto">
              {decayList.map((item: any) => (
                <div key={item.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-gray-500 font-mono truncate flex-1">{item.page_path}</p>
                    <span className="text-sm font-bold text-red-600 shrink-0">
                      -{item.drop_percentage?.toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex gap-4 mt-1 text-xs text-gray-500">
                    <span>Pico: <strong>{(item.peak_traffic ?? 0).toLocaleString()}</strong> ses.</span>
                    <span>Actual: <strong>{(item.current_traffic ?? 0).toLocaleString()}</strong> ses.</span>
                  </div>
                  <p className="text-xs text-blue-600 mt-1">{item.suggested_action}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
