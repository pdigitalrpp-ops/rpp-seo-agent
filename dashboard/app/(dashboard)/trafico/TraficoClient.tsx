"use client"

import { useMemo, useState } from "react"
import { Pill } from "@/components/ui/Pill"
import { StatCard } from "@/components/ui/StatCard"

export type ChannelRow = {
  page_path: string
  title: string | null
  channel: string | null
  pageviews: number | null
  unique_users: number | null
}

const TODOS = "Todos"

/**
 * Solo contenido editorial de rpp.pe: notas (…-noticia-<id>) y coberturas en vivo
 * (…-live-<id>). Descarta home, homes de sección (/deportes), landings/herramientas,
 * buscador, /ultimas-noticias, /tv-vivo, /audio/en-vivo, listados y el widget mrf.io.
 */
const ARTICLE_RE = /-(noticia|live)-\d+/i

function isRealArticle(pagePath: string): boolean {
  try {
    const u = new URL(pagePath)
    const host = u.hostname.replace(/^www\./, "")
    if (host !== "rpp.pe" && !host.endsWith(".rpp.pe")) return false
    return ARTICLE_RE.test(u.pathname)
  } catch {
    return false
  }
}

/** Deriva la "sección" (primer segmento del path) desde la URL del artículo. */
function sectionOf(pagePath: string): string {
  try {
    const u = new URL(pagePath)
    const host = u.hostname.replace(/^www\./, "")
    if (host !== "rpp.pe" && !host.endsWith(".rpp.pe")) return host // dominios ajenos (mrf.io…)
    const seg = u.pathname.split("/").filter(Boolean)
    if (seg.length === 0) return "(home)"
    return seg[0]
  } catch {
    return "(otros)"
  }
}

function fmt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("es-PE")
}

export default function TraficoClient({
  rows,
  hasChannelData,
  date,
}: {
  rows: ChannelRow[]
  hasChannelData: boolean
  date: string
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Tráfico (Marfeel)</h1>
        <span className="text-sm text-gray-500">{date}</span>
      </div>

      {!hasChannelData && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          Aún no hay datos por canal (se poblan en la próxima corrida del benchmark matutino).
          Mientras tanto puedes filtrar por <b>Sección</b>; el filtro por canal se activará solo.
        </div>
      )}

      {/* Filtro de Sección (arriba) */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Sección</h2>
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

      {/* Tarjetas resumen (según filtro activo) */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Page views" value={fmt(totalPv)} accent="#F97316" />
        <StatCard label="Usuarios únicos" value={fmt(totalUsers)} accent="#0D9488" />
        <StatCard label="Artículos" value={fmt(articles.length)} accent="#8B5CF6" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        {/* Sidebar: canal de adquisición (reacciona a la sección) */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 self-start">
          <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">
            Canal de adquisición
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
            <h2 className="text-sm font-semibold text-gray-700">
              Artículos
              {channel !== TODOS ? ` · ${channel}` : ""}
              {section !== TODOS ? ` · ${section}` : ""}
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
