import type { ReactNode } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { StatCard } from "@/components/ui/StatCard"
import { TagBadge } from "@/components/ui/Pill"
import { InfoTooltip } from "@/components/ui/InfoTooltip"
import { LastUpdated } from "@/components/ui/LastUpdated"
import { RunAgentButton } from "@/components/RunAgentButton"

export const revalidate = 60

const URGENCY_COLOR: Record<string, string> = {
  INMEDIATO:      "#DC2626",
  HOY:            "#F97316",
  "ESTA SEMANA":  "#2563EB",
}

/** Título de sección con tooltip y link opcional "Ver todo →" a la pestaña de detalle. */
function SectionHeader({
  title,
  info,
  href,
  hrefLabel = "Ver todo",
}: {
  title: string
  info: ReactNode
  href?: string
  hrefLabel?: string
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <h2 className="text-base font-semibold text-gray-800 flex items-center gap-1.5">
        {title}
        <InfoTooltip align="left">{info}</InfoTooltip>
      </h2>
      {href && (
        <Link href={href} className="text-xs font-semibold text-rpp-teal hover:text-teal-700 shrink-0">
          {hrefLabel} →
        </Link>
      )}
    </div>
  )
}

export default async function DashboardHome() {
  const today = new Date().toISOString().split("T")[0]

  const [{ data: runs }, { data: recs }, { data: alerts }, { data: trends }, { data: insights }] = await Promise.all([
    supabase.from("agent_runs").select("*").order("finished_at", { ascending: false }).limit(1),
    supabase.from("recommendations").select("*").eq("date", today).order("rank"),
    supabase.from("alerts").select("*").eq("resolved", false).order("created_at", { ascending: false }).limit(10),
    supabase.from("daily_trends").select("*").eq("date", today).order("rank").limit(5),
    supabase.from("daily_insights").select("*").eq("date", today).order("created_at").limit(6),
  ])

  const lastRun = runs?.[0]
  const alertCount = alerts?.length ?? 0
  const healthAccent = alertCount === 0 ? "#16A34A" : alertCount <= 2 ? "#F59E0B" : "#DC2626"
  const sourcesOk = lastRun?.sources_ok?.length ?? 0
  const sourcesFailed = lastRun?.sources_failed?.length ?? 0
  const sourcesTotal = sourcesOk + sourcesFailed

  const fechaLima = new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date())
  const fecha = fechaLima.charAt(0).toUpperCase() + fechaLima.slice(1)

  return (
    <div className="space-y-6">
      {/* Encabezado de página: fecha + título a la izquierda, acciones a la derecha */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{fecha}</p>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 mt-0.5">
            Resumen del día
            <InfoTooltip align="left">
              Vista rápida del estado SEO del día: salud del sitio, recomendaciones y
              tendencias del momento. Es el punto de partida cada mañana para decidir
              qué priorizar. Se actualiza automáticamente con cada corrida del agente.
            </InfoTooltip>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <LastUpdated kind="mixed" finishedAt={lastRun?.finished_at} />
          <RunAgentButton />
        </div>
      </div>

      {/* KPIs del día — cada tarjeta lleva a su pestaña */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          href="/alertas"
          label="Salud SEO"
          value={alertCount === 0 ? "Estable" : `${alertCount} alerta(s)`}
          subtitle={alertCount === 0 ? "sin alertas activas" : "revisar Alertas"}
          accent={healthAccent}
          info="Semáforo general del sitio según las alertas activas (caídas de tráfico, de posición o content decay). Verde = todo estable; rojo = hay caídas que revisar en la pestaña Alertas."
        />
        <StatCard
          href="/recomendaciones"
          label="Recomendaciones"
          value={recs?.length ?? 0}
          subtitle="del día"
          accent="#F97316"
          info="Cuántas oportunidades de contenido priorizó el agente para hoy. El detalle (título, ángulo y por qué ahora) está en la pestaña Recomendaciones."
        />
        <StatCard
          href="/trends"
          label="Tendencias"
          value={trends?.length ?? 0}
          subtitle="detectadas ahora"
          accent="#0D9488"
          info="Temas que están creciendo en Google Trends Perú en este momento. Sirven para detectar de qué está hablando la gente y anticipar coberturas."
        />
        <StatCard
          href="/status"
          label="Fuentes OK"
          value={`${sourcesOk}/${sourcesTotal}`}
          subtitle="último run"
          accent="#8B5CF6"
          info="Cuántas fuentes de datos (Marfeel, Search Console, Trends, competencia…) respondieron bien en la última corrida. Si el número baja, algún dato del dashboard puede estar incompleto."
        />
      </div>

      {/* Dos columnas en desktop: trabajo editorial a la izquierda, contexto a la derecha */}
      <div className="grid lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          {/* Top recomendaciones */}
          <section>
            <SectionHeader
              title="Top recomendaciones del día"
              href="/recomendaciones"
              hrefLabel="Ver todas"
              info="Las 3 mejores oportunidades de contenido según el score del agente (0–100), con la urgencia de publicación y por qué es momento de cubrirlas. La lista completa está en la pestaña Recomendaciones."
            />
            <div className="grid gap-3">
              {recs?.slice(0, 3).map((rec: any) => {
                const urgencyColor = URGENCY_COLOR[rec.urgency] ?? "#2563EB"
                return (
                  <div
                    key={rec.id}
                    className="bg-white rounded-2xl border border-gray-200 p-4 transition hover:border-gray-300 hover:shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 mb-2">
                          <TagBadge color={urgencyColor}>{rec.urgency}</TagBadge>
                          {rec.section && <TagBadge>📂 {rec.section}</TagBadge>}
                        </div>
                        <p className="font-semibold text-gray-900 leading-snug">{rec.title_suggested}</p>
                        {rec.angle && <p className="text-sm text-gray-600 mt-1">{rec.angle}</p>}
                      </div>
                      <div className="shrink-0 w-16 text-center">
                        <p className="text-2xl font-extrabold text-gray-900 leading-none">{rec.score}</p>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mt-0.5">
                          score /100
                        </p>
                        <div className="h-1 rounded-full bg-gray-100 mt-1.5">
                          <div
                            className="h-1 rounded-full"
                            style={{
                              width: `${Math.min(100, rec.score ?? 0)}%`,
                              backgroundColor: urgencyColor,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    {(rec.why_now || rec.publish_window) && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500">
                        {rec.why_now && <span>📡 {rec.why_now}</span>}
                        {rec.publish_window && <span>🕐 Publicar: {rec.publish_window}</span>}
                      </div>
                    )}
                  </div>
                )
              })}
              {!recs?.length && (
                <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-6 text-center">
                  <p className="text-sm font-medium text-gray-600">Sin recomendaciones para hoy todavía</p>
                  <p className="text-xs text-gray-400 mt-1">
                    El radar corre durante el día; usa “⚡ Actualizar ahora” si necesitas datos frescos.
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Aprendizajes del benchmark de la mañana */}
          {insights && insights.length > 0 && (
            <section>
              <SectionHeader
                title="Aprendizajes de hoy"
                info="Conclusiones que sacó el benchmark de la mañana al medir qué funcionó ayer (qué temas, formatos y secciones rindieron). Estos aprendizajes ajustan cómo el radar puntúa los temas el resto del día."
              />
              <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
                {insights.map((ins: any) => (
                  <div key={ins.id} className="flex gap-3 px-4 py-3">
                    <span aria-hidden className="text-base leading-none mt-0.5">💡</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{ins.headline}</p>
                      {ins.detail && <p className="text-xs text-gray-500 mt-0.5">{ins.detail}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-6">
          {/* Tendencias del momento */}
          <section>
            <SectionHeader
              title="Tendencias en Perú ahora"
              href="/trends"
              hrefLabel="Ver todas"
              info="Los temas que más crecen en Google Trends Perú en este momento, con su categoría y un score de crecimiento (0–10). Sirven para detectar temas calientes antes que la competencia."
            />
            <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
              {trends?.map((t: any) => (
                <div key={t.id} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm text-gray-800 truncate">
                      <span className="text-gray-400 font-bold mr-1.5">#{t.rank}</span>
                      {t.keyword}
                    </p>
                    <span className="text-xs font-bold text-rpp-teal shrink-0">
                      {t.growth_score?.toFixed(1)}/10
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="h-1 flex-1 rounded-full bg-gray-100">
                      <div
                        className="h-1 rounded-full bg-rpp-teal"
                        style={{ width: `${Math.min(100, (t.growth_score ?? 0) * 10)}%` }}
                      />
                    </div>
                    {t.category && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 shrink-0">
                        {t.category}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {!trends?.length && (
                <p className="text-sm text-gray-500 p-4">Sin tendencias registradas todavía hoy.</p>
              )}
            </div>
          </section>

          {/* Estado del agente (antes "Fuentes del último run") */}
          <section>
            <SectionHeader
              title="Estado del agente"
              href="/status"
              hrefLabel="Ver detalle"
              info="Estado de cada fuente en la última corrida del agente. ✓ = respondió con datos; ✗ = falló o no devolvió nada. Útil para saber si algún panel está vacío por un problema de la fuente y no por falta de actividad."
            />
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: sourcesFailed === 0 ? "#16A34A" : "#DC2626" }}
                />
                <p className="text-sm font-medium text-gray-800">
                  {sourcesTotal > 0
                    ? `${sourcesOk}/${sourcesTotal} fuentes respondieron en el último run`
                    : "El agente aún no ha corrido hoy"}
                </p>
              </div>
              {sourcesTotal > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {lastRun?.sources_ok?.map((s: string) => (
                    <TagBadge key={s} color="#16A34A">{s} ✓</TagBadge>
                  ))}
                  {lastRun?.sources_failed?.map((s: string) => (
                    <TagBadge key={s} color="#DC2626">{s} ✗</TagBadge>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
