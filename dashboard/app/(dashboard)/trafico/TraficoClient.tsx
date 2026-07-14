"use client"

import { useMemo, useState } from "react"
import { StatCard, type StatDelta } from "@/components/ui/StatCard"
import { InfoTooltip } from "@/components/ui/InfoTooltip"
import { LastUpdated } from "@/components/ui/LastUpdated"
import { DatePicker } from "@/components/ui/DatePicker"
import { FilterCard, FilterChip, FilterItem } from "@/components/ui/FilterList"
import { isRealArticle, sectionOf } from "@/lib/articleFilter"
import { ChannelTrendChart, type TrendChannelMeta, type TrendPoint } from "./ChannelTrendChart"

export type ChannelRow = {
  page_path: string
  title: string | null
  channel: string | null
  pageviews: number | null
  unique_users: number | null
}

const TODOS = "Todos"

function fmt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("es-PE")
}

function fmtShortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  })
}

function fmtLongDate(iso: string): string {
  const s = new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Totales (page views, usuarios, artículos) para un conjunto de filas bajo un filtro sección+canal dado. */
function aggregateTotals(rowsIn: ChannelRow[], section: string, channel: string) {
  const clean = rowsIn.filter((r) => isRealArticle(r.page_path))
  const filtered = clean.filter((r) => {
    if (channel !== TODOS && (r.channel || "Otros") !== channel) return false
    if (section !== TODOS && sectionOf(r.page_path) !== section) return false
    return true
  })
  const byArticle: Record<string, { pageviews: number; unique_users: number }> = {}
  for (const r of filtered) {
    const a = byArticle[r.page_path] ?? (byArticle[r.page_path] = { pageviews: 0, unique_users: 0 })
    a.pageviews += r.pageviews ?? 0
    a.unique_users += r.unique_users ?? 0
  }
  const values = Object.values(byArticle)
  return {
    totalPv: values.reduce((s, a) => s + a.pageviews, 0),
    totalUsers: values.reduce((s, a) => s + a.unique_users, 0),
    articleCount: values.length,
  }
}

function computeDelta(curr: number, prev: number | null, vsLabel: string): StatDelta | undefined {
  if (prev === null) return undefined
  if (prev === 0) return curr > 0 ? { pct: null, isNew: true, vsLabel } : undefined
  return { pct: ((curr - prev) / prev) * 100, vsLabel }
}

export default function TraficoClient({
  rows,
  hasChannelData,
  date,
  availableDates,
  prevRows,
  previousDate,
  trendData,
  trendChannels,
  lastRun,
}: {
  rows: ChannelRow[]
  hasChannelData: boolean
  /** Día del DATO (no de la corrida): el benchmark de hoy trae el día completo de ayer. */
  date: string
  availableDates: string[]
  prevRows: ChannelRow[] | null
  previousDate: string | null
  trendData: TrendPoint[]
  trendChannels: TrendChannelMeta[]
  lastRun: string | null
}) {
  // Solo notas editoriales (fuera widget mrf.io y audio en vivo)
  const cleanRows = useMemo(() => rows.filter((r) => isRealArticle(r.page_path)), [rows])

  const [section, setSection] = useState<string>(TODOS)

  // Conteo de artículos por sección (facetado por el canal activo se omite a
  // propósito: la sección es el eje editorial y conviene que sus números sean estables).
  const sectionCounts = useMemo(() => {
    const acc: Record<string, Set<string>> = {}
    for (const r of cleanRows) {
      const s = sectionOf(r.page_path)
      ;(acc[s] ??= new Set()).add(r.page_path)
    }
    return Object.entries(acc)
      .map(([s, set]) => [s, set.size] as const)
      .sort((a, b) => b[1] - a[1])
  }, [cleanRows])

  const totalArticles = useMemo(() => new Set(cleanRows.map((r) => r.page_path)).size, [cleanRows])

  // Canales por page views total; se limita a la sección seleccionada
  const channels = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const r of cleanRows) {
      if (section !== TODOS && sectionOf(r.page_path) !== section) continue
      const c = r.channel || "Otros"
      acc[c] = (acc[c] ?? 0) + (r.pageviews ?? 0)
    }
    return Object.entries(acc).sort((a, b) => b[1] - a[1])
  }, [cleanRows, section])

  // Default: canal Google si existe; si no, Todos
  const defaultChannel =
    hasChannelData && channels.some(([c]) => c === "Google") ? "Google" : TODOS
  const [channel, setChannel] = useState<string>(defaultChannel)

  const totalChannelPv = channels.reduce((s, [, v]) => s + v, 0)
  const maxChannelPv = channels.length ? channels[0][1] : 0

  // Filas filtradas por canal + sección
  const filtered = useMemo(() => {
    return cleanRows.filter((r) => {
      if (channel !== TODOS && (r.channel || "Otros") !== channel) return false
      if (section !== TODOS && sectionOf(r.page_path) !== section) return false
      return true
    })
  }, [cleanRows, channel, section])

  // Agrega por artículo (suma canales cuando channel = Todos)
  const articles = useMemo(() => {
    const acc: Record<string, ChannelRow & { pageviews: number; unique_users: number }> = {}
    for (const r of filtered) {
      const a = acc[r.page_path]
      if (a) {
        a.pageviews += r.pageviews ?? 0
        a.unique_users += r.unique_users ?? 0
        if (!a.title && r.title) a.title = r.title
      } else {
        acc[r.page_path] = {
          page_path: r.page_path,
          title: r.title,
          channel: r.channel,
          pageviews: r.pageviews ?? 0,
          unique_users: r.unique_users ?? 0,
        }
      }
    }
    return Object.values(acc).sort((a, b) => b.pageviews - a.pageviews)
  }, [filtered])

  const totalPv = articles.reduce((s, a) => s + a.pageviews, 0)
  const totalUsers = articles.reduce((s, a) => s + a.unique_users, 0)

  // Comparativa vs día anterior con datos, bajo el MISMO filtro sección+canal activo.
  const prevTotals = useMemo(() => {
    if (!prevRows) return null
    return aggregateTotals(prevRows, section, channel)
  }, [prevRows, section, channel])

  const vsLabel = previousDate ? `vs ${fmtShortDate(previousDate)}` : ""
  const pvDelta = prevTotals ? computeDelta(totalPv, prevTotals.totalPv, vsLabel) : undefined
  const usersDelta = prevTotals ? computeDelta(totalUsers, prevTotals.totalUsers, vsLabel) : undefined
  const articlesDelta = prevTotals ? computeDelta(articles.length, prevTotals.articleCount, vsLabel) : undefined

  const hasActiveFilters = section !== TODOS || channel !== TODOS
  const trendFrom = trendData[0]?.date
  const trendTo = trendData[trendData.length - 1]?.date

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          Tráfico (Marfeel)
          <InfoTooltip align="left">
            Rendimiento de las notas de RPP según Marfeel (la fuente de audiencia).
            Muestra page views y usuarios por artículo, y permite desglosar por sección
            y por canal de adquisición (Google, directo, redes…). Usa el calendario
            para ver días anteriores.
          </InfoTooltip>
        </h1>
        <div className="flex items-center gap-3">
          <DatePicker availableDates={availableDates} selected={date} />
          <LastUpdated kind="morning" finishedAt={lastRun} />
        </div>
      </div>

      {/* Nota de semántica de fecha: Marfeel entrega el día COMPLETO anterior */}
      <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-2.5 text-xs text-gray-600 flex items-center gap-2">
        <span aria-hidden>ℹ️</span>
        <span>
          Estás viendo el tráfico del <b>{fmtLongDate(date)}</b> (día completo). Marfeel entrega
          el día cerrado: el tráfico de hoy estará disponible mañana con el benchmark matutino.
        </span>
      </div>

      {!hasChannelData && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          Este día no tiene datos por canal (o aún no se poblaron). Mientras tanto puedes
          filtrar por <b>Sección</b>; el filtro por canal se activará solo.
        </div>
      )}

      {/* Tarjetas resumen (según filtro activo), con comparativa vs día anterior */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Page views"
          value={fmt(totalPv)}
          delta={pvDelta}
          accent="#F97316"
          info="Total de vistas de página de los artículos según el filtro activo (sección y canal). La comparativa es contra el día anterior con datos disponibles, bajo el mismo filtro."
        />
        <StatCard
          label="Usuarios únicos"
          value={fmt(totalUsers)}
          delta={usersDelta}
          accent="#0D9488"
          info="Personas distintas que leyeron esos artículos (según el filtro activo). A diferencia de page views, no cuenta las visitas repetidas del mismo usuario."
        />
        <StatCard
          label="Artículos"
          value={fmt(articles.length)}
          delta={articlesDelta}
          accent="#8B5CF6"
          info="Cuántas notas distintas entran en el filtro actual de sección y canal."
        />
      </div>

      {/* Panel de filtros a la izquierda (mismo lenguaje que Competencia) + artículos enmarcados */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        <div className="space-y-4 self-start">
          <FilterCard
            title="Sección"
            info="Filtra el tráfico por sección de rpp.pe (deportes, política, etc.), derivada de la URL de cada nota. El número es cuántos artículos tuvo esa sección en el día. Vuelve a hacer clic para quitar el filtro."
          >
            <FilterItem
              label="Todas las secciones"
              count={totalArticles}
              active={section === TODOS}
              onClick={() => setSection(TODOS)}
            />
            <div className="max-h-56 overflow-y-auto -mr-1 pr-1">
              {sectionCounts.map(([s, count]) => (
                <FilterItem
                  key={s}
                  label={s}
                  count={count}
                  active={section === s}
                  onClick={() => setSection(section === s ? TODOS : s)}
                />
              ))}
            </div>
          </FilterCard>

          <FilterCard
            title="Canal de adquisición"
            info="De dónde llega el tráfico: Google (búsqueda/Discover), directo, redes sociales, etc. La barra muestra el peso relativo de cada canal dentro de la sección activa. Haz clic para filtrar los artículos por ese canal."
          >
            <FilterItem
              label="Todos los canales"
              count={fmt(totalChannelPv)}
              active={channel === TODOS}
              onClick={() => setChannel(TODOS)}
            />
            <div className="max-h-72 overflow-y-auto -mr-1 pr-1">
              {channels.map(([c, pv]) => (
                <FilterItem
                  key={c}
                  label={c}
                  count={fmt(pv)}
                  active={channel === c}
                  barPct={maxChannelPv > 0 ? Math.round((pv / maxChannelPv) * 100) : 0}
                  onClick={() => setChannel(channel === c ? TODOS : c)}
                />
              ))}
            </div>
            {channels.length === 0 && <li className="text-xs text-gray-400 py-1 list-none">Sin canales.</li>}
          </FilterCard>
        </div>

        {/* Artículos: frame con scroll interno (la página no crece con la lista) */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden self-start">
          <div className="px-4 py-3 border-b bg-gray-50">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                Artículos
                <InfoTooltip align="left">
                  Ranking de notas por page views según los filtros activos de sección y
                  canal. Cada fila muestra el título, la URL y los usuarios únicos. Es el
                  detalle de qué contenido concreto está trayendo el tráfico.
                </InfoTooltip>
              </h2>
              <span className="text-xs text-gray-400 shrink-0">{articles.length} notas · por page views</span>
            </div>
            {hasActiveFilters && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {section !== TODOS && <FilterChip onClear={() => setSection(TODOS)}>{section}</FilterChip>}
                {channel !== TODOS && <FilterChip onClear={() => setChannel(TODOS)}>{channel}</FilterChip>}
                <button
                  onClick={() => {
                    setSection(TODOS)
                    setChannel(TODOS)
                  }}
                  className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 ml-1"
                >
                  Limpiar filtros
                </button>
              </div>
            )}
          </div>
          <div className="divide-y max-h-[65vh] overflow-y-auto">
            {articles.map((a, i) => (
              <div key={a.page_path} className="px-4 py-3 flex items-start gap-3">
                <span className="text-sm font-bold text-gray-300 w-6 shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">{a.title ?? a.page_path}</p>
                  <div className="flex gap-3 mt-0.5">
                    <p className="text-xs text-gray-400 truncate font-mono">{a.page_path}</p>
                    {a.unique_users > 0 && (
                      <span className="text-xs text-gray-400 shrink-0">{fmt(a.unique_users)} usuarios</span>
                    )}
                  </div>
                </div>
                <span className="text-sm font-semibold text-gray-700 shrink-0">{fmt(a.pageviews)}</span>
              </div>
            ))}
            {articles.length === 0 && (
              <p className="px-4 py-6 text-sm text-gray-500 text-center">
                Sin artículos para este filtro.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Evolución por canal: contexto secundario, al fondo de la página */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
          Evolución de tráfico por canal
          <InfoTooltip align="left">
            Page views diarios por canal de adquisición en los últimos 7 días con dato
            (hasta el día completo más reciente). Los canales con menos volumen se
            agrupan en &quot;Otros canales&quot;. Haz clic en un canal de la leyenda
            para ocultarlo — útil porque Google suele dominar la escala.
          </InfoTooltip>
        </h2>
        {trendFrom && trendTo && (
          <p className="text-xs text-gray-400 mb-2">
            Del {fmtShortDate(trendFrom)} al {fmtShortDate(trendTo)}, en page views
          </p>
        )}
        <ChannelTrendChart data={trendData} channels={trendChannels} />
      </div>
    </div>
  )
}
