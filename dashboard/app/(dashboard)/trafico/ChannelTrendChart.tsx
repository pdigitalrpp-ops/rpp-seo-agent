"use client"

import { useState } from "react"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts"

export type TrendPoint = { date: string } & Record<string, number | string>
export type TrendChannelMeta = { key: string; label: string; color: string }

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function fmtFull(n: number): string {
  return n.toLocaleString("es-PE")
}

function fmtDayTick(iso: string): string {
  // Nota: Intl con solo {day,month} en es-PE ignora el "2-digit" (usa "d/M"
  // sin padding en vez de "dd/mm") — se arma el string a mano para evitarlo.
  const [, m, d] = iso.split("-")
  return `${d}/${m}`
}

function fmtDayLong(iso: string): string {
  const s = new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-PE", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const sorted = [...payload].sort((a: any, b: any) => (b.value ?? 0) - (a.value ?? 0))
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-lg text-xs min-w-[9rem]">
      <p className="font-semibold text-gray-500 mb-1.5">{fmtDayLong(label)}</p>
      <div className="space-y-1">
        {sorted.map((p: any) => (
          <div key={p.dataKey} className="flex items-center gap-2">
            <span className="inline-block w-3 h-0.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
            <span className="font-semibold text-gray-900 tabular-nums">{fmtFull(p.value ?? 0)}</span>
            <span className="text-gray-500 truncate">{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Evolución de page views por canal de adquisición en el tiempo. Un canal se
 * puede ocultar haciendo clic en su entrada de la leyenda — útil porque Google
 * suele dominar la escala y aplana visualmente a los canales chicos.
 */
export function ChannelTrendChart({ data, channels }: { data: TrendPoint[]; channels: TrendChannelMeta[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  function toggle(key: string) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (data.length === 0) {
    return (
      <p className="text-sm text-gray-500 text-center py-10">
        Sin datos de tráfico por canal en el rango disponible.
      </p>
    )
  }

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#e1e0d9" />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDayTick}
            tick={{ fontSize: 11, fill: "#898781" }}
            axisLine={{ stroke: "#c3c2b7" }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={fmtCompact}
            tick={{ fontSize: 11, fill: "#898781" }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip content={<CustomTooltip />} />
          {channels.length > 1 && (
            <Legend
              iconType="plainline"
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              formatter={(value, entry: any) => (
                <span
                  className="cursor-pointer select-none"
                  style={{ color: hidden.has(entry.dataKey) ? "#c3c2b7" : "#52514e" }}
                >
                  {value}
                </span>
              )}
              onClick={(entry: any) => toggle(entry.dataKey)}
            />
          )}
          {channels.map((c) => (
            <Line
              key={c.key}
              type="monotone"
              dataKey={c.key}
              name={c.label}
              stroke={c.color}
              strokeWidth={2}
              dot={false}
              hide={hidden.has(c.key)}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
