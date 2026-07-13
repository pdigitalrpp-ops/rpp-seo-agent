"use client"

import { useMemo, useState } from "react"
import { Pill } from "@/components/ui/Pill"
import { InfoTooltip } from "@/components/ui/InfoTooltip"
import { LastUpdated } from "@/components/ui/LastUpdated"

export type Article = {
  id: string
  site: string
  title: string
  url: string | null
  published_at: string | null
  category: string | null
  rpp_has_coverage: boolean | null
  rpp_matched_title: string | null
  rpp_matched_url: string | null
}

const COV_TODAS = "__cov_todas__"
const COV_PUBLICADO = "publicado"
const COV_PENDIENTE = "pendiente"

const TODOS = "__todos__"
const TODAS = "__todas__"

type ContentType = "valor" | "seo"

// ── Detección de "contenido SEO" (commodity/programático) ─────────────────
// Notas hechas para posicionar en búsquedas recurrentes, no periodismo del
// día: loterías, precio del dólar, horóscopo, temblor hoy, clima, dónde ver
// partidos, mastergrama/carlincatura, contenido para inmigrantes en USA, etc.
// Se detecta por patrones del titular (los formatos son muy formulaicos).
// Para ajustar: añadir/quitar regex de esta lista. Se matchea sobre el título
// en minúsculas y sin tildes (salvo los patrones case-sensitive).
const SEO_PATTERNS: RegExp[] = [
  /temblor (en|hoy)/, // "Temblor en Perú HOY...", "Temblor hoy, en Colombia"
  /reporte sismico|ultimos sismos|sismos? reportados/,
  /horoscopo|predicciones (para tu|segun tu) signo/,
  /sorteo zodiaco|la tinka|quini 6|gana diario|kabala|loteria/,
  /numeros ganadores|bolillas ganadoras|revento el pozo|resultados sorteo/,
  /precio del (dolar|euro)|cotizacion de (apertura|cierre)|tipo de cambio|usd en mxn/,
  /precio de la gasolina/,
  /clima en|pronostico del (clima|tiempo)|prediccion del clima/,
  /donde ver|a que hora (empieza|empiezan|juega|se juega)|horarios?, canales/,
  /partidos de hoy/,
  /en vivo.*transmision|transmision.*en vivo|mira aqui la transmision/,
  /mastergrama|carlincatura|solucionario/,
  /efemerides|un dia como hoy/,
  /alimentos gratis|cupones de alimentos|food stamps|despensas/,
  /migrantes? en (estados unidos|eeuu|usa)|green card|corte de inmigracion/,
  /link para consultar|consulta (aqui|en este link)/,
]
// Case-sensitive: "ICE" (la agencia migratoria de USA) en mayúsculas, para no
// matchear palabras que contengan "ice".
const SEO_PATTERNS_CS: RegExp[] = [/\bICE\b/]

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "")
}

function isSeoContent(title: string): boolean {
  const t = stripAccents(title.toLowerCase())
  return SEO_PATTERNS.some((re) => re.test(t)) || SEO_PATTERNS_CS.some((re) => re.test(title))
}

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
  lastRun,
}: {
  articles: Article[]
  date: string
  lastRun: string | null
}) {
  const [site, setSite] = useState<string>(TODOS)
  const [category, setCategory] = useState<string>(TODAS)
  const [coverage, setCoverage] = useState<string>(COV_TODAS)
  const [contentType, setContentType] = useState<ContentType>("valor")

  // Split contenido de valor vs contenido SEO: todo el tablero (categorías,
  // medios, notas, cobertura) opera sobre el grupo seleccionado. Default: valor.
  const seoTotal = useMemo(() => articles.filter((a) => isSeoContent(a.title)).length, [articles])
  const pool = useMemo(
    () => articles.filter((a) => isSeoContent(a.title) === (contentType === "seo")),
    [articles, contentType],
  )

  // ¿Se calculó cobertura para esta corrida? (si ninguna nota trae el flag, el
  // benchmark aún no corrió con la feature — ocultamos el filtro y los badges).
  const hasCoverageData = useMemo(
    () => pool.some((a) => a.rpp_has_coverage !== null && a.rpp_has_coverage !== undefined),
    [pool],
  )
  const pendingCount = useMemo(
    () => pool.filter((a) => a.rpp_has_coverage === false).length,
    [pool],
  )
  const publishedCount = useMemo(
    () => pool.filter((a) => a.rpp_has_coverage === true).length,
    [pool],
  )
  const matchesCoverage = (a: Article) =>
    coverage === COV_TODAS ||
    (coverage === COV_PUBLICADO && a.rpp_has_coverage === true) ||
    (coverage === COV_PENDIENTE && a.rpp_has_coverage === false)

  // Conteos con filtrado cruzado (facetas)
  const siteCounts = useMemo(() => {
    const base = category === TODAS ? pool : pool.filter((a) => catOf(a) === category)
    const acc: Record<string, number> = {}
    for (const a of base) acc[a.site] = (acc[a.site] ?? 0) + 1
    return acc
  }, [pool, category])

  const categoryCounts = useMemo(() => {
    const base = site === TODOS ? pool : pool.filter((a) => a.site === site)
    const acc: Record<string, number> = {}
    for (const a of base) acc[catOf(a)] = (acc[catOf(a)] ?? 0) + 1
    return Object.entries(acc).sort((a, b) => b[1] - a[1])
  }, [pool, site])

  const list = useMemo(() => {
    return pool
      .filter((a) => (site === TODOS || a.site === site)
        && (category === TODAS || catOf(a) === category)
        && matchesCoverage(a))
      .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
  }, [pool, site, category, coverage])

  const totalCross = category === TODAS ? pool.length : pool.filter((a) => catOf(a) === category).length

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
        <LastUpdated kind="radar" finishedAt={lastRun} />
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

      {/* Filtro de cobertura RPP */}
      {hasCoverageData && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
            ¿RPP ya lo publicó?
            <InfoTooltip align="left">
              Compara cada titular de la competencia contra las notas que RPP publicó en
              las últimas horas (feed de rpp.pe) usando IA. &quot;⚠ Pendiente&quot; marca
              temas que la competencia cubre y RPP todavía no — son las brechas a cerrar.
            </InfoTooltip>
          </h2>
          <div className="flex flex-wrap gap-2">
            <Pill variant="solid" active={coverage === COV_TODAS} onClick={() => setCoverage(COV_TODAS)}>
              Todas: {publishedCount + pendingCount}
            </Pill>
            <Pill variant="solid" active={coverage === COV_PENDIENTE} onClick={() => setCoverage(coverage === COV_PENDIENTE ? COV_TODAS : COV_PENDIENTE)}>
              ⚠ Pendientes: {pendingCount}
            </Pill>
            <Pill variant="solid" active={coverage === COV_PUBLICADO} onClick={() => setCoverage(coverage === COV_PUBLICADO ? COV_TODAS : COV_PUBLICADO)}>
              ✓ Publicadas: {publishedCount}
            </Pill>
          </div>
        </div>
      )}

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

          {/* Tipo de contenido */}
          <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 mt-5 mb-3 flex items-center gap-1.5">
            Tipo de contenido
            <InfoTooltip align="left">
              Separa el periodismo del día (&quot;Contenido de valor&quot;, lo que se
              muestra por defecto) de las notas hechas para posicionar en búsquedas
              recurrentes (&quot;Contenido SEO&quot;: loterías, precio del dólar,
              horóscopo, temblores, clima, dónde ver partidos, etc.). Los filtros de
              medio y categoría aplican en ambos.
            </InfoTooltip>
          </h2>
          <ul className="space-y-1">
            <ContentTypeItem
              label="Contenido de valor"
              count={articles.length - seoTotal}
              active={contentType === "valor"}
              onClick={() => setContentType("valor")}
            />
            <ContentTypeItem
              label="Contenido SEO"
              count={seoTotal}
              active={contentType === "seo"}
              onClick={() => setContentType("seo")}
            />
          </ul>
        </div>

        {/* Ventana con las notas */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden self-start">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              {contentType === "seo" ? "Notas · Contenido SEO" : "Notas"}
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
                    <CoverageBadge article={a} />
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

/** Badge de cobertura: ✓ Publicado en RPP / ⚠ Pendiente. */
function CoverageBadge({ article }: { article: Article }) {
  if (article.rpp_has_coverage === null || article.rpp_has_coverage === undefined) return null
  if (article.rpp_has_coverage) {
    const badge = (
      <span className="text-xs rounded px-1.5 py-0.5 bg-teal-50 text-teal-700 border border-teal-200">
        ✓ Publicado en RPP
      </span>
    )
    // Si hay match, enlaza a la nota de RPP; el title muestra cuál.
    return article.rpp_matched_url ? (
      <a
        href={article.rpp_matched_url}
        target="_blank"
        rel="noopener noreferrer"
        title={article.rpp_matched_title ?? undefined}
        className="hover:opacity-80"
      >
        {badge}
      </a>
    ) : badge
  }
  return (
    <span className="text-xs rounded px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200">
      ⚠ Pendiente
    </span>
  )
}

/** Ítem del selector de tipo de contenido (valor vs SEO), estilo MediumItem. */
function ContentTypeItem({
  label,
  count,
  active,
  onClick,
}: {
  label: string
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
        <span className="truncate flex-1 text-left">{label}</span>
        <span className={`text-xs shrink-0 ${active ? "text-rpp-teal" : "text-gray-400"}`}>{count}</span>
      </button>
    </li>
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
