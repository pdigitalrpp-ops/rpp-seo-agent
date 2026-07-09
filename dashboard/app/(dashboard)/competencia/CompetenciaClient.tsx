"use client"

import { useMemo, useState } from "react"
import { Pill } from "@/components/ui/Pill"
import { InfoTooltip } from "@/components/ui/InfoTooltip"

export type Article = {
  id: string
  site: string
  title: string
  url: string | null
  published_at: string | null
  category: string | null
}

const TODOS = "__todos__"
const TODAS = "__todas__"

// Orden y metadatos de medios (dominio para el favicon + color de respaldo)
const SITES = ["El Comercio", "La República", "Gestión", "Peru21", "Infobae Perú"]
const SITE_META: Record<string, { domain: string; color: string }> = {
  "El Comercio": { domain: "elcomercio.pe", color: "#b8860b" },
  "La República": { domain: "larepublica.pe", color: "#c8102e" },
  Gestión: { domain: "gestion.pe", color: "#e35205" },
  Peru21: { domain: "peru21.pe", color: "#d81e05" },
  "Infobae Perú": { domain: "infobae.com", color: "#00a651" },
}

function domainOf(site: string, url: string | null): string {
  if (SITE_META[site]) return SITE_META[site].domain
  try {
    return new URL(url ?? "").hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

function colorOf(site: string): string {
  return SITE_META[site]?.color ?? "#6b7280"
}

function catOf(a: Article): string {
  return a.category ?? "otros"
}

function fmtTime(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleTimeString("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Lima",
  })
}

/** Logo del medio: favicon con respaldo a un punto de color con la inicial. */
function MediumLogo({ site, url, size = 18 }: { site: string; url: string | null; size?: number }) {
  const [failed, setFailed] = useState(false)
  const domain = domainOf(site, url)
  if (failed || !domain) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full text-white font-bold shrink-0"
        style={{ width: size, height: size, background: colorOf(site), fontSize: size * 0.55 }}
      >
        {site.charAt(0)}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
      alt={site}
      width={size}
      height={size}
      className="rounded shrink-0"
      onError={() => setFailed(true)}
    />
  )
}

export default function CompetenciaClient({
  articles,
  date,
}: {
  articles: Article[]
  date: string
}) {
  const [site, setSite] = useState<string>(TODOS)
  const [category, setCategory] = useState<string>(TODAS)

  // Conteos con filtrado cruzado (facetas)
  const siteCounts = useMemo(() => {
    const base = category === TODAS ? articles : articles.filter((a) => catOf(a) === category)
    const acc: Record<string, number> = {}
    for (const a of base) acc[a.site] = (acc[a.site] ?? 0) + 1
    return acc
  }, [articles, category])

  const categoryCounts = useMemo(() => {
    const base = site === TODOS ? articles : articles.filter((a) => a.site === site)
    const acc: Record<string, number> = {}
    for (const a of base) acc[catOf(a)] = (acc[catOf(a)] ?? 0) + 1
    return Object.entries(acc).sort((a, b) => b[1] - a[1])
  }, [articles, site])

  const list = useMemo(() => {
    return articles
      .filter((a) => (site === TODOS || a.site === site) && (category === TODAS || catOf(a) === category))
      .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
  }, [articles, site, category])

  const totalCross = category === TODAS ? articles.length : articles.filter((a) => catOf(a) === category).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          Competencia
          <InfoTooltip align="left">
            Qué están publicando hoy los principales medios peruanos (El Comercio, La
            República, Gestión, Perú21, Infobae). Puedes filtrar por medio y por
            categoría para ver dónde están poniendo foco y detectar temas que RPP no
            está cubriendo. Los datos vienen de los feeds RSS de cada medio.
          </InfoTooltip>
        </h1>
        <span className="text-sm text-gray-500">{date}</span>
      </div>

      {/* Categorías clicables */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
          Cobertura por categoría hoy
          <InfoTooltip align="left">
            Cuántas notas publicó la competencia hoy en cada categoría. Haz clic en una
            categoría para filtrar todo el tablero (medios y notas). Ayuda a ver qué
            temas están saturados y en cuáles hay espacio.
          </InfoTooltip>
        </h2>
        <div className="flex flex-wrap gap-2">
          <Pill variant="solid" active={category === TODAS} onClick={() => setCategory(TODAS)}>
            Todas: {categoryCounts.reduce((s, [, c]) => s + c, 0)}
          </Pill>
          {categoryCounts.map(([cat, count]) => (
            <Pill
              key={cat}
              variant="solid"
              active={category === cat}
              onClick={() => setCategory(category === cat ? TODAS : cat)}
            >
              {cat}: {count}
            </Pill>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
        {/* Navegador de medios */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 self-start">
          <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-1.5">
            Medios
            <InfoTooltip align="left">
              Filtra las notas por medio. El número es cuántas notas publicó ese medio
              (según el filtro de categoría activo). Selecciona uno para ver solo sus
              notas; vuelve a hacer clic para quitar el filtro.
            </InfoTooltip>
          </h2>
          <ul className="space-y-1">
            <MediumItem
              label="TODOS"
              count={totalCross}
              active={site === TODOS}
              onClick={() => setSite(TODOS)}
            />
            {SITES.map((s) => (
              <MediumItem
                key={s}
                label={s}
                site={s}
                count={siteCounts[s] ?? 0}
                active={site === s}
                onClick={() => setSite(site === s ? TODOS : s)}
              />
            ))}
          </ul>
        </div>

        {/* Ventana con las notas */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden self-start">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              Notas
              {site !== TODOS ? ` · ${site}` : ""}
              {category !== TODAS ? ` · ${category}` : ""}
            </h2>
            <span className="text-xs text-gray-400">{list.length} notas</span>
          </div>
          <div className="divide-y max-h-[70vh] overflow-y-auto">
            {list.map((a) => (
              <div key={a.id} className="px-4 py-2.5 flex items-start gap-3">
                <MediumLogo site={a.site} url={a.url} />
                <div className="flex-1 min-w-0">
                  {a.url ? (
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-gray-800 hover:text-rpp-teal line-clamp-2"
                    >
                      {a.title}
                    </a>
                  ) : (
                    <p className="text-sm text-gray-800 line-clamp-2">{a.title}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                      {catOf(a)}
                    </span>
                    {site === TODOS && <span className="text-xs text-gray-500">{a.site}</span>}
                    {a.published_at && <span className="text-xs text-gray-400">{fmtTime(a.published_at)}</span>}
                  </div>
                </div>
              </div>
            ))}
            {list.length === 0 && (
              <p className="px-4 py-8 text-sm text-gray-500 text-center">Sin notas para este filtro.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function MediumItem({
  label,
  site,
  count,
  active,
  onClick,
}: {
  label: string
  site?: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition ${
          active ? "bg-teal-50 text-rpp-teal font-semibold" : "text-gray-700 hover:bg-gray-50"
        }`}
      >
        {site ? <MediumLogo site={site} url={null} size={16} /> : <span className="w-4 shrink-0" />}
        <span className="truncate flex-1 text-left">{label}</span>
        <span className={`text-xs shrink-0 ${active ? "text-rpp-teal" : "text-gray-400"}`}>{count}</span>
      </button>
    </li>
  )
}
