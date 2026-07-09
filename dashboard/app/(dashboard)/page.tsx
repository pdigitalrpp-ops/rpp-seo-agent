import { supabase } from "@/lib/supabase"
import { StatCard } from "@/components/ui/StatCard"
import { TagBadge } from "@/components/ui/Pill"
import { InfoTooltip } from "@/components/ui/InfoTooltip"

export const revalidate = 60

const URGENCY_COLOR: Record<string, string> = {
  INMEDIATO:      "#DC2626",
  HOY:            "#F97316",
  "ESTA SEMANA":  "#2563EB",
}

export default async function DashboardHome() {
  const today = new Date().toISOString().split("T")[0]

  const [{ data: runs }, { data: recs }, { data: alerts }, { data: trends }, { data: insights }] = await Promise.all([
    supabase.from("agent_runs").select("*").order("run_date", { ascending: false }).limit(1),
    supabase.from("recommendations").select("*").eq("date", today).order("rank"),
    supabase.from("alerts").select("*").eq("resolved", false).order("created_at", { ascending: false }).limit(10),
    supabase.from("daily_trends").select("*").eq("date", today).order("rank").limit(5),
    supabase.from("daily_insights").select("*").eq("date", today).order("created_at").limit(6),
  ])

  const lastRun = runs?.[0]
  const alertCount = alerts?.length ?? 0
  const healthAccent = alertCount === 0 ? "#16A34A" : alertCount <= 2 ? "#F59E0B" : "#DC2626"

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          Resumen del día
          <InfoTooltip align="left">
            Vista rápida del estado SEO del día: salud del sitio, recomendaciones y
            tendencias del momento. Es el punto de partida cada mañana para decidir
            qué priorizar. Se actualiza automáticamente con cada corrida del agente.
          </InfoTooltip>
        </h1>
        <span className="text-sm text-gray-500">
          Última actualización:{" "}
          {lastRun?.finished_at
            ? new Date(lastRun.finished_at).toLocaleString("es-PE", { timeZone: "America/Lima" })
            : "Sin datos"}
        </span>
      </div>

      {/* Fila de KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Salud SEO"
          value={alertCount === 0 ? "Estable" : `${alertCount} alerta(s)`}
          subtitle={alertCount === 0 ? "sin alertas activas" : "revisar sección Alertas"}
          accent={healthAccent}
          info="Semáforo general del sitio según las alertas activas (caídas de tráfico, de posición o content decay). Verde = todo estable; rojo = hay caídas que revisar en la pestaña Alertas."
        />
        <StatCard
          label="Recomendaciones"
          value={recs?.length ?? 0}
          subtitle="del día"
          accent="#F97316"
          info="Cuántas oportunidades de contenido priorizó el agente para hoy. El detalle (título, ángulo y por qué ahora) está en la pestaña Recomendaciones."
        />
        <StatCard
          label="Tendencias"
          value={trends?.length ?? 0}
          subtitle="detectadas ahora"
          accent="#0D9488"
          info="Temas que están creciendo en Google Trends Perú en este momento. Sirven para detectar de qué está hablando la gente y anticipar coberturas."
        />
        <StatCard
          label="Fuentes OK"
          value={`${lastRun?.sources_ok?.length ?? 0}/${(lastRun?.sources_ok?.length ?? 0) + (lastRun?.sources_failed?.length ?? 0)}`}
          subtitle="último run"
          accent="#8B5CF6"
          info="Cuántas fuentes de datos (Marfeel, Search Console, Trends, competencia…) respondieron bien en la última corrida. Si el número baja, algún dato del dashboard puede estar incompleto."
        />
      </div>

      {/* Fuentes del último run */}
      {lastRun && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
            Fuentes del último run
            <InfoTooltip align="left">
              Estado de cada fuente en la última corrida del agente. ✓ = respondió con
              datos; ✗ = falló o no devolvió nada. Útil para saber si algún panel está
              vacío por un problema de la fuente y no por falta de actividad.
            </InfoTooltip>
          </h2>
          <div className="flex flex-wrap gap-2">
            {lastRun.sources_ok?.map((s: string) => (
              <TagBadge key={s} color="#16A34A">{s} ✓</TagBadge>
            ))}
            {lastRun.sources_failed?.map((s: string) => (
              <TagBadge key={s} color="#DC2626">{s} ✗</TagBadge>
            ))}
          </div>
        </div>
      )}

      {/* Insights del benchmark de la mañana */}
      {insights && insights.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-1.5">
            Aprendizajes de hoy
            <InfoTooltip align="left">
              Conclusiones que sacó el benchmark de la mañana al medir qué funcionó ayer
              (qué temas, formatos y secciones rindieron). Estos aprendizajes ajustan
              cómo el radar puntúa los temas el resto del día.
            </InfoTooltip>
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {insights.map((ins: any) => (
              <div key={ins.id} className="bg-white rounded-2xl border border-gray-200 p-4">
                <p className="font-medium text-gray-900 text-sm">{ins.headline}</p>
                {ins.detail && <p className="text-xs text-gray-500 mt-1">{ins.detail}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top recomendaciones */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-1.5">
          Top recomendaciones del día
          <InfoTooltip align="left">
            Las 3 mejores oportunidades de contenido según el score del agente (0–100),
            con la urgencia de publicación y por qué es momento de cubrirlas. La lista
            completa está en la pestaña Recomendaciones.
          </InfoTooltip>
        </h2>
        <div className="grid gap-3">
          {recs?.slice(0, 3).map((rec: any) => (
            <div key={rec.id} className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <TagBadge color={URGENCY_COLOR[rec.urgency] ?? "#2563EB"}>{rec.urgency}</TagBadge>
                  {rec.section && <span className="text-xs text-gray-500">📂 {rec.section}</span>}
                </div>
                <span className="text-sm font-bold text-gray-700">{rec.score}/100</span>
              </div>
              <p className="font-medium text-gray-900 mt-2">{rec.title_suggested}</p>
              <p className="text-sm text-gray-600 mt-1">{rec.angle}</p>
              <p className="text-xs text-gray-400 mt-1">📡 {rec.why_now}</p>
              <p className="text-xs text-gray-400 mt-0.5">🕐 Publicar: {rec.publish_window}</p>
            </div>
          ))}
          {!recs?.length && (
            <p className="text-sm text-gray-500 bg-white rounded-2xl border border-gray-200 p-4">
              Sin recomendaciones para hoy. El agente aún no ha corrido.
            </p>
          )}
        </div>
      </div>

      {/* Tendencias del día */}
      {trends && trends.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-1.5">
            Tendencias en Perú ahora
            <InfoTooltip align="left">
              Los temas que más crecen en Google Trends Perú en este momento, con su
              categoría y un score de crecimiento (0–10). Sirven para detectar temas
              calientes antes que la competencia.
            </InfoTooltip>
          </h2>
          <div className="bg-white rounded-2xl border border-gray-200 divide-y">
            {trends.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between px-4 py-2">
                <span className="text-sm text-gray-700">#{t.rank} {t.keyword}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{t.category}</span>
                  <span className="text-xs font-semibold text-rpp-teal">
                    {t.growth_score?.toFixed(1)}/10
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
