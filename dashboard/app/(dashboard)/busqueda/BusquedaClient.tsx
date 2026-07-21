"use client"

import { useMemo, useState } from "react"
import { InfoTooltip } from "@/components/ui/InfoTooltip"
import { LastUpdated } from "@/components/ui/LastUpdated"
import { StatCard } from "@/components/ui/StatCard"

/**
 * Búsqueda & Discover, organizada por DECISIÓN y no por fuente de datos:
 *  1) "Para accionar hoy": cola única (subir al top 3 / reescribir título y
 *     meta / ganar el snippet) filtrada por VIGENCIA de la demanda — las
 *     búsquedas de eventos ya pasados se ocultan (optimizarlas no rinde).
 *  2) "Análisis y monitoreo": top queries, Discover, detalle del SERP —
 *     para leer patrones, no para actuar hoy.
 */

// ---------- Vigencia de la demanda (fallback client-side) ----------
// Copia TS de las reglas de agent/analyzers/freshness.py (rules-first): cubre
// filas guardadas antes de la migración query_freshness o sin veredicto LLM.
// Si cambian allá, actualizar acá.

const EVERGREEN_RE = /\bhoy\b|en vivo|\bahora\b|ultimas noticias|precio|dolar|euro|gasolina|clima|temperatura|horoscopo|temblor|sismo|resultados|tabla de posiciones|calendario|fixture|cuando juega|programacion|\brpp\b|tipo de cambio|sorteo|tinka|farmacia|fase de grupos/
const EVENT_RE = /\bvs\.?\b|\bcontra\b|alineaciones de|estadisticas de|cronologia de|donde mirar|a que hora/

const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")

type Freshness = "hot" | "evergreen" | "past" | null

function freshnessByRules(query: string, trendTokens: Record<string, true>): Freshness {
  const q = norm(query)
  const qTokens = q.split(" ").filter((t) => t.length > 3)
  let overlap = 0
  qTokens.forEach((t) => { if (trendTokens[t]) overlap++ })
  if (overlap >= 2 || (overlap >= 1 && qTokens.length <= 2)) return "hot"
  if (EVERGREEN_RE.test(q)) return "evergreen"
  if (EVENT_RE.test(q)) return "past"
  return null
}

const FRESHNESS_META: Record<string, { label: string; color: string; bg: string }> = {
  hot:       { label: "🔥 Tendencia activa",  color: "#C2410C", bg: "#FFF7ED" },
  evergreen: { label: "♻️ Demanda continua",  color: "#0F766E", bg: "#F0FDFA" },
  past:      { label: "⏳ Demanda apagada",   color: "#6B7280", bg: "#F9FAFB" },
}

// ---------- CTR esperado por posición (curva estándar de SERP) ----------
function expectedCtr(pos: number): number {
  const p = Math.round(pos)
  if (p <= 1) return 28
  if (p === 2) return 15
  if (p === 3) return 10
  if (p === 4) return 7.5
  if (p === 5) return 5.5
  if (p === 6) return 4.5
  if (p === 7) return 3.5
  if (p === 8) return 3
  if (p === 9) return 2.5
  if (p === 10) return 2.2
  return 1.5
}

// ---------- Jugadas ----------
const PLAY_META: Record<string, { label: string; color: string; action: string }> = {
  top3: {
    label: "Subir al top 3",
    color: "#D97706",
    action: "Refuerza título, primer párrafo y enlaza desde notas relacionadas para empujarla al top 3.",
  },
  ctr: {
    label: "Reescribir título y meta",
    color: "#2563EB",
    action: "La gente la ve pero no entra: reescribe título y meta description para ganar clics sin cambiar de posición.",
  },
  snippet: {
    label: "Ganar el snippet",
    color: "#0D9488",
    action: "El featured snippet está libre o en otro medio: estructura una respuesta directa (párrafo de 40-60 palabras o lista).",
  },
}

type ActionItem = {
  key: string
  query: string
  page: string | null
  position: number | null
  impressions: number
  clicks: number
  ctr: number | null
  plays: string[]
  lostPerDay: number
  freshness: Freshness
}

// ---------- Orden por métrica (subpestañas de Análisis y monitoreo) ----------
type SortDir = "asc" | "desc"
type QueriesSortField = "clicks" | "impressions" | "ctr" | "position"
type DiscoverSortField = "clicks" | "impressions" | "ctr"
type SerpSortField = "position" | "clicks" | "impressions"

function toggleSort<F extends string>(
  current: { field: F; dir: SortDir },
  field: F,
  defaultDir: SortDir = "desc"
): { field: F; dir: SortDir } {
  if (current.field === field) return { field, dir: current.dir === "asc" ? "desc" : "asc" }
  return { field, dir: defaultDir }
}

function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="text-gray-300">↕</span>
  return <span className="text-rpp-teal">{dir === "asc" ? "↑" : "↓"}</span>
}

function SortBar<F extends string>({
  options,
  sort,
  onChange,
}: {
  options: { field: F; label: string }[]
  sort: { field: F; dir: SortDir }
  onChange: (field: F) => void
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-gray-400 mr-0.5">Ordenar:</span>
      {options.map((opt) => {
        const active = sort.field === opt.field
        return (
          <button
            key={opt.field}
            onClick={() => onChange(opt.field)}
            className={`text-xs font-medium rounded-full border px-2.5 py-1 transition inline-flex items-center gap-1 ${
              active
                ? "bg-teal-50 border-rpp-teal text-rpp-teal"
                : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
            }`}
          >
            {opt.label}
            <SortArrow active={active} dir={sort.dir} />
          </button>
        )
      })}
    </div>
  )
}

// Celda de métrica: solo el número (sin repetir la unidad del header) +
// barra de fondo proporcional al máximo de la columna, para comparar volumen
// de un vistazo. value=null → sin dato cruzado (p.ej. SERP sin match en GSC).
function DataBarCell({
  value,
  max,
  color,
  format,
  width = 72,
}: {
  value: number | null
  max: number
  color: string
  format?: (v: number) => string
  width?: number
}) {
  if (value == null) {
    return (
      <div className="ml-auto text-xs text-gray-300 text-right" style={{ width }}>
        —
      </div>
    )
  }
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className="relative ml-auto rounded overflow-hidden shrink-0" style={{ width, height: 22 }}>
      <div
        className="absolute inset-y-0 left-0 rounded"
        style={{ width: `${pct}%`, backgroundColor: `${color}26` }}
      />
      <span
        className="relative z-10 flex items-center justify-end h-full pr-1.5 text-xs font-semibold"
        style={{ color }}
      >
        {format ? format(value) : value.toLocaleString()}
      </span>
    </div>
  )
}

export default function BusquedaClient({
  quickWins,
  ctrCandidates,
  topQueries,
  discover,
  serpOpps,
  trendKeywords,
  lastRun,
}: {
  quickWins: any[]
  ctrCandidates: any[]
  topQueries: any[]
  discover: any[]
  serpOpps: any[]
  trendKeywords: string[]
  lastRun: string | null
}) {
  const [showPast, setShowPast] = useState(false)
  const [monitorTab, setMonitorTab] = useState<"queries" | "discover" | "serp">("queries")
  const [queriesSort, setQueriesSort] = useState<{ field: QueriesSortField; dir: SortDir }>({ field: "clicks", dir: "desc" })
  const [discoverSort, setDiscoverSort] = useState<{ field: DiscoverSortField; dir: SortDir }>({ field: "clicks", dir: "desc" })
  const [serpSort, setSerpSort] = useState<{ field: SerpSortField; dir: SortDir }>({ field: "position", dir: "asc" })

  const trendTokens = useMemo(() => {
    const acc: Record<string, true> = {}
    trendKeywords.forEach((kw) => {
      norm(kw).split(" ").forEach((t) => { if (t.length > 3) acc[t] = true })
    })
    return acc
  }, [trendKeywords])

  const freshnessOf = (row: any): Freshness => {
    const stored = row.query_freshness
    if (stored === "hot" || stored === "evergreen" || stored === "past") return stored
    return freshnessByRules(row.query ?? "", trendTokens)
  }

  // ---------- Cola de acción unificada ----------
  const { queue, pastItems, lostTotal } = useMemo(() => {
    const map: Record<string, ActionItem> = {}

    const getItem = (row: any): ActionItem => {
      const key = `${row.query ?? ""}||${row.page ?? row.gsc_page ?? ""}`
      if (!map[key]) {
        map[key] = {
          key,
          query: row.query,
          page: row.page ?? row.gsc_page ?? null,
          position: row.position ?? row.gsc_position ?? null,
          impressions: row.impressions ?? 0,
          clicks: row.clicks ?? 0,
          ctr: row.ctr ?? null,
          plays: [],
          lostPerDay: 0,
          freshness: freshnessOf(row),
        }
      }
      return map[key]
    }

    quickWins.forEach((row) => {
      const it = getItem(row)
      if (it.plays.indexOf("top3") === -1) it.plays.push("top3")
    })

    ctrCandidates.forEach((row) => {
      const exp = expectedCtr(row.position ?? 99)
      const ctr = row.ctr ?? 0
      if (ctr >= exp * 0.4) return
      const lost = Math.round(((exp - ctr) / 100) * (row.impressions ?? 0) / 3)
      if (lost < 30) return
      const it = getItem(row)
      if (it.plays.indexOf("ctr") === -1) it.plays.push("ctr")
      it.lostPerDay = Math.max(it.lostPerDay, lost)
    })

    serpOpps.forEach((row) => {
      if (row.rpp_has_snippet) return
      // Se cuelga del ítem existente con la misma query, o crea uno propio
      const existingKey = Object.keys(map).filter((k) => k.indexOf(`${row.query}||`) === 0)[0]
      const it = existingKey ? map[existingKey] : getItem(row)
      if (it.plays.indexOf("snippet") === -1) it.plays.push("snippet")
    })

    const all = Object.keys(map).map((k) => map[k]).filter((it) => it.plays.length > 0)
    const rank = (f: Freshness) => (f === "hot" ? 0 : f === "evergreen" ? 1 : f === null ? 2 : 9)
    all.sort((a, b) =>
      rank(a.freshness) - rank(b.freshness) || (b.impressions - a.impressions))

    const alive = all.filter((it) => it.freshness !== "past")
    const past = all.filter((it) => it.freshness === "past")
    const lost = alive.reduce((s, it) => s + it.lostPerDay, 0)
    return { queue: alive, pastItems: past, lostTotal: lost }
  }, [quickWins, ctrCandidates, serpOpps, trendTokens])

  // ---------- Top queries ordenadas ----------
  const sortedTopQueries = useMemo(() => {
    const arr = [...topQueries]
    const { field, dir } = queriesSort
    arr.sort((a, b) => {
      const av = Number(a?.[field] ?? 0)
      const bv = Number(b?.[field] ?? 0)
      return dir === "asc" ? av - bv : bv - av
    })
    return arr
  }, [topQueries, queriesSort])

  // ---------- Discover ordenado ----------
  const sortedDiscover = useMemo(() => {
    const arr = [...discover]
    const { field, dir } = discoverSort
    arr.sort((a, b) => {
      const av = Number(a?.[field] ?? 0)
      const bv = Number(b?.[field] ?? 0)
      return dir === "asc" ? av - bv : bv - av
    })
    return arr
  }, [discover, discoverSort])

  // ---------- Detalle SERP: cruce con GSC (quickWins) para poder ordenar por
  // clics/impresiones, que serp_opportunities no trae directamente ----------
  const gscByKey = useMemo(() => {
    const map: Record<string, { impressions: number; clicks: number }> = {}
    quickWins.forEach((row: any) => {
      const key = `${row.query ?? ""}||${row.page ?? ""}`
      map[key] = { impressions: row.impressions ?? 0, clicks: row.clicks ?? 0 }
    })
    return map
  }, [quickWins])

  const serpEnriched = useMemo(() => {
    return serpOpps.map((row: any) => {
      const m = gscByKey[`${row.query ?? ""}||${row.gsc_page ?? ""}`]
      return { ...row, _clicks: m?.clicks ?? null, _impressions: m?.impressions ?? null }
    })
  }, [serpOpps, gscByKey])

  const sortedSerpOpps = useMemo(() => {
    const arr = [...serpEnriched]
    const { field, dir } = serpSort
    const key = field === "position" ? "gsc_position" : field === "clicks" ? "_clicks" : "_impressions"
    arr.sort((a, b) => {
      const av = Number(a[key] ?? (field === "position" ? 999 : 0))
      const bv = Number(b[key] ?? (field === "position" ? 999 : 0))
      return dir === "asc" ? av - bv : bv - av
    })
    return arr
  }, [serpEnriched, serpSort])

  // ---------- Máximos por columna (para el largo de la barra de datos) ----------
  const maxQueryClicks = useMemo(() => Math.max(1, ...topQueries.map((r: any) => r.clicks ?? 0)), [topQueries])
  const maxQueryImpressions = useMemo(() => Math.max(1, ...topQueries.map((r: any) => r.impressions ?? 0)), [topQueries])
  const maxQueryCtr = useMemo(() => Math.max(1, ...topQueries.map((r: any) => r.ctr ?? 0)), [topQueries])
  const maxQueryPosition = useMemo(() => Math.max(1, ...topQueries.map((r: any) => r.position ?? 0)), [topQueries])

  const maxDiscoverClicks = useMemo(() => Math.max(1, ...discover.map((r: any) => r.clicks ?? 0)), [discover])
  const maxDiscoverImpressions = useMemo(() => Math.max(1, ...discover.map((r: any) => r.impressions ?? 0)), [discover])
  const maxDiscoverCtr = useMemo(() => Math.max(1, ...discover.map((r: any) => r.ctr ?? 0)), [discover])

  const maxSerpPosition = useMemo(() => Math.max(1, ...serpEnriched.map((r: any) => r.gsc_position ?? 0)), [serpEnriched])
  const maxSerpClicks = useMemo(() => Math.max(1, ...serpEnriched.map((r: any) => r._clicks ?? 0)), [serpEnriched])
  const maxSerpImpressions = useMemo(() => Math.max(1, ...serpEnriched.map((r: any) => r._impressions ?? 0)), [serpEnriched])

  const discoverTotalClicks = discover.reduce((sum, r) => sum + (r.clicks ?? 0), 0)
  const serpFree = serpOpps.filter((r) => !r.rpp_has_snippet).length
  const visible = showPast ? queue.concat(pastItems) : queue

  // Aprendizaje: lo masivo que ya se apagó (llegamos tarde al pico)
  const lateLearning = useMemo(
    () => pastItems.filter((it) => it.impressions >= 50000).slice(0, 5),
    [pastItems]
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            Búsqueda &amp; Discover
            <InfoTooltip align="left">
              Cómo rinde RPP en Google (Search Console + Discover + SERP en vivo) y,
              sobre todo, qué conviene accionar HOY. La cola de arriba junta las tres
              jugadas posibles y descarta búsquedas cuya demanda ya murió; el bloque de
              abajo es análisis para leer patrones en el tiempo.
            </InfoTooltip>
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Qué accionar hoy y qué solo monitorear, según Google Search, Discover y el SERP en vivo
          </p>
        </div>
        <LastUpdated kind="morning" finishedAt={lastRun} />
      </div>

      {/* Cómo leer esta página */}
      <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3 flex flex-col md:flex-row gap-2 md:gap-6 text-xs text-gray-600">
        <span className="flex items-center gap-1.5">
          <span aria-hidden>🕐</span> Los datos de Google llegan con ~1 día de rezago.
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden>⏱</span> Ninguna optimización es inmediata: el efecto típico llega <strong>3–14 días</strong> después de que Google reindexa.
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden>✅</span> Por eso solo se accionan búsquedas con demanda viva; las de eventos ya pasados se ocultan.
        </span>
      </div>

      {/* KPIs accionables */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Para accionar hoy"
          value={queue.length}
          subtitle="jugadas con demanda viva"
          accent="#0D9488"
          info="Cuántas oportunidades reales hay en la cola de acción, ya filtradas por vigencia: se excluyen las búsquedas de eventos que ya pasaron."
        />
        <StatCard
          label="Clics/día sobre la mesa"
          value={lostTotal.toLocaleString()}
          subtitle="por CTR bajo lo esperado"
          accent="#2563EB"
          info="Clics diarios estimados que se pierden porque el CTR real está muy por debajo del esperable para la posición. Se recuperan reescribiendo título y meta — efecto tras la reindexación, y solo mientras la búsqueda siga viva."
        />
        <StatCard
          label="Snippets por ganar"
          value={serpFree}
          subtitle="libres o de otro medio"
          accent="#D97706"
          info="Quick wins cuyo featured snippet está libre o en manos de otro medio: espacio del SERP que RPP puede ganar estructurando una respuesta directa."
        />
        <StatCard
          label="Clics en Discover"
          value={discoverTotalClicks.toLocaleString()}
          subtitle="últimos 7 días"
          accent="#7C3AED"
          info="Clics que trajo el feed de Google Discover en 7 días. Es monitoreo: sirve para detectar qué tipo de contenido entra a Discover, no es una lista de tareas."
        />
      </div>

      {/* ============ BLOQUE 1: PARA ACCIONAR HOY ============ */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden" style={{ borderLeftWidth: 4, borderLeftColor: "#0D9488" }}>
        <div className="px-4 py-3 border-b bg-gray-50 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
              Para accionar hoy
              <InfoTooltip align="left">
                Una sola cola de trabajo que junta las tres jugadas: subir al top 3
                (posición 4–10 con muchas impresiones), reescribir título y meta (CTR
                muy por debajo del esperado para su posición) y ganar el featured
                snippet (está libre o en otro medio). Ordenada por vigencia de la
                demanda y volumen. Todas son tarea de redacción.
              </InfoTooltip>
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Efecto típico: 3–14 días tras la reindexación — nada aquí es instantáneo · ✍️ tareas de redacción
            </p>
          </div>
          {pastItems.length > 0 && (
            <button
              onClick={() => setShowPast(!showPast)}
              className={`text-xs font-medium rounded-full border px-3 py-1 transition ${
                showPast
                  ? "bg-gray-100 border-gray-300 text-gray-700"
                  : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
              }`}
            >
              {showPast ? "Ocultar" : "Ver"} demanda apagada ({pastItems.length})
            </button>
          )}
        </div>

        <div className="divide-y max-h-[42rem] overflow-y-auto">
          {visible.map((it) => {
            const fresh = it.freshness ? FRESHNESS_META[it.freshness] : null
            const primaryPlay = it.plays[0]
            return (
              <div key={it.key} className={`px-4 py-3 ${it.freshness === "past" ? "opacity-60" : ""}`}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {fresh && (
                    <span
                      className="text-[10px] font-semibold rounded-full px-2 py-0.5 border"
                      style={{ color: fresh.color, backgroundColor: fresh.bg, borderColor: `${fresh.color}33` }}
                    >
                      {fresh.label}
                    </span>
                  )}
                  {it.plays.map((p) => (
                    <span
                      key={p}
                      className="text-[10px] font-bold rounded px-1.5 py-0.5"
                      style={{ color: PLAY_META[p].color, backgroundColor: `${PLAY_META[p].color}14` }}
                    >
                      {PLAY_META[p].label}
                    </span>
                  ))}
                </div>
                <p className="text-sm font-medium text-gray-900 mt-1.5">{it.query}</p>
                {it.page && (
                  <a
                    href={it.page}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-xs text-gray-400 font-mono truncate hover:text-rpp-teal"
                  >
                    {it.page}
                  </a>
                )}
                <p className="text-xs text-gray-600 mt-1">{PLAY_META[primaryPlay]?.action}</p>
                <div className="flex gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                  {it.position != null && <span>Pos. <strong className="text-orange-600">{Number(it.position).toFixed(1)}</strong></span>}
                  <span>{(it.impressions ?? 0).toLocaleString()} imp.</span>
                  {it.ctr != null && <span>CTR: {Number(it.ctr).toFixed(2)}%</span>}
                  {it.lostPerDay > 0 && (
                    <span className="text-blue-700 font-semibold">▼ pierde ~{it.lostPerDay.toLocaleString()} clics/día</span>
                  )}
                </div>
              </div>
            )
          })}
          {!visible.length && (
            <p className="px-4 py-8 text-sm text-gray-500 text-center">
              Sin acciones pendientes con demanda viva — vuelve tras el próximo benchmark de la mañana.
            </p>
          )}
        </div>
      </div>

      {/* Aprendizaje: llegamos tarde */}
      {lateLearning.length > 0 && (
        <div className="bg-amber-50 rounded-2xl border border-amber-200 p-4">
          <h2 className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
            🕐 Llegamos tarde: demanda masiva ya apagada
            <InfoTooltip align="left">
              Búsquedas que explotaron alrededor de un evento y cuyo interés ya murió.
              Ya no se accionan, pero son la mejor lección de anticipación: la próxima
              vez que haya un evento comparable, estas notas (previa, estadísticas,
              dónde ver) deben publicarse ANTES del pico.
            </InfoTooltip>
          </h2>
          <p className="text-xs text-amber-700 mt-0.5 mb-2">
            Lección para el próximo evento comparable: publicar la previa, las estadísticas y el
            &quot;dónde ver&quot; ANTES del pico de búsqueda, no después.
          </p>
          <ul className="space-y-1">
            {lateLearning.map((it) => (
              <li key={it.key} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-amber-900 truncate">{it.query}</span>
                <span className="text-amber-700 shrink-0 font-semibold">
                  {(it.impressions ?? 0).toLocaleString()} imp. desaprovechadas
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ============ BLOQUE 2: ANÁLISIS Y MONITOREO ============ */}
      <div className="pt-2">
        <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-1.5">
          Análisis y monitoreo
          <InfoTooltip align="left">
            Este bloque es para leer patrones en el tiempo — dónde es fuerte RPP, qué
            tipo de contenido entra a Discover, cómo se ve el SERP — no una lista de
            tareas para hoy.
          </InfoTooltip>
        </h2>
        <p className="text-xs text-gray-500 mt-0.5 mb-4">
          Para leer patrones, no para actuar hoy.
        </p>

        {/* Subpestañas del bloque de análisis */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {[
            { key: "queries" as const, label: "Top queries", count: topQueries.length },
            { key: "discover" as const, label: "Google Discover", count: discover.length },
            { key: "serp" as const, label: "Detalle SERP", count: serpOpps.length },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setMonitorTab(t.key)}
              className={`text-sm font-medium rounded-full border px-4 py-1.5 transition ${
                monitorTab === t.key
                  ? "bg-rpp-teal text-white border-rpp-teal"
                  : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              {t.label} <span className="opacity-70">({t.count})</span>
            </button>
          ))}
        </div>

        {monitorTab === "queries" && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                Top queries por clics (últimos 3 días, búsqueda web)
                <InfoTooltip align="left">
                  Las búsquedas que más clics le traen a RPP desde Google. Muestra por
                  qué temas llega hoy la audiencia de búsqueda y dónde RPP es fuerte —
                  contexto editorial, no tareas.
                </InfoTooltip>
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b bg-gray-50">
                    <th className="text-left px-4 py-2">Query</th>
                    {([
                      { field: "clicks" as const, label: "Clics" },
                      { field: "impressions" as const, label: "Impresiones" },
                      { field: "ctr" as const, label: "CTR" },
                      { field: "position" as const, label: "Posición" },
                    ]).map((col) => (
                      <th
                        key={col.field}
                        className="text-right px-4 py-2 cursor-pointer select-none hover:text-gray-700"
                        onClick={() => setQueriesSort((s) => toggleSort(s, col.field, col.field === "position" ? "asc" : "desc"))}
                      >
                        <span className="inline-flex items-center gap-1 justify-end w-full">
                          {col.label}
                          <SortArrow active={queriesSort.field === col.field} dir={queriesSort.dir} />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sortedTopQueries.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-800 max-w-xs truncate">{row.query}</td>
                      <td className="px-4 py-2">
                        <DataBarCell value={row.clicks ?? 0} max={maxQueryClicks} color="#2563EB" width={90} />
                      </td>
                      <td className="px-4 py-2">
                        <DataBarCell value={row.impressions ?? 0} max={maxQueryImpressions} color="#6B7280" width={90} />
                      </td>
                      <td className="px-4 py-2">
                        <DataBarCell value={row.ctr ?? 0} max={maxQueryCtr} color="#0D9488" format={(v) => `${v.toFixed(1)}%`} width={64} />
                      </td>
                      <td className="px-4 py-2">
                        <DataBarCell value={row.position ?? 0} max={maxQueryPosition} color="#D97706" format={(v) => v.toFixed(1)} width={56} />
                      </td>
                    </tr>
                  ))}
                  {!sortedTopQueries.length && (
                    <tr><td colSpan={5} className="px-4 py-6 text-sm text-gray-500 text-center">Sin datos.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {monitorTab === "discover" && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden" style={{ borderLeftWidth: 4, borderLeftColor: "#7C3AED" }}>
            <div className="px-4 py-3 border-b bg-gray-50 flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                  Google Discover (últimos 7 días)
                  <InfoTooltip align="left">
                    Rendimiento en el feed de recomendados del móvil. Discover no reporta
                    ni query ni posición: léelo como evidencia de QUÉ TIPO de contenido
                    tuyo entra al feed (tema, formato, sección), no como URLs a optimizar.
                  </InfoTooltip>
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Úsalo para detectar patrones de tema y formato que entran al feed — no es una lista de tareas
                </p>
              </div>
              <SortBar
                options={[
                  { field: "clicks", label: "Clics" },
                  { field: "impressions", label: "Impresiones" },
                  { field: "ctr", label: "CTR" },
                ]}
                sort={discoverSort}
                onChange={(f) => setDiscoverSort((s) => toggleSort(s, f))}
              />
            </div>
            <div className="divide-y max-h-[32rem] overflow-y-auto">
              {sortedDiscover.map((row, i) => (
                <div key={i} className="px-4 py-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-gray-800 truncate flex-1">{row.page}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    <DataBarCell value={row.clicks ?? 0} max={maxDiscoverClicks} color="#2563EB" width={80} />
                    <DataBarCell value={row.impressions ?? 0} max={maxDiscoverImpressions} color="#6B7280" width={80} />
                    <DataBarCell value={row.ctr ?? 0} max={maxDiscoverCtr} color="#0D9488" format={(v) => `${v.toFixed(1)}%`} width={60} />
                  </div>
                </div>
              ))}
              {!sortedDiscover.length && (
                <p className="px-4 py-6 text-sm text-gray-500 text-center">Sin datos de Discover todavía.</p>
              )}
            </div>
          </div>
        )}

        {monitorTab === "serp" && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden" style={{ borderLeftWidth: 4, borderLeftColor: "#0D9488" }}>
            <div className="px-4 py-3 border-b bg-gray-50 flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                  Detalle del SERP en vivo (quick wins del día)
                  <InfoTooltip align="left">
                    Cómo se ve la página de resultados de Google en vivo (SerpApi) para las
                    quick wins: si hay featured snippet y de quién es, las preguntas de
                    &quot;La gente también pregunta&quot; (ideas de subtítulos H2) y quién
                    está en el carrusel de noticias. Requiere SERPAPI_KEY. Clics/impresiones
                    se cruzan desde Search Console cuando la query coincide con una quick win.
                  </InfoTooltip>
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Las preguntas de &quot;La gente también pregunta&quot; son ideas listas de H2 para la nota
                </p>
              </div>
              <SortBar
                options={[
                  { field: "position", label: "Posición" },
                  { field: "clicks", label: "Clics" },
                  { field: "impressions", label: "Impresiones" },
                ]}
                sort={serpSort}
                onChange={(f) => setSerpSort((s) => toggleSort(s, f, f === "position" ? "asc" : "desc"))}
              />
            </div>
            <div className="divide-y max-h-[32rem] overflow-y-auto">
              {sortedSerpOpps.map((row: any, i) => (
                <div key={i} className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-gray-800 truncate flex-1">{row.query}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <DataBarCell value={row.gsc_position ?? null} max={maxSerpPosition} color="#D97706" format={(v) => v.toFixed(1)} width={56} />
                      <DataBarCell value={row._clicks} max={maxSerpClicks} color="#2563EB" width={70} />
                      <DataBarCell value={row._impressions} max={maxSerpImpressions} color="#6B7280" width={80} />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {row.has_featured_snippet && (
                      <span
                        className={`text-xs rounded-full px-2 py-0.5 border ${
                          row.rpp_has_snippet
                            ? "bg-teal-50 border-teal-300 text-teal-700"
                            : "bg-red-50 border-red-300 text-red-700"
                        }`}
                      >
                        {row.rpp_has_snippet ? "✓ RPP tiene el featured snippet" : "Featured snippet de otro medio"}
                      </span>
                    )}
                    {row.rpp_in_top_stories && (
                      <span className="text-xs rounded-full px-2 py-0.5 border bg-teal-50 border-teal-300 text-teal-700">
                        ✓ RPP en el carrusel de noticias
                      </span>
                    )}
                    {!row.has_featured_snippet && (
                      <span className="text-xs rounded-full px-2 py-0.5 border bg-gray-50 border-gray-300 text-gray-500">
                        Sin featured snippet — oportunidad libre
                      </span>
                    )}
                  </div>

                  {row.paa_questions?.length > 0 && (
                    <p className="text-xs text-gray-500">
                      <span className="font-medium text-gray-600">La gente también pregunta:</span>{" "}
                      {row.paa_questions.slice(0, 2).map((p: any) => p.question).join(" · ")}
                    </p>
                  )}

                  {row.top_stories?.length > 0 && (
                    <p className="text-xs text-gray-500 truncate">
                      <span className="font-medium text-gray-600">En el carrusel:</span>{" "}
                      {row.top_stories.slice(0, 3).map((s: any) => s.source).join(", ")}
                    </p>
                  )}
                </div>
              ))}
              {!sortedSerpOpps.length && (
                <p className="px-4 py-6 text-sm text-gray-500 text-center">
                  Sin datos aún — se llena en el benchmark de la mañana si <code className="text-xs">SERPAPI_KEY</code> está configurada.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
