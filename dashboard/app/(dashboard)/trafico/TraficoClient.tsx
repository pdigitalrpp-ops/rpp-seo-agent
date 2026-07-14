"use client"

import { useMemo, useState } from "react"
import { Pill } from "@/components/ui/Pill"
import { StatCard, type StatDelta } from "@/components/ui/StatCard"
import { InfoTooltip } from "@/components/ui/InfoTooltip"
import { LastUpdated } from "@/components/ui/LastUpdated"
import { DatePicker } from "@/components/ui/DatePicker"
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

  const sections = useMemo(() => {
    const set = new Set<string>()
    for (const r of cleanRows) set.add(sectionOf(r.page_path))
    return Array.from(set).sort()
  }, [cleanRows])

  // Canales por page views total; se limita a la sección seleccionada (requisito 4)
  const [section, setSection] = useState<string>(TODOS)

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

      {!hasChannelData && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          Este día no tiene datos por canal (o aún no se poblaron). Mientras tanto puedes
          filtrar por <b>Sección</b>; el filtro por canal se activará solo.
        </div>
      )}

      {/* Filtro de Sección (arriba) */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-1.5">
          Sección
          <InfoTooltip align="left">
            Filtra el tráfico por sección de rpp.pe (deportes, política, etc.), derivada
            de la URL de cada nota. Al elegir una sección, las tarjetas, los canales y la
            lista de artículos se recalculan solo para esa sección.
          </InfoTooltip>
        </h2>
        <div className="flex flex-wrap gap-2">
          <Pill variant="solid" active={section === TODOS} onClick={() => setSection(TODOS)}>
            Todas
          </Pill>
          {sections.map((s) => (
            <Pill key={s} variant="solid" active={section === s} onClick={() => setSection(s)}>
              {s}
            </Pill>
          ))}
        </div>
      </div>

      {/* Tarjetas resumen (según filtro activo), con comparativa vs día anterior */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Page views"
          value={fmt(totalPv)}
          delta={pvDelta}
          accent="#F97316"
          info="Total de vistas de página de los artículos según el filtro activo (sección y canal). La comparativa es contra el último día con datos disponibles, bajo el mismo filtro."
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

      {/* Evolución de tráfico por canal */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
          Evolución de tráfico por canal
          <InfoTooltip align="left">
            Page views diarios de los últimos 14 días (terminando en el día que estás
            viendo), separados por canal de adquisición. Los canales con menos volumen
            se agrupan en &quot;Otros canales&quot;. Haz clic en un canal de la leyenda
            para ocultarlo — útil porque Google suele dominar la escala.
          </InfoTooltip>
        </h2>
        <p className="text-xs text-gray-400 mb-2">Últimos 14 días, en page views</p>
        <ChannelTrendChart data={trendData} channels={trendChannels} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        {/* Sidebar: canal de adquisición (reacciona a la sección) */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 self-start">
          <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-1.5">
            Canal de adquisición
            <InfoTooltip align="left">
              De dónde llega el tráfico: Google (búsqueda/Discover), directo, redes
              sociales, etc. La barra muestra el peso relativo de cada canal. Haz clic
              para filtrar los artículos por ese canal y ver qué contenido rinde en cada
              fuente.
            </InfoTooltip>
          </h2>
          <ul className="space-y-1.5">
            <ChannelItem
              label={TODOS}
              pv={totalChannelPv}
              pct={0}
              showBar={false}
              active={channel === TODOS}
              onClick={() => setChannel(TODOS)}
              disabled={false}
            />
            {channels.map(([c, pv]) => (
              <ChannelItem
                key={c}
                label={c}
                pv={pv}
                pct={maxChannelPv > 0 ? Math.round((pv / maxChannelPv) * 100) : 0}
                showBar
                active={channel === c}
                onClick={() => setChannel(c)}
                disabled={!hasChannelData}
              />
            ))}
            {channels.length === 0 && (
              <li className="text-xs text-gray-400 py-1">Sin canales.</li>
            )}
          </ul>
        </div>

        {/* Lista de artículos */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden self-start">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
              <span>
                Artículos
                {channel !== TODOS ? ` · ${channel}` : ""}
                {section !== TODOS ? ` · ${section}` : ""}
              </span>
              <InfoTooltip align="left">
                Ranking de notas por page views según los filtros activos de sección y
                canal. Cada fila muestra el título, la URL y los usuarios únicos. Es el
                detalle de qué contenido concreto está trayendo el tráfico.
              </InfoTooltip>
            </h2>
            <span className="text-xs text-gray-400">Por page views</span>
          </div>
          <div className="divide-y">
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
    </div>
  )
}

function ChannelItem({
  label,
  pv,
  pct,
  showBar,
  active,
  onClick,
  disabled,
}: {
  label: string
  pv: number
  pct: number
  showBar: boolean
  active: boolean
  onClick: () => void
  disabled: boolean
}) {
  return (
    <li>
      <button
        onClick={onClick}
        disabled={disabled}
        className={`w-full rounded-lg px-2 py-1.5 text-left transition ${
          active ? "bg-teal-50" : "hover:bg-gray-50"
        } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={`truncate text-sm ${
              active ? "text-rpp-teal font-semibold" : "text-gray-700"
            }`}
          >
            {label}
          </span>
          <span
            className={`shrink-0 text-xs ${active ? "text-rpp-teal font-semibold" : "text-gray-500"}`}
          >
            {fmt(pv)}
          </span>
        </div>
        {/* Minibarra de volumen bajo el número */}
        {showBar && (
          <div className="mt-1 h-1 w-full rounded-full bg-gray-100">
            <div
              className={`h-1 rounded-full ${active ? "bg-rpp-teal" : "bg-teal-300"}`}
              style={{ width: `${Math.max(pct, 2)}%` }}
            />
          </div>
        )}
      </button>
    </li>
  )
}
