"use client"

import { useMemo, useState, type FormEvent } from "react"
import { supabase } from "@/lib/supabase"
import { InfoTooltip } from "@/components/ui/InfoTooltip"

/**
 * Vigilancia de temas — las "Google Alerts" propias del equipo.
 *
 * Las alertas de arriba nacen del feed de Google Trends: solo el top ~10
 * nacional de búsquedas. Este bloque cubre el otro eje: temas que el equipo
 * define a mano y sobre los que quiere enterarse apenas alguien publique algo,
 * por poco volumen de búsqueda que tengan (un concierto, una empresa, un
 * vocero).
 *
 * La lista se administra desde acá con la anon key (RLS abierto, mismo criterio
 * MVP que audit_check_state); el agente la lee en cada corrida del radar
 * (collectors/watchlist.py) y escribe los hallazgos en watch_hits.
 */

export type WatchKeyword = {
  id: string
  keyword: string
  label: string | null
  active: boolean
  section: string | null
  extra_feeds: string[] | null
}

export type WatchHit = {
  id: string
  keyword_id: string | null
  keyword: string
  title: string
  url: string
  source: string | null
  published_at: string | null
  found_via: string | null
  created_at: string
}

// Misma taxonomía que KNOWN_SECTIONS_FALLBACK del agente (config.py).
const SECCIONES = [
  "politica", "economia", "deportes", "mundo", "actualidad",
  "lima", "peru", "tecnologia", "salud", "entretenimiento",
  "cine-series", "musica", "viral",
]

const VIA_LABEL: Record<string, string> = {
  google_news: "Google News",
  competencia: "Competencia",
}

const TODAS = "__todas__"

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

function viaLabel(via: string | null): string {
  if (!via) return ""
  if (VIA_LABEL[via]) return VIA_LABEL[via]
  return via.indexOf("feed:") === 0 ? via.slice(5) : via
}

export default function VigilanciaPanel({
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
  const [selected, setSelected] = useState<string>(TODAS)
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

  const countByKeyword = useMemo(() => {
    const acc: Record<string, number> = {}
    hits.forEach((h) => {
      if (h.keyword_id) acc[h.keyword_id] = (acc[h.keyword_id] ?? 0) + 1
    })
    return acc
  }, [hits])

  const visibles = useMemo(
    () => (selected === TODAS ? hits : hits.filter((h) => h.keyword_id === selected)),
    [hits, selected]
  )

  const nuevos = useMemo(
    () =>
      newCutoff === null
        ? 0
        : hits.filter((h) => new Date(h.created_at).getTime() >= newCutoff).length,
    [hits, newCutoff]
  )

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
          ? "Ese tema ya está en la lista."
          : "No se pudo guardar. Revisa la conexión e intenta de nuevo."
      )
      return
    }
    setKeywords((k) => k.concat(data as WatchKeyword))
    setNewKeyword("")
    setNewLabel("")
    setNewSection("")
    setNewFeeds("")
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
    const label = kw.label || kw.keyword
    if (!window.confirm(`¿Dejar de vigilar «${label}»? Se borran también sus hallazgos.`)) return
    const backupKeywords = keywords
    const backupHits = hits
    setKeywords((list) => list.filter((k) => k.id !== kw.id))
    setHits((list) => list.filter((h) => h.keyword_id !== kw.id))
    if (selected === kw.id) setSelected(TODAS)
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

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-1.5">
          Vigilancia de temas
          <InfoTooltip align="left">
            Tus propias alertas por keyword, al estilo de Google Alerts. Las alertas de
            arriba salen de lo más buscado del país (top ~10 del día), así que un tema de
            nicho —un concierto, una empresa, un vocero— nunca aparece ahí. Acá defines qué
            vigilar y el agente avisa cuando alguien publica algo al respecto: busca en
            Google News, en los feeds RSS que le indiques y en los medios de la competencia
            que ya recolecta. Se revisa en cada corrida del radar.
          </InfoTooltip>
          {nuevos > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded bg-rpp-teal text-white">
              {nuevos} nuevo(s)
            </span>
          )}
        </h2>
        <button
          onClick={() => { setFormOpen(!formOpen); setError(null) }}
          className="text-sm font-medium px-3 py-1.5 rounded-lg bg-rpp-teal text-white hover:opacity-90 transition"
        >
          {formOpen ? "Cancelar" : "+ Vigilar tema"}
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {formOpen && (
          <form onSubmit={addKeyword} className="px-4 py-4 border-b bg-gray-50 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Qué vigilar
              </label>
              <input
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                placeholder='concierto en lima'
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
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={!newKeyword.trim() || saving}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-rpp-teal text-white disabled:opacity-40 hover:opacity-90 transition"
              >
                {saving ? "Guardando…" : "Empezar a vigilar"}
              </button>
              <span className="text-xs text-gray-500">
                Los primeros resultados llegan en la próxima corrida del radar.
              </span>
            </div>
          </form>
        )}

        {error && (
          <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Temas vigilados */}
        {keywords.length > 0 && (
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setSelected(TODAS)}
              className={`text-xs px-2.5 py-1 rounded-full border transition ${
                selected === TODAS
                  ? "bg-rpp-teal text-white border-rpp-teal font-semibold"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-100"
              }`}
            >
              Todos ({hits.length})
            </button>
            {keywords.map((kw) => (
              <span
                key={kw.id}
                className={`inline-flex items-center gap-1 rounded-full border pl-2.5 pr-1 py-0.5 text-xs transition ${
                  selected === kw.id
                    ? "bg-rpp-teal text-white border-rpp-teal font-semibold"
                    : kw.active
                    ? "bg-white text-gray-700 border-gray-300"
                    : "bg-gray-100 text-gray-400 border-gray-200 line-through"
                }`}
              >
                <button
                  onClick={() => setSelected(selected === kw.id ? TODAS : kw.id)}
                  className="max-w-[16rem] truncate"
                  title={kw.keyword}
                >
                  {kw.label || kw.keyword}{" "}
                  <span className={selected === kw.id ? "opacity-80" : "text-gray-400"}>
                    ({countByKeyword[kw.id] ?? 0})
                  </span>
                </button>
                <button
                  onClick={() => toggleActive(kw)}
                  aria-label={kw.active ? "Pausar tema" : "Reanudar tema"}
                  title={kw.active ? "Pausar" : "Reanudar"}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-black/10 leading-none"
                >
                  {kw.active ? "⏸" : "▶"}
                </button>
                <button
                  onClick={() => removeKeyword(kw)}
                  aria-label="Dejar de vigilar"
                  title="Dejar de vigilar"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-black/10 leading-none"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Hallazgos */}
        {!keywords.length ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-gray-600 font-medium">Todavía no vigilas ningún tema</p>
            <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
              Agrega una keyword y el agente te avisará acá cuando se publique algo sobre
              ella en la web, aunque no sea tendencia nacional.
            </p>
          </div>
        ) : !visibles.length ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500">
            Sin publicaciones nuevas sobre {selected === TODAS ? "los temas vigilados" : "este tema"}.
          </div>
        ) : (
          <div className="divide-y max-h-[32rem] overflow-y-auto">
            {visibles.map((hit) => (
              <div key={hit.id} className="px-4 py-3 group">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {esNuevo(hit) && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rpp-teal text-white">
                          NUEVO
                        </span>
                      )}
                      {selected === TODAS && (
                        <span className="text-xs text-rpp-teal font-medium truncate max-w-[14rem]">
                          {hit.keyword}
                        </span>
                      )}
                      {hit.source && <span className="text-xs text-gray-500">{hit.source}</span>}
                      {hit.published_at && (
                        <span className="text-xs text-gray-400">{hace(hit.published_at)}</span>
                      )}
                      {hit.found_via && (
                        <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                          {viaLabel(hit.found_via)}
                        </span>
                      )}
                    </div>
                    <a
                      href={hit.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-gray-900 hover:text-rpp-teal hover:underline"
                    >
                      {hit.title}
                    </a>
                  </div>
                  <button
                    onClick={() => dismissHit(hit)}
                    aria-label="Descartar hallazgo"
                    title="No me interesa: sacar del panel"
                    className="shrink-0 text-gray-300 hover:text-red-500 transition text-sm leading-none mt-0.5"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
