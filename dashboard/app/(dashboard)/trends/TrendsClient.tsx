"use client"

import { useEffect, useMemo, useState } from "react"
import { TagBadge } from "@/components/ui/Pill"
import { InfoTooltip } from "@/components/ui/InfoTooltip"
import { LastUpdated } from "@/components/ui/LastUpdated"

export type TrendNewsItem = {
  title: string
  source: string
  source_url?: string
  url: string
  published_at?: string
  /**
   * Origen de la noticia, puesto por el agente (analyzers/evidence.py):
   * "pe" medio peruano · "es" en español pero no peruano · "xx" prensa
   * extranjera. Ausente en las tendencias guardadas antes del 2026-08-22.
   */
  origin?: "pe" | "es" | "xx"
}

/**
 * Origen de la TENDENCIA a partir de su evidencia. `null` cuando las noticias
 * son anteriores al etiquetado — sin dato no se advierte nada, que es
 * preferible a advertir en falso.
 */
function trendOrigin(news: TrendNewsItem[] | null): "pe" | "es" | "xx" | null {
  const marcadas = (news ?? []).filter((n) => n.origin)
  if (!marcadas.length) return null
  if (marcadas.some((n) => n.origin === "pe")) return "pe"
  if (marcadas.some((n) => n.origin === "es")) return "es"
  return "xx"
}

/**
 * Solo se avisa cuando NO hay medios peruanos detrás. El caso "pe" es el 63%
 * de las tendencias: un chip que sale en dos de cada tres no informa (misma
 * lección que la etiqueta "volumen muy bajo" que se quitó el 2026-08-22).
 */
const AVISO_ORIGEN = {
  es: {
    texto: "sin medios peruanos",
    detalle: "Hay cobertura en español, pero ningún medio peruano la ha publicado todavía.",
    clase: "bg-gray-50 text-gray-600 border-gray-200",
  },
  xx: {
    texto: "solo prensa extranjera",
    detalle:
      "Ninguna nota en español detrás de esta tendencia: probablemente sea un rebote global. " +
      "Google la lista para Perú, pero la historia se está contando fuera.",
    clase: "bg-amber-50 text-amber-700 border-amber-200",
  },
} as const

export type Trend = {
  id: string
  rank: number
  keyword: string
  category: string | null
  growth_score: number | null
  /** Busquedas aproximadas del feed de Trends. NULL antes del 2026-08-21. */
  approx_traffic: number | null
  why_trending: string | null
  news: TrendNewsItem[] | null
}

export type TrendHistoryRow = {
  date: string
  keyword: string
  growth_score: number | null
}

/**
 * Estadistica del dia para comparar los volumenes ENTRE SI.
 *
 * ANTES habia un umbral absoluto (VOLUMEN_BAJO = 1000) que pintaba en ambar
 * "volumen muy bajo" a todo lo que quedara debajo. Fallaba por diseno: en un
 * mercado del tamano de Peru la mayoria del top rising esta por debajo de mil
 * busquedas, asi que la advertencia saltaba en 6 de cada 10 tendencias (y en
 * ~9 de cada 10 mirando el growth_score). Una alarma que suena casi siempre no
 * informa: solo ensucia. Lo reporto el usuario — "en todos los tooltips dice
 * que lo buscaron pocas personas, entonces que sentido tiene mostrarlos".
 *
 * La correccion es dejar de senalar hacia ABAJO y pasar a comparar: el numero
 * crudo no le dice nada a nadie sin una referencia, asi que la barra lo mide
 * contra la tendencia mas buscada del dia y solo se destaca lo que sobresale.
 */
function volumeStats(trends: Trend[]) {
  const vols = trends
    .map((t) => t.approx_traffic ?? 0)
    .filter((v) => v > 0)
    .sort((a, b) => a - b)
  if (!vols.length) return null
  return {
    max:    vols[vols.length - 1],
    median: vols[Math.floor(vols.length / 2)],
    /** Un dia plano (todo en el mismo escalon) no tiene nada que destacar. */
    spread: vols[vols.length - 1] > vols[0],
  }
}

/** 20000 -> "20 mil+" · 500 -> "500+". El "+" es de Google, no un redondeo nuestro. */
function fmtVolumen(n: number | null): string | null {
  if (!n) return null
  if (n >= 1000) return `${(n / 1000).toLocaleString("es-PE", { maximumFractionDigits: 0 })} mil+`
  return `${n.toLocaleString("es-PE")}+`
}

const CATEGORY_COLOR: Record<string, string> = {
  politica:        "#2563EB",
  economia:        "#16A34A",
  deportes:        "#CA8A04",
  entretenimiento: "#DB2777",
  tecnologia:      "#7C3AED",
  salud:           "#0D9488",
  mundo:           "#EA580C",
  otros:           "#6B7280",
}

const TODAS = "__todas__"

const catOf = (t: Trend) => t.category ?? "otros"

function faviconFor(item: TrendNewsItem) {
  try {
    if (item.source_url) {
      const host = new URL(item.source_url).hostname
      return `https://www.google.com/s2/favicons?domain=${host}&sz=32`
    }
  } catch { /* source_url malformada → inicial */ }
  return null
}

function timeAgo(published?: string): string {
  if (!published) return ""
  const d = new Date(published)
  if (isNaN(d.getTime())) return ""
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 60) return `hace ${Math.max(mins, 1)} min`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `hace ${hours} h`
  return d.toLocaleDateString("es-PE", { day: "numeric", month: "short", timeZone: "America/Lima" })
}

export default function TrendsClient({
  trends,
  history,
  lastRun,
}: {
  trends: Trend[]
  history: TrendHistoryRow[]
  lastRun: string | null
}) {
  const [category, setCategory] = useState<string>(TODAS)
  const [selected, setSelected] = useState<string | null>(trends[0]?.keyword ?? null)
  // Noticias traídas en vivo (/api/trend-news) para tendencias sin `news` guardado
  const [liveNews, setLiveNews] = useState<Record<string, TrendNewsItem[] | "loading">>({})

  const categoryCounts = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const t of trends) acc[catOf(t)] = (acc[catOf(t)] ?? 0) + 1
    return Object.entries(acc).sort((a, b) => b[1] - a[1])
  }, [trends])

  const list = useMemo(
    () => trends.filter((t) => category === TODAS || catOf(t) === category),
    [trends, category]
  )

  // Se calcula sobre TODAS las tendencias del dia, no sobre `list`: filtrar por
  // categoria no debe cambiar contra que se compara un volumen.
  const vol = useMemo(() => volumeStats(trends), [trends])

  /** Sobresale del dia: al menos el doble de la mediana. */
  const destaca = (t: Trend) =>
    !!vol && vol.spread && (t.approx_traffic ?? 0) >= vol.median * 2

  /** Ancho de la barra: cuota sobre la tendencia mas buscada del dia. */
  const barra = (t: Trend, score: number) => {
    if (!vol || !t.approx_traffic) return Math.min(100, score * 10)   // filas pre-migracion
    return Math.max(6, Math.round((t.approx_traffic / vol.max) * 100))
  }

  // Si el filtro deja fuera a la seleccionada, pasar a la primera visible
  useEffect(() => {
    if (!list.some((t) => t.keyword === selected)) {
      setSelected(list[0]?.keyword ?? null)
    }
  }, [list, selected])

  const current = list.find((t) => t.keyword === selected) ?? null

  // Fallback en vivo: la tendencia seleccionada no trae noticias guardadas
  useEffect(() => {
    if (!current || (current.news && current.news.length) || liveNews[current.keyword]) return
    const kw = current.keyword
    setLiveNews((p) => ({ ...p, [kw]: "loading" }))
    fetch(`/api/trend-news?q=${encodeURIComponent(kw)}`)
      .then((r) => r.json())
      .then((d) => setLiveNews((p) => ({ ...p, [kw]: Array.isArray(d.items) ? d.items : [] })))
      .catch(() => setLiveNews((p) => ({ ...p, [kw]: [] })))
  }, [current, liveNews])

  const currentNews: TrendNewsItem[] | "loading" =
    current?.news?.length ? current.news : (current ? liveNews[current.keyword] ?? "loading" : [])

  // Temas recurrentes: cuántas corridas recientes trajeron cada keyword
  const recurrent = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const h of history) acc[h.keyword] = (acc[h.keyword] ?? 0) + 1
    return Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 30)
  }, [history])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          Tendencias en Perú
          <InfoTooltip align="left">
            Qué está buscando la gente en Perú ahora mismo, según Google Trends.
            Selecciona una tendencia para ver a la derecha por qué es tendencia: la
            explicación generada por el agente y las principales noticias de Google
            sobre el tema. Sirve para detectar temas calientes y decidir coberturas
            antes que la competencia.
          </InfoTooltip>
        </h1>
        <LastUpdated kind="radar" finishedAt={lastRun} />
      </div>

      {!trends.length && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-500 text-sm">
          Sin datos de tendencias para hoy.
        </div>
      )}

      {trends.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6 items-start">
          {/* IZQUIERDA: listado con filtro de categoría arriba */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 min-w-0">
                <span className="truncate">Top tendencias de hoy</span>
                <InfoTooltip align="left">
                  Las tendencias del día según Google Trends Perú, ordenadas por
                  relevancia. El número son las búsquedas aproximadas: Google las
                  publica como piso y en escalones («100+», «2 mil+»), así que suelto
                  no dice mucho — la barra lo compara con la tendencia más buscada de
                  hoy, y se resalta lo que llega al doble de la mediana del día. Usa el
                  desplegable para filtrar por categoría y haz clic en una tendencia
                  para ver su explicación a la derecha.
                </InfoTooltip>
              </h2>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="shrink-0 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-rpp-teal/40 cursor-pointer"
                aria-label="Filtrar por categoría"
              >
                <option value={TODAS}>Todas las categorías ({trends.length})</option>
                {categoryCounts.map(([cat, count]) => (
                  <option key={cat} value={cat}>{cat} ({count})</option>
                ))}
              </select>
            </div>

            <div className="divide-y">
              {list.map((t) => {
                const color = CATEGORY_COLOR[catOf(t)] ?? "#6B7280"
                const score = t.growth_score ?? 0
                const active = t.keyword === selected
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelected(t.keyword)}
                    className={`w-full text-left flex items-center gap-3 px-4 py-3 transition ${
                      active ? "bg-teal-50/70" : "hover:bg-gray-50"
                    }`}
                    style={active ? { boxShadow: "inset 3px 0 0 #0D9488" } : undefined}
                  >
                    <span className="text-xs font-bold text-gray-300 w-7 shrink-0">#{t.rank}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${active ? "font-semibold text-gray-900" : "font-medium text-gray-800"}`}>
                        {t.keyword}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>
                          {catOf(t)}
                        </span>
                        <div
                          className="h-1 w-16 rounded-full bg-gray-100"
                          title={
                            t.approx_traffic && vol
                              ? `${fmtVolumen(t.approx_traffic)} búsquedas · la más buscada de hoy tiene ${fmtVolumen(vol.max)}`
                              : "Score de crecimiento (0–10)"
                          }
                        >
                          <div
                            className="h-1 rounded-full"
                            style={{ width: `${barra(t, score)}%`, backgroundColor: color }}
                          />
                        </div>
                        {/* El volumen manda sobre el score: "1.5/10" no dice nada,
                            "100+ busquedas" si. El score queda de respaldo para
                            las filas anteriores a la migracion. */}
                        {fmtVolumen(t.approx_traffic) ? (
                          <span
                            className={`text-[10px] ${
                              destaca(t) ? "text-gray-800 font-semibold" : "text-gray-500"
                            }`}
                            title={
                              destaca(t)
                                ? "Sobresale: al menos el doble de la mediana de hoy"
                                : "Búsquedas aproximadas en Perú hoy"
                            }
                          >
                            {fmtVolumen(t.approx_traffic)}
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-400">{score.toFixed(1)}/10</span>
                        )}
                      </div>
                    </div>
                    <span aria-hidden className={`shrink-0 text-sm font-bold ${active ? "text-rpp-teal" : "text-gray-300"}`}>
                      ›
                    </span>
                  </button>
                )
              })}
              {!list.length && (
                <p className="px-4 py-6 text-sm text-gray-500 text-center">
                  Sin tendencias en esta categoría hoy.
                </p>
              )}
            </div>
          </div>

          {/* DERECHA: por qué es tendencia */}
          <div className="lg:sticky lg:top-6 bg-white rounded-2xl border border-gray-200 overflow-hidden">
            {current ? (
              <>
                <div className="px-5 py-4 border-b bg-gray-50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-lg font-bold text-gray-900 break-words">{current.keyword}</p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <TagBadge color={CATEGORY_COLOR[catOf(current)] ?? "#6B7280"}>
                          {catOf(current)}
                        </TagBadge>
                        {fmtVolumen(current.approx_traffic) && (
                          <span className="text-xs text-gray-500">
                            <strong className="text-gray-700">{fmtVolumen(current.approx_traffic)}</strong> búsquedas
                          </span>
                        )}
                        <span className="text-xs text-gray-500">
                          score <strong className="text-gray-700">{(current.growth_score ?? 0).toFixed(1)}/10</strong>
                        </span>
                        <span className="text-xs text-gray-400">· #{current.rank} en Google Trends Perú</span>
                        {(() => {
                          const o = trendOrigin(current.news)
                          if (o !== "es" && o !== "xx") return null
                          const a = AVISO_ORIGEN[o]
                          return (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium border ${a.clase}`}
                              title={a.detalle}
                            >
                              {a.texto}
                            </span>
                          )
                        })()}
                        {destaca(current) && (
                          <span
                            className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 border border-teal-200"
                            title={`Al menos el doble de la mediana de hoy (${fmtVolumen(vol?.median ?? null)})`}
                          >
                            alta demanda hoy
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-5 space-y-5">
                  {/* Explicación */}
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
                      Por qué es tendencia
                      <InfoTooltip align="left">
                        Resumen generado por el agente (LLM) a partir de las noticias
                        recientes de Google News sobre el tema. Da contexto inmediato a
                        términos ambiguos (siglas, apellidos) sin salir del dashboard.
                      </InfoTooltip>
                    </h3>
                    {current.why_trending ? (
                      <p className="text-sm text-gray-800 leading-relaxed bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5">
                        {current.why_trending}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3.5 py-2.5">
                        El agente aún no generó la explicación de esta tendencia (se crea
                        en la siguiente corrida del radar). Las noticias de abajo muestran
                        el contexto.
                      </p>
                    )}
                  </div>

                  {/* Noticias de Google */}
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
                      Principales noticias en Google
                      <InfoTooltip align="left">
                        Los titulares más relevantes de Google News (Perú, últimas 48h)
                        sobre esta tendencia — la evidencia de por qué la gente la está
                        buscando. Clic en un titular para abrir la nota original.
                      </InfoTooltip>
                    </h3>
                    {currentNews === "loading" && (
                      <p className="text-xs text-gray-400 py-4 text-center">Buscando noticias…</p>
                    )}
                    {Array.isArray(currentNews) && currentNews.length === 0 && (
                      <p className="text-xs text-gray-500 py-4 text-center">
                        Sin noticias recientes en Google News para este tema.
                      </p>
                    )}
                    {Array.isArray(currentNews) && currentNews.length > 0 && (
                      <ul className="space-y-2">
                        {currentNews.map((n, i) => {
                          const fav = faviconFor(n)
                          return (
                            <li key={i}>
                              <a
                                href={n.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-start gap-3 rounded-xl border border-gray-200 px-3.5 py-2.5 transition hover:border-gray-300 hover:shadow-sm group"
                              >
                                {fav ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={fav} alt="" className="w-5 h-5 rounded mt-0.5 shrink-0" />
                                ) : (
                                  <span className="w-5 h-5 rounded bg-gray-200 text-gray-500 text-[10px] font-bold flex items-center justify-center mt-0.5 shrink-0">
                                    {(n.source || "?").charAt(0).toUpperCase()}
                                  </span>
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm text-gray-800 group-hover:text-rpp-teal leading-snug">
                                    {n.title}
                                  </span>
                                  <span className="block text-[11px] text-gray-400 mt-0.5">
                                    {n.source || "Google News"}
                                    {timeAgo(n.published_at) && ` · ${timeAgo(n.published_at)}`}
                                  </span>
                                </span>
                              </a>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <p className="p-8 text-sm text-gray-500 text-center">
                Selecciona una tendencia para ver por qué es tendencia.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Temas recurrentes */}
      {recurrent.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
            Temas recurrentes en corridas recientes
            <InfoTooltip align="left">
              Keywords que han sido tendencia en las corridas recientes (no solo hoy).
              El número indica en cuántas corridas apareció cada una: los temas que se
              repiten siguen vigentes y suelen merecer cobertura propia o actualización.
            </InfoTooltip>
          </h2>
          <p className="text-xs text-gray-400 mb-3">
            El número indica en cuántas corridas recientes apareció el tema.
          </p>
          <div className="flex flex-wrap gap-2">
            {recurrent.map(([kw, count]) => (
              <span
                key={kw}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs text-gray-700"
              >
                {kw}
                {count > 1 && <span className="font-semibold text-rpp-teal">×{count}</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
