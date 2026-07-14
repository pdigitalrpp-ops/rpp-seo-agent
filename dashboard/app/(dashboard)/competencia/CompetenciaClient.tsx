"use client"

import { useMemo, useState, type ReactNode } from "react"
import { InfoTooltip } from "@/components/ui/InfoTooltip"
import { LastUpdated } from "@/components/ui/LastUpdated"
import { FilterCard, FilterChip, FilterItem } from "@/components/ui/FilterList"

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
  /^noticias de .+\|/, // páginas de etiqueta/tema ("Noticias de JNE | JNE - Perú 21"), no una nota
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

// ── Detección de columnas de opinión ───────────────────────────────────────
// Por URL, que es la señal confiable: El Comercio (y otros medios) publican
// opinión bajo /opinion/ (columnistas, editorial, colaboradores, efemérides)
// o con "-opinion-" en el slug (p.ej. las columnas de Día 1 en /economia/).
// Se muestran SOLO al seleccionar la categoría "opinión" — fuera de la vista
// por defecto ("Todas"), que es donde ensuciaban con titulares cortos.
const OPINION_CATEGORY = "opinión"

// Perú21 llega vía Google News RSS (news.google.com/rss/articles/...), no
// desde peru21.pe, así que no hay URL propia para detectar por ruta como en
// El Comercio. Se detecta por firma de autor en el titular (formatos:
// "<Nombre>: <texto>", "<texto> por <Nombre>", "<texto> | <Nombre>") más el
// bloque recurrente "cortitas de hoy" (resumen breve sin valor periodístico
// propio, mismo trato que una columna). Lista ampliable según se detecten
// más columnistas.
const PERU21_OPINION_AUTHORS = ["Fernando Tuesta Soldevilla", "Carlos Galdós", "Richard Arce", "Aníbal Quiroga"]

function isPeru21Opinion(a: Article): boolean {
  if (a.site !== "Peru21") return false
  const t = a.title
  return PERU21_OPINION_AUTHORS.some((name) => t.includes(name)) || /cortitas de hoy/i.test(t)
}

function isOpinion(a: Article): boolean {
  const u = a.url ?? ""
  return u.includes("/opinion/") || u.includes("-opinion-") || isPeru21Opinion(a)
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
  if (isOpinion(a)) return OPINION_CATEGORY
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

  // "Todas" NO incluye opinión: las columnas solo se ven seleccionando su
  // categoría explícitamente (piden verlas a demanda, no en la vista default).
  const matchesCategory = (a: Article) =>
    category === TODAS ? catOf(a) !== OPINION_CATEGORY : catOf(a) === category

  // Conteos con filtrado cruzado (facetas)
  const siteCounts = useMemo(() => {
    const base = pool.filter(matchesCategory)
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
        && matchesCategory(a)
        && matchesCoverage(a))
      .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
  }, [pool, site, category, coverage])

  const totalCross = pool.filter(matchesCategory).length
  const totalValor = articles.length - seoTotal

  const coverageLabel =
    coverage === COV_PENDIENTE ? "⚠ Pendientes" : coverage === COV_PUBLICADO ? "✓ Publicadas" : null

  const hasActiveFilters = site !== TODOS || category !== TODAS || coverage !== COV_TODAS

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          Competencia
          <InfoTooltip align="left">
            Qué están publicando hoy los principales medios peruanos (El Comercio, La
            República, Gestión, Perú21, Infobae). Usa los filtros para ver dónde están
            poniendo foco y detectar temas que RPP no está cubriendo. Los datos vienen
            de los feeds RSS de cada medio.
          </InfoTooltip>
        </h1>
        <LastUpdated kind="radar" finishedAt={lastRun} />
      </div>

      {/* Tipo de contenido: separa el periodismo del día del contenido SEO
          programático. Es el filtro que más cambia el tablero (redefine todo
          el conjunto de datos), por eso va arriba como control segmentado en
          vez de una entrada más del panel de filtros. */}
      <div className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-100 p-1">
        <SegmentButton active={contentType === "valor"} onClick={() => setContentType("valor")}>
          📰 Contenido de valor
          <CountPill active={contentType === "valor"}>{totalValor}</CountPill>
        </SegmentButton>
        <SegmentButton active={contentType === "seo"} onClick={() => setContentType("seo")}>
          🔍 Contenido SEO
          <CountPill active={contentType === "seo"}>{seoTotal}</CountPill>
        </SegmentButton>
        <InfoTooltip align="left" className="ml-1 mr-2">
          Separa el periodismo del día (&quot;Contenido de valor&quot;) de las notas
          hechas para posicionar en búsquedas recurrentes (&quot;Contenido SEO&quot;:
          loterías, precio del dólar, horóscopo, temblores, clima, dónde ver partidos,
          etc.). Los filtros de medio, categoría y cobertura aplican en ambos.
        </InfoTooltip>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        {/* Panel de filtros: un único lugar, mismo estilo para las 3 facetas */}
        <div className="space-y-4 self-start">
          <FilterCard
            title="Medios"
            info="Filtra las notas por medio. El número es cuántas notas publicó ese medio (según los demás filtros activos). Selecciona uno para ver solo sus notas; vuelve a hacer clic para quitarlo."
          >
            <FilterItem
              label="Todos los medios"
              count={totalCross}
              active={site === TODOS}
              onClick={() => setSite(TODOS)}
            />
            {SITES.map((s) => (
              <FilterItem
                key={s}
                icon={<MediumLogo site={s} url={null} size={16} />}
                label={s}
                count={siteCounts[s] ?? 0}
                active={site === s}
                onClick={() => setSite(site === s ? TODOS : s)}
              />
            ))}
          </FilterCard>

          <FilterCard
            title="Categoría"
            info={
              <>
                Cuántas notas publicó la competencia hoy en cada categoría. Ayuda a ver
                qué temas están saturados y en cuáles hay espacio. Las columnas de
                opinión no aparecen en &quot;Todas&quot;: selecciona la categoría
                &quot;opinión&quot; para verlas.
              </>
            }
          >
            <FilterItem
              label="Todas las categorías"
              count={categoryCounts.reduce((s, [cat, c]) => (cat === OPINION_CATEGORY ? s : s + c), 0)}
              active={category === TODAS}
              onClick={() => setCategory(TODAS)}
            />
            <div className="max-h-52 overflow-y-auto -mr-1 pr-1">
              {categoryCounts.map(([cat, count]) => (
                <FilterItem
                  key={cat}
                  label={cat}
                  count={count}
                  active={category === cat}
                  onClick={() => setCategory(category === cat ? TODAS : cat)}
                />
              ))}
            </div>
          </FilterCard>

          {hasCoverageData && (
            <FilterCard
              title="¿RPP ya lo publicó?"
              info="Compara cada titular de la competencia contra las notas que RPP publicó en las últimas horas (feed de rpp.pe) usando IA. “Pendientes” marca temas que la competencia cubre y RPP todavía no — son las brechas a cerrar."
            >
              <FilterItem
                label="Todas"
                count={publishedCount + pendingCount}
                active={coverage === COV_TODAS}
                onClick={() => setCoverage(COV_TODAS)}
              />
              <FilterItem
                icon={<span aria-hidden>⚠</span>}
                label="Pendientes"
                count={pendingCount}
                active={coverage === COV_PENDIENTE}
                accent="#D97706"
                onClick={() => setCoverage(coverage === COV_PENDIENTE ? COV_TODAS : COV_PENDIENTE)}
              />
              <FilterItem
                icon={<span aria-hidden>✓</span>}
                label="Publicadas"
                count={publishedCount}
                active={coverage === COV_PUBLICADO}
                accent="#0D9488"
                onClick={() => setCoverage(coverage === COV_PUBLICADO ? COV_TODAS : COV_PUBLICADO)}
              />
            </FilterCard>
          )}
        </div>

        {/* Ventana con las notas */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden self-start">
          <div className="px-4 py-3 border-b bg-gray-50">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-700">
                {contentType === "seo" ? "Notas · Contenido SEO" : "Notas"}
              </h2>
              <span className="text-xs text-gray-400 shrink-0">{list.length} notas</span>
            </div>
            {hasActiveFilters && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {site !== TODOS && (
                  <FilterChip onClear={() => setSite(TODOS)}>{site}</FilterChip>
                )}
                {category !== TODAS && (
                  <FilterChip onClear={() => setCategory(TODAS)}>{category}</FilterChip>
                )}
                {coverageLabel && (
                  <FilterChip onClear={() => setCoverage(COV_TODAS)}>{coverageLabel}</FilterChip>
                )}
                <button
                  onClick={() => {
                    setSite(TODOS)
                    setCategory(TODAS)
                    setCoverage(COV_TODAS)
                  }}
                  className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 ml-1"
                >
                  Limpiar filtros
                </button>
              </div>
            )}
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

/** Botón del control segmentado "Tipo de contenido". */
function SegmentButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
        active ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
      }`}
    >
      {children}
    </button>
  )
}

function CountPill({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span
      className={`text-xs rounded-full px-1.5 py-0.5 ${
        active ? "bg-rpp-teal/10 text-rpp-teal" : "bg-gray-200 text-gray-500"
      }`}
    >
      {children}
    </span>
  )
}

