"use client"

import { useMemo, useState, type FormEvent, type ReactNode } from "react"
import { supabase } from "@/lib/supabase"
import { InfoTooltip } from "@/components/ui/InfoTooltip"
import { LastUpdated } from "@/components/ui/LastUpdated"
import { StatCard } from "@/components/ui/StatCard"
import { FilterCard, FilterItem, FilterChip } from "@/components/ui/FilterList"
import { Pill } from "@/components/ui/Pill"
import type { WatchKeyword, WatchHit } from "./types"

/**
 * Radar de temas — las "Google Alerts" propias del equipo.
 *
 * Vive en su propia pestaña (antes era un bloque al pie de /alertas). La
 * diferencia con /alertas y /trends es de ORIGEN, no de formato: allá la lista
 * la pone Google (top ~10 nacional de búsquedas), acá la pone el equipo. Por eso
 * un tema de nicho pero editorialmente valioso —un concierto, una empresa, un
 * vocero— solo puede aparecer acá.
 *
 * La lista de temas se administra desde el propio panel con la anon key (RLS
 * abierto, mismo criterio MVP que audit_check_state); el agente la lee en cada
 * corrida del radar (collectors/watchlist.py) y escribe en watch_hits.
 */

// Misma taxonomía que KNOWN_SECTIONS_FALLBACK del agente (config.py).
const SECCIONES = [
  "politica", "economia", "deportes", "mundo", "actualidad",
  "lima", "peru", "tecnologia", "salud", "entretenimiento",
  "cine-series", "musica", "viral",
]

const TODOS = "__todos__"

const VIA_LABEL: Record<string, string> = {
  google_news: "Google News",
  competencia: "Competencia",
}

/**
 * Ventanas del selector. Se filtra por `created_at` (cuándo lo ENCONTRÓ el
 * agente) y no por `published_at`: una nota publicada anteayer que el radar
 * recién descubrió hoy es novedad para el equipo, y varios feeds ni siquiera
 * traen fecha de publicación. El servidor trae 7 días, así que cambiar de
 * ventana no dispara otra consulta.
 */
const WINDOWS: { hours: number; label: string }[] = [
  { hours: 24,  label: "24 h" },
  { hours: 48,  label: "48 h" },
  { hours: 168, label: "7 días" },
]
const DEFAULT_WINDOW_H = 48

// Paleta de respaldo para el avatar del medio cuando no hay favicon usable.
const AVATAR_COLORS = ["#0D9488", "#2563EB", "#7C3AED", "#DC2626", "#CA8A04", "#DB2777", "#059669"]

// ── Utilidades ─────────────────────────────────────────────────────────────

function stripAccents(s: string): string {
  // El rango del replace son las marcas diacríticas combinantes
  // (U+0300-U+036F), escritas literales: mismo patrón que stripAccents de
  // CompetenciaClient.tsx. Se ven vacías en el editor, no borrarlas.
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "")
}

function norm(s: string): string {
  return stripAccents((s || "").toLowerCase())
}

/** Timestamp de referencia del hallazgo: publicación si la hay, hallazgo si no. */
function tsOf(h: WatchHit): number {
  const raw = h.published_at || h.created_at
  const t = Date.parse(raw)
  return isNaN(t) ? 0 : t
}

/** "hace 12 min" / "hace 3 h" / "hace 2 d". Relativo: no depende de zona horaria. */
function hace(iso: string | null): string {
  if (!iso) return ""
  const ms = Date.now() - new Date(iso).getTime()
  if (isNaN(ms) || ms < 0) return ""
  const min = Math.floor(ms / 60000)
  if (min < 60) return `hace ${Math.max(min, 1)} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} d`
}

/**
 * Clave de día en hora de Lima ("2026-08-21"). en-CA da ISO ordenable, y el
 * timeZone explícito es obligatorio: el server de Vercel corre en UTC y sin
 * él los hallazgos de la noche caerían en el día siguiente.
 */
function dayKey(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Lima" })
}

function dayLabel(key: string): string {
  const hoy = dayKey(Date.now())
  const ayer = dayKey(Date.now() - 86400000)
  if (key === hoy) return "Hoy"
  if (key === ayer) return "Ayer"
  // key viene como YYYY-MM-DD; se fija a mediodía UTC para que el formateo a
  // Lima (UTC-5) no lo corra al día anterior.
  return new Date(`${key}T12:00:00Z`)
    .toLocaleDateString("es-PE", { timeZone: "America/Lima", weekday: "short", day: "numeric", month: "short" })
    .replace(".", "")
}

function viaLabel(via: string | null): string {
  if (!via) return ""
  if (VIA_LABEL[via]) return VIA_LABEL[via]
  return via.indexOf("feed:") === 0 ? via.slice(5) : via
}

/** Dominio del artículo, o "" si la URL no identifica al medio. */
function domainOf(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "")
    // Los hits de Google News apuntan a su redirector: el favicon sería el de
    // Google para todos los medios, así que no sirve para distinguirlos.
    return host.indexOf("news.google.com") >= 0 ? "" : host
  } catch {
    return ""
  }
}

function colorOf(name: string): string {
  let acc = 0
  for (let i = 0; i < name.length; i++) acc = (acc * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[acc % AVATAR_COLORS.length]
}

/** Favicon del medio, con respaldo a un cuadro de color con la inicial. */
function MedioAvatar({ source, url }: { source: string; url: string }) {
  const [failed, setFailed] = useState(false)
  const domain = domainOf(url)
  if (failed || !domain) {
    return (
      <span
        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white"
        style={{ background: colorOf(source || url) }}
        aria-hidden
      >
        {(source || "?").charAt(0).toUpperCase()}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
      alt=""
      width={20}
      height={20}
      className="mt-0.5 h-5 w-5 shrink-0 rounded"
      onError={() => setFailed(true)}
    />
  )
}

/** Botón cuadrado de acción sobre una fila (pausar, borrar, descartar). */
function IconButton({
  onClick, label, className = "", children,
}: { onClick: () => void; label: string; className?: string; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex h-5 w-5 items-center justify-center rounded text-xs leading-none text-gray-400 transition hover:bg-gray-100 ${className}`}
    >
      {children}
    </button>
  )
}

// ── Panel ──────────────────────────────────────────────────────────────────

export default function RadarClient({
  keywords: initialKeywords,
  hits: initialHits,
  lastRun,
}: {
  keywords: WatchKeyword[]
  hits: WatchHit[]
  lastRun: string | null
}) {
  const [keywords, setKeywords] = useState<WatchKeyword[]>(initialKeywords)
  const [hits, setHits] = useState<WatchHit[]>(initialHits)

  const [tema, setTema] = useState<string>(TODOS)
  const [via, setVia] = useState<string>(TODOS)
  const [medio, setMedio] = useState<string>(TODOS)
  const [q, setQ] = useState("")
  const [windowH, setWindowH] = useState<number>(DEFAULT_WINDOW_H)
  const [onlyNew, setOnlyNew] = useState(false)
  const [asc, setAsc] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [newKeyword, setNewKeyword] = useState("")
  const [newLabel, setNewLabel] = useState("")
  const [newSection, setNewSection] = useState("")
  const [newFeeds, setNewFeeds] = useState("")

  // "NUEVO" = encontrado en la ÚLTIMA corrida del radar, no un plazo fijo
  // arbitrario. El margen de 10 min existe porque lastRun es el finished_at de
  // la corrida y los hallazgos se guardan unos minutos antes de que termine.
  const newCutoff = useMemo(
    () => (lastRun ? new Date(lastRun).getTime() - 10 * 60 * 1000 : null),
    [lastRun]
  )
  const esNuevo = (h: WatchHit) =>
    newCutoff !== null && new Date(h.created_at).getTime() >= newCutoff

  const kwById = useMemo(() => {
    const m: Record<string, WatchKeyword> = {}
    keywords.forEach((k) => { m[k.id] = k })
    return m
  }, [keywords])

  /** Nombre legible del tema del hallazgo (cae a la query cruda si no hay label). */
  const nombreTema = (h: WatchHit) => {
    const kw = h.keyword_id ? kwById[h.keyword_id] : undefined
    return kw?.label || kw?.keyword || h.keyword
  }

  // Ventana temporal: base de TODO lo demás (KPIs incluidos), para que los
  // indicadores de arriba hablen del mismo período que la lista de abajo.
  const enVentana = useMemo(() => {
    const cutoff = Date.now() - windowH * 60 * 60 * 1000
    return hits.filter((h) => new Date(h.created_at).getTime() >= cutoff)
  }, [hits, windowH])

  // Filtros con conteo cruzado: cada faceta se cuenta bajo las OTRAS activas,
  // así los números del panel lateral nunca prometen resultados vacíos.
  const nq = norm(q)
  const pasa = useMemo(() => {
    return (h: WatchHit, salvo?: "tema" | "via" | "medio") => {
      if (salvo !== "tema" && tema !== TODOS && h.keyword_id !== tema) return false
      if (salvo !== "via" && via !== TODOS && (h.found_via ?? "") !== via) return false
      if (salvo !== "medio" && medio !== TODOS && (h.source ?? "") !== medio) return false
      if (onlyNew && !(newCutoff !== null && new Date(h.created_at).getTime() >= newCutoff)) return false
      if (nq && norm(h.title).indexOf(nq) < 0 && norm(h.source ?? "").indexOf(nq) < 0) return false
      return true
    }
  }, [tema, via, medio, onlyNew, nq, newCutoff])

  const temaCounts = useMemo(() => {
    const acc: Record<string, number> = {}
    enVentana.filter((h) => pasa(h, "tema")).forEach((h) => {
      if (h.keyword_id) acc[h.keyword_id] = (acc[h.keyword_id] ?? 0) + 1
    })
    return acc
  }, [enVentana, pasa])

  const viaCounts = useMemo(() => {
    const acc: Record<string, number> = {}
    enVentana.filter((h) => pasa(h, "via")).forEach((h) => {
      const v = h.found_via ?? ""
      if (v) acc[v] = (acc[v] ?? 0) + 1
    })
    return Object.entries(acc).sort((a, b) => b[1] - a[1])
  }, [enVentana, pasa])

  const medioCounts = useMemo(() => {
    const acc: Record<string, number> = {}
    enVentana.filter((h) => pasa(h, "medio")).forEach((h) => {
      const s = h.source ?? ""
      if (s) acc[s] = (acc[s] ?? 0) + 1
    })
    return Object.entries(acc).sort((a, b) => b[1] - a[1])
  }, [enVentana, pasa])

  const lista = useMemo(() => {
    const out = enVentana.filter((h) => pasa(h))
    out.sort((a, b) => (asc ? tsOf(a) - tsOf(b) : tsOf(b) - tsOf(a)))
    return out
  }, [enVentana, pasa, asc])

  /** Hallazgos agrupados por día de Lima, respetando el orden ya elegido. */
  const grupos = useMemo(() => {
    const out: { key: string; items: WatchHit[] }[] = []
    lista.forEach((h) => {
      const key = dayKey(tsOf(h))
      const last = out[out.length - 1]
      if (last && last.key === key) last.items.push(h)
      else out.push({ key, items: [h] })
    })
    return out
  }, [lista])

  // ── Indicadores del período ──────────────────────────────────────────────
  const activos = keywords.filter((k) => k.active).length
  const pausados = keywords.length - activos
  const nuevos = useMemo(
    () => enVentana.filter((h) => newCutoff !== null && new Date(h.created_at).getTime() >= newCutoff).length,
    [enVentana, newCutoff]
  )
  const mediosDistintos = useMemo(
    () => new Set(enVentana.map((h) => h.source).filter(Boolean)).size,
    [enVentana]
  )
  const ventanaLabel = WINDOWS.find((w) => w.hours === windowH)?.label ?? `${windowH} h`
  const maxTemaCount = Math.max(1, ...Object.values(temaCounts))
  const hayFiltros = tema !== TODOS || via !== TODOS || medio !== TODOS || !!q || onlyNew

  function limpiarFiltros() {
    setTema(TODOS); setVia(TODOS); setMedio(TODOS); setQ(""); setOnlyNew(false)
  }

  // ── Mutaciones ───────────────────────────────────────────────────────────

  async function addKeyword(e: FormEvent) {
    e.preventDefault()
    const keyword = newKeyword.trim()
    if (!keyword || saving) return
    setSaving(true)
    setError(null)

    const feeds = newFeeds
      .split(/[\s,]+/)
      .map((f) => f.trim())
      .filter((f) => f.indexOf("http") === 0)

    const { data, error: err } = await supabase
      .from("watch_keywords")
      .insert({
        keyword,
        label: newLabel.trim() || null,
        section: newSection || null,
        extra_feeds: feeds.length ? feeds : null,
      })
      .select()
      .single()

    setSaving(false)
    if (err || !data) {
      // 23505 = unique_violation: esa keyword ya se está vigilando.
      setError(
        err && err.code === "23505"
          ? "Ese tema ya está en el radar."
          : "No se pudo guardar. Revisa la conexión e intenta de nuevo."
      )
      return
    }
    setKeywords((k) => k.concat(data as WatchKeyword))
    setNewKeyword(""); setNewLabel(""); setNewSection(""); setNewFeeds("")
    setFormOpen(false)
  }

  function toggleActive(kw: WatchKeyword) {
    const next = !kw.active
    setKeywords((list) => list.map((k) => (k.id === kw.id ? { ...k, active: next } : k)))
    supabase
      .from("watch_keywords")
      .update({ active: next })
      .eq("id", kw.id)
      .then(({ error: err }) => {
        if (err) {
          setKeywords((list) => list.map((k) => (k.id === kw.id ? { ...k, active: !next } : k)))
          setError("No se pudo cambiar el estado del tema.")
        }
      })
  }

  function removeKeyword(kw: WatchKeyword) {
    const nombre = kw.label || kw.keyword
    if (!window.confirm(`¿Sacar «${nombre}» del radar? Se borran también sus hallazgos.`)) return
    const backupKeywords = keywords
    const backupHits = hits
    setKeywords((list) => list.filter((k) => k.id !== kw.id))
    setHits((list) => list.filter((h) => h.keyword_id !== kw.id))
    if (tema === kw.id) setTema(TODOS)
    supabase
      .from("watch_keywords")
      .delete()
      .eq("id", kw.id)
      .then(({ error: err }) => {
        if (err) {
          setKeywords(backupKeywords)
          setHits(backupHits)
          setError("No se pudo eliminar el tema.")
        }
      })
  }

  /** Falso positivo: se saca del panel sin tocar la keyword. */
  function dismissHit(hit: WatchHit) {
    const backup = hits
    setHits((list) => list.filter((h) => h.id !== hit.id))
    supabase
      .from("watch_hits")
      .update({ dismissed: true })
      .eq("id", hit.id)
      .then(({ error: err }) => {
        if (err) {
          setHits(backup)
          setError("No se pudo descartar el hallazgo.")
        }
      })
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const sinTemas = keywords.length === 0

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            Radar de temas
            <InfoTooltip align="left">
              Tus propias alertas por keyword, al estilo de Google Alerts. Las de
              Alertas salen de lo más buscado del país (top ~10 del día), así que un
              tema de nicho —un concierto, una empresa, un vocero— nunca aparece ahí.
              Acá defines qué vigilar y el agente avisa apenas alguien publique algo:
              busca en Google News, en las ticketeras y feeds RSS que le indiques, y en
              los medios de la competencia que ya recolecta. Se revisa en cada corrida
              del radar.
            </InfoTooltip>
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Lo que se publica sobre los temas que sigue el equipo, aunque no sean
            tendencia nacional.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <LastUpdated kind="radar" finishedAt={lastRun} />
          <button
            onClick={() => { setFormOpen(!formOpen); setError(null) }}
            className="text-sm font-medium px-3 py-1.5 rounded-lg bg-rpp-teal text-white hover:opacity-90 transition"
          >
            {formOpen ? "Cancelar" : "+ Vigilar tema"}
          </button>
        </div>
      </div>

      {/* Indicadores del período */}
      {!sinTemas && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Temas en el radar"
            value={activos}
            subtitle={pausados ? `${pausados} en pausa` : "todos activos"}
            accent="#0D9488"
            info="Cuántas keywords está vigilando el agente ahora mismo. Las pausadas siguen en la lista pero no se consultan en cada corrida."
          />
          <StatCard
            label={`Publicaciones · ${ventanaLabel}`}
            value={enVentana.length}
            subtitle="encontradas en la ventana"
            accent="#2563EB"
            info="Notas encontradas sobre tus temas dentro de la ventana seleccionada. Cada nota aparece una sola vez: el agente deduplica por URL entre corridas."
          />
          <StatCard
            label="Nuevas"
            value={nuevos}
            subtitle="desde la última corrida"
            accent="#CA8A04"
            info="Hallazgos que entraron en la corrida más reciente del radar. Es lo que todavía no habías visto la última vez que abriste esta pestaña."
          />
          <StatCard
            label="Medios distintos"
            value={mediosDistintos}
            subtitle="cubriendo tus temas"
            accent="#7C3AED"
            info="Cuántas fuentes diferentes publicaron sobre tus temas en la ventana. Un número alto indica que el tema ya se masificó; uno bajo, que todavía hay ventaja."
          />
        </div>
      )}

      {/* Alta de tema — ancho completo, sobre las dos columnas */}
      {formOpen && (
        <form onSubmit={addKeyword} className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Qué vigilar</label>
            <input
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              placeholder="concierto en lima"
              autoFocus
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rpp-teal/40"
            />
            <p className="text-xs text-gray-500 mt-1">
              Acepta los operadores de Google: <code>&quot;frase exacta&quot;</code> para
              buscarla completa, <code>-palabra</code> para excluir,{" "}
              <code>site:dominio.pe</code> para un solo medio.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Nombre en el panel <span className="text-gray-400">(opcional)</span>
              </label>
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Conciertos en Lima"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rpp-teal/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Sección <span className="text-gray-400">(opcional)</span>
              </label>
              <select
                value={newSection}
                onChange={(e) => setNewSection(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rpp-teal/40"
              >
                <option value="">Sin sección</option>
                {SECCIONES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Feeds RSS propios de este tema <span className="text-gray-400">(opcional)</span>
            </label>
            <input
              value={newFeeds}
              onChange={(e) => setNewFeeds(e.target.value)}
              placeholder="https://ticketera.pe/feed  https://sala-de-prensa.pe/rss"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rpp-teal/40"
            />
            <p className="text-xs text-gray-500 mt-1">
              Fuentes primarias que Google News no indexa o indexa tarde (ticketeras,
              agendas, salas de prensa). Suelen dar el anuncio antes que cualquier medio.
              Separa varias con espacios.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="submit"
              disabled={!newKeyword.trim() || saving}
              className="text-sm font-medium px-4 py-2 rounded-lg bg-rpp-teal text-white disabled:opacity-40 hover:opacity-90 transition"
            >
              {saving ? "Guardando…" : "Empezar a vigilar"}
            </button>
            <span className="text-xs text-gray-500">
              Los primeros resultados llegan en la próxima corrida del radar (~10 min).
            </span>
          </div>
        </form>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {sinTemas ? (
        /* Onboarding: sin temas no hay filtros ni lista que mostrar. */
        <div className="bg-white rounded-2xl border border-gray-200 px-6 py-10 text-center">
          <p className="text-base font-semibold text-gray-800">El radar está vacío</p>
          <p className="text-sm text-gray-500 mt-1 max-w-lg mx-auto">
            Agrega una keyword y el agente te avisará acá cuando se publique algo sobre
            ella, aunque no sea tendencia nacional. Revisa Google News, las ticketeras y
            los medios de la competencia en cada corrida.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-gray-500">
            <span className="font-medium text-gray-600">Ejemplos:</span>
            {['"concierto en lima"', "shakira", '"estadio nacional" -futbol'].map((ej) => (
              <code key={ej} className="rounded bg-gray-100 px-2 py-1 text-gray-700">{ej}</code>
            ))}
          </div>
          <button
            onClick={() => setFormOpen(true)}
            className="mt-5 text-sm font-medium px-4 py-2 rounded-lg bg-rpp-teal text-white hover:opacity-90 transition"
          >
            + Vigilar mi primer tema
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
          {/* Panel de filtros */}
          <div className="space-y-4 self-start">
            <FilterCard
              title="Temas"
              info="Filtra por tema vigilado. El número es cuántas publicaciones trajo en la ventana seleccionada y la barra compara su volumen con el resto. Pasa el cursor sobre un tema para pausarlo (⏸) o sacarlo del radar (×)."
            >
              <FilterItem
                label="Todos los temas"
                count={enVentana.filter((h) => pasa(h, "tema")).length}
                active={tema === TODOS}
                onClick={() => setTema(TODOS)}
              />
              {keywords.map((kw) => (
                <FilterItem
                  key={kw.id}
                  label={kw.label || kw.keyword}
                  title={kw.keyword}
                  count={temaCounts[kw.id] ?? 0}
                  barPct={((temaCounts[kw.id] ?? 0) / maxTemaCount) * 100}
                  active={tema === kw.id}
                  muted={!kw.active}
                  onClick={() => setTema(tema === kw.id ? TODOS : kw.id)}
                  action={
                    <>
                      <IconButton
                        onClick={() => toggleActive(kw)}
                        label={kw.active ? "Pausar tema" : "Reanudar tema"}
                      >
                        {kw.active ? "⏸" : "▶"}
                      </IconButton>
                      <IconButton
                        onClick={() => removeKeyword(kw)}
                        label="Sacar del radar"
                        className="hover:text-red-500"
                      >
                        ×
                      </IconButton>
                    </>
                  }
                />
              ))}
              <li className="pt-1">
                <button
                  onClick={() => { setFormOpen(true); setError(null) }}
                  className="w-full rounded-lg px-2 py-1.5 text-left text-sm font-medium text-rpp-teal transition hover:bg-teal-50"
                >
                  + Vigilar tema
                </button>
              </li>
            </FilterCard>

            {viaCounts.length > 0 && (
              <FilterCard
                title="De dónde salió"
                info="Por qué fuente llegó cada hallazgo. Google News es el motor principal; los feeds propios (ticketeras, salas de prensa) suelen dar el anuncio antes que cualquier medio; Competencia son titulares que el agente ya recolectó de otros diarios en la misma corrida."
              >
                <FilterItem
                  label="Todas las fuentes"
                  count={enVentana.filter((h) => pasa(h, "via")).length}
                  active={via === TODOS}
                  onClick={() => setVia(TODOS)}
                />
                {viaCounts.map(([v, count]) => (
                  <FilterItem
                    key={v}
                    label={viaLabel(v)}
                    count={count}
                    active={via === v}
                    onClick={() => setVia(via === v ? TODOS : v)}
                  />
                ))}
              </FilterCard>
            )}

            {medioCounts.length > 0 && (
              <FilterCard
                title="Medio"
                info="Quién publicó. Sirve para ver rápido si un tema lo está cubriendo un solo medio o ya se masificó, y para aislar a un competidor concreto."
              >
                <FilterItem
                  label="Todos los medios"
                  count={enVentana.filter((h) => pasa(h, "medio")).length}
                  active={medio === TODOS}
                  onClick={() => setMedio(TODOS)}
                />
                {medioCounts.slice(0, 12).map(([s, count]) => (
                  <FilterItem
                    key={s}
                    label={s}
                    count={count}
                    active={medio === s}
                    onClick={() => setMedio(medio === s ? TODOS : s)}
                  />
                ))}
              </FilterCard>
            )}
          </div>

          {/* Columna principal */}
          <div className="space-y-4 min-w-0">
            {/* Barra de herramientas */}
            <div className="bg-white rounded-2xl border border-gray-200 px-3 py-2.5 flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[12rem]">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400" aria-hidden>⌕</span>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar en los titulares…"
                  aria-label="Buscar en los titulares"
                  className="w-full rounded-lg border border-gray-300 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rpp-teal/40"
                />
              </div>

              <div className="flex items-center gap-1" role="group" aria-label="Ventana de tiempo">
                {WINDOWS.map((w) => (
                  <Pill
                    key={w.hours}
                    variant="solid"
                    active={windowH === w.hours}
                    onClick={() => setWindowH(w.hours)}
                  >
                    {w.label}
                  </Pill>
                ))}
                <InfoTooltip align="right">
                  Ventana por fecha de HALLAZGO, no de publicación: una nota de anteayer
                  que el radar recién encontró hoy cuenta como novedad. El servidor trae
                  7 días, así que cambiar de ventana es instantáneo.
                </InfoTooltip>
              </div>

              {nuevos > 0 && (
                <Pill variant="solid" active={onlyNew} onClick={() => setOnlyNew(!onlyNew)}>
                  Solo nuevas ({nuevos})
                </Pill>
              )}

              <select
                value={asc ? "asc" : "desc"}
                onChange={(e) => setAsc(e.target.value === "asc")}
                aria-label="Orden"
                className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-rpp-teal/40"
              >
                <option value="desc">Más reciente primero</option>
                <option value="asc">Más antiguo primero</option>
              </select>
            </div>

            {/* Chips de filtro activo */}
            {hayFiltros && (
              <div className="flex items-center gap-2 flex-wrap">
                {tema !== TODOS && (
                  <FilterChip onClear={() => setTema(TODOS)}>
                    Tema: {kwById[tema]?.label || kwById[tema]?.keyword || tema}
                  </FilterChip>
                )}
                {via !== TODOS && (
                  <FilterChip onClear={() => setVia(TODOS)}>{viaLabel(via)}</FilterChip>
                )}
                {medio !== TODOS && <FilterChip onClear={() => setMedio(TODOS)}>{medio}</FilterChip>}
                {onlyNew && <FilterChip onClear={() => setOnlyNew(false)}>Solo nuevas</FilterChip>}
                {q && <FilterChip onClear={() => setQ("")}>“{q}”</FilterChip>}
                <button
                  onClick={limpiarFiltros}
                  className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
                >
                  Limpiar filtros
                </button>
              </div>
            )}

            {/* Hallazgos, agrupados por día */}
            {!lista.length ? (
              <div className="bg-white rounded-2xl border border-gray-200 px-4 py-10 text-center">
                <p className="text-sm font-medium text-gray-700">
                  {hayFiltros
                    ? "Ningún hallazgo coincide con los filtros"
                    : `Sin publicaciones en las últimas ${ventanaLabel}`}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {hayFiltros
                    ? "Prueba quitando algún filtro o ampliando la ventana."
                    : "Un tema de nicho puede pasar un día entero sin novedades. Prueba con una ventana más amplia."}
                </p>
                {hayFiltros ? (
                  <button
                    onClick={limpiarFiltros}
                    className="mt-3 text-xs font-medium text-rpp-teal hover:underline"
                  >
                    Limpiar filtros
                  </button>
                ) : windowH !== 168 ? (
                  <button
                    onClick={() => setWindowH(168)}
                    className="mt-3 text-xs font-medium text-rpp-teal hover:underline"
                  >
                    Ver los últimos 7 días
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="space-y-4">
                {grupos.map((g) => (
                  <div key={g.key}>
                    {/* Separador de día. NO lleva `sticky`: el header amarillo del
                        layout ya es sticky en z-10, así que una cabecera pegada a
                        top-0 quedaría por debajo y se vería cortada. */}
                    <div className="mb-1 flex items-center gap-2 px-1">
                      <span className="text-xs font-bold uppercase tracking-wide text-gray-500">
                        {dayLabel(g.key)}
                      </span>
                      <span className="text-xs text-gray-400">{g.items.length}</span>
                      <span className="h-px flex-1 bg-gray-200" />
                    </div>

                    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white divide-y">
                      {g.items.map((hit) => (
                        <div key={hit.id} className="group flex items-start gap-3 px-4 py-3 transition hover:bg-gray-50">
                          <MedioAvatar source={hit.source ?? ""} url={hit.url} />

                          <div className="min-w-0 flex-1">
                            <a
                              href={hit.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium text-gray-900 hover:text-rpp-teal hover:underline"
                            >
                              {hit.title}
                            </a>
                            <div className="mt-1 flex items-center gap-x-2 gap-y-1 flex-wrap text-xs">
                              {esNuevo(hit) && (
                                <span className="rounded bg-rpp-teal px-1.5 py-0.5 text-[10px] font-bold text-white">
                                  NUEVO
                                </span>
                              )}
                              {tema === TODOS && (
                                <span className="max-w-[14rem] truncate font-medium text-rpp-teal" title={hit.keyword}>
                                  {nombreTema(hit)}
                                </span>
                              )}
                              {hit.source && <span className="text-gray-500">{hit.source}</span>}
                              {hit.published_at && (
                                <span className="text-gray-400">{hace(hit.published_at)}</span>
                              )}
                              {hit.found_via && (
                                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400">
                                  {viaLabel(hit.found_via)}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Atenuado pero visible por debajo de `lg`: en táctil
                              no hay hover y un botón oculto sería inalcanzable. */}
                          <IconButton
                            onClick={() => dismissHit(hit)}
                            label="No me interesa: sacar del panel"
                            className="opacity-50 transition group-hover:opacity-100 group-focus-within:opacity-100 hover:text-red-500 lg:opacity-0"
                          >
                            ×
                          </IconButton>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
