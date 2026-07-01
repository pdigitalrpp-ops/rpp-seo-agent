"use client"

import { useMemo, useState } from "react"

export type ChannelRow = {
  page_path: string
  title: string | null
  channel: string | null
  pageviews: number | null
  unique_users: number | null
}

const TODOS = "Todos"

/** Deriva el "folder" (primer segmento del path) desde la URL del artículo. */
function folderOf(pagePath: string): string {
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
  // Canales presentes, ordenados por page views total (desc)
  const channels = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const r of rows) {
      const c = r.channel || "Otros"
      acc[c] = (acc[c] ?? 0) + (r.pageviews ?? 0)
    }
    return Object.entries(acc).sort((a, b) => b[1] - a[1])
  }, [rows])

  const folders = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) set.add(folderOf(r.page_path))
    return Array.from(set).sort()
  }, [rows])

  // Default: canal Google si existe; si no, Todos
  const defaultChannel = hasChannelData && channels.some(([c]) => c === "Google") ? "Google" : TODOS
  const [channel, setChannel] = useState<string>(defaultChannel)
  const [folder, setFolder] = useState<string>(TODOS)

  // Filas filtradas por canal + folder
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (channel !== TODOS && (r.channel || "Otros") !== channel) return false
      if (folder !== TODOS && folderOf(r.page_path) !== folder) return false
      return true
    })
  }, [rows, channel, folder])

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

  // Distribución de canales dentro del folder seleccionado (ignora el filtro de canal)
  const channelDist = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const r of rows) {
      if (folder !== TODOS && folderOf(r.page_path) !== folder) continue
      const c = r.channel || "Otros"
      acc[c] = (acc[c] ?? 0) + (r.pageviews ?? 0)
    }
    return Object.entries(acc).sort((a, b) => b[1] - a[1])
  }, [rows, folder])

  const totalPv = articles.reduce((s, a) => s + a.pageviews, 0)
  const totalUsers = articles.reduce((s, a) => s + a.unique_users, 0)
  const distTotal = channelDist.reduce((s, [, v]) => s + v, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Tráfico (Marfeel)</h1>
        <span className="text-sm text-gray-500">{date}</span>
      </div>

      {!hasChannelData && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          Aún no hay datos por canal (se poblan en la próxima corrida del benchmark matutino).
          Mientras tanto puedes filtrar por <b>Folder</b>; el filtro por canal se activará solo.
        </div>
      )}

      {/* Tarjetas resumen (según filtro activo) */}
      <div className="grid grid-cols-3 gap-4">
        <Card label="Page views" value={fmt(totalPv)} />
        <Card label="Usuarios únicos" value={fmt(totalUsers)} />
        <Card label="Artículos" value={fmt(articles.length)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
        {/* Sidebar: canal + folder */}
        <div className="space-y-6">
          {/* Canal de adquisición */}
          <div className="bg-white rounded-xl border p-4">
            <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">
              Canal de adquisición
            </h2>
            <ul className="space-y-1">
              <ChannelItem
                label={TODOS}
                pv={channels.reduce((s, [, v]) => s + v, 0)}
                active={channel === TODOS}
                onClick={() => setChannel(TODOS)}
                disabled={false}
              />
              {channels.map(([c, pv]) => (
                <ChannelItem
                  key={c}
                  label={c}
                  pv={pv}
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

          {/* Folder */}
          <div className="bg-white rounded-xl border p-4">
            <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Folder</h2>
            <select
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-200"
            >
              <option value={TODOS}>Todos</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Main */}
        <div className="space-y-6">
          {/* Distribución por canal */}
          <div className="bg-white rounded-xl border p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              Distribución por canal{folder !== TODOS ? ` — ${folder}` : ""}
            </h2>
            <div className="space-y-2">
              {channelDist.map(([c, pv]) => {
                const pct = distTotal > 0 ? Math.round((pv / distTotal) * 100) : 0
                return (
                  <button
                    key={c}
                    onClick={() => hasChannelData && setChannel(channel === c ? TODOS : c)}
                    className="flex w-full items-center gap-3 text-left"
                  >
                    <span
                      className={`text-xs w-32 shrink-0 truncate ${
                        channel === c ? "font-bold text-red-600" : "text-gray-600"
                      }`}
                    >
                      {c}
                    </span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2">
                      <div className="bg-red-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-gray-700 w-10 text-right">{pct}%</span>
                    <span className="text-xs text-gray-400 w-20 text-right">{fmt(pv)} pv</span>
                  </button>
                )
              })}
              {channelDist.length === 0 && (
                <p className="text-xs text-gray-400">Sin datos.</p>
              )}
            </div>
          </div>

          {/* Lista de artículos */}
          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">
                Artículos
                {channel !== TODOS ? ` · ${channel}` : ""}
                {folder !== TODOS ? ` · ${folder}` : ""}
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
    </div>
  )
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  )
}

function ChannelItem({
  label,
  pv,
  active,
  onClick,
  disabled,
}: {
  label: string
  pv: number
  active: boolean
  onClick: () => void
  disabled: boolean
}) {
  return (
    <li>
      <button
        onClick={onClick}
        disabled={disabled}
        className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm transition ${
          active ? "bg-red-50 text-red-700 font-semibold" : "text-gray-700 hover:bg-gray-50"
        } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
      >
        <span className="truncate">{label}</span>
        <span className="text-xs text-gray-400 shrink-0 ml-2">{fmt(pv)}</span>
      </button>
    </li>
  )
}
