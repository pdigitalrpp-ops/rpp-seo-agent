import type { SupabaseClient } from "@supabase/supabase-js"
import { isAllowedEmail } from "./access"
import { HORARIOS_TEMAS, HORA_DIARIO_TEMAS, FRECUENCIA_INFO, type Frecuencia } from "./avisosTemas"
import { TZ_LIMA, limaDayOf } from "./dates"
import { PANEL, esc, recorta, horaLima, link, marco, type Correo } from "./notificaciones"
import { textoPanel } from "./correoCta"

/**
 * Avisos por correo de los temas del Radar (2026-10-19). Cada usuario elige,
 * tema por tema y desde /radar, si quiere las publicaciones nuevas al momento,
 * por horarios (08:00, 13:00, 18:00) o una vez al día (08:00). Ver
 * agent/db/watch_subscriptions.sql.
 *
 * Los envíos programados usan ventanas CERRADAS (del horario anterior a este):
 * `watch_hits.created_at` es cuándo lo encontró el radar y no cambia, así que
 * revisar la misma ventana varias veces en el margen da siempre lo mismo y no
 * hay riesgo de mandar un hallazgo en dos envíos seguidos.
 */

/** Pasadas estas horas del horario, el envío ya no sale (llegaría tarde). Igual que tendencias. */
const MARGEN_HORAS = 3
/** Un hallazgo más viejo que esto ya no es "apenas se publique". */
const INMEDIATO_MAX_HORAS = 3
/** Tope de notas por tema en un correo; el resto queda en el panel. */
const MAX_POR_TEMA = 12

type Reservar = (kind: string, refs: string[], email: string) => Promise<string[]>
type Liberar = (kind: string, refs: string[], email: string) => Promise<void>

type Suscripcion = { keyword_id: string; email: string; frequency: Frecuencia; updated_at: string }
type Tema = { id: string; keyword: string; label: string | null }
export type Hallazgo = {
  id: string
  keyword_id: string
  title: string
  url: string
  source: string | null
  published_at: string | null
  found_via: string | null
  created_at: string
}
type Grupo = { tema: Tema; hits: Hallazgo[] }
type Modo = { tipo: Frecuencia; slot?: number }

const CAMPOS_HIT = "id, keyword_id, title, url, source, published_at, found_via, created_at"

/** Instante de las `h`:00 de Lima del día `dia` (Lima es UTC-5 todo el año). */
function limaA(dia: string, h: number): Date {
  return new Date(`${dia}T${String(h).padStart(2, "0")}:00:00-05:00`)
}

/** Ventana del envío por horarios: del horario anterior (el de ayer, si es el primero) a este. */
export function ventanaHorario(hoy: string, slot: number): { desde: Date; hasta: Date } {
  const i = HORARIOS_TEMAS.indexOf(slot)
  const hasta = limaA(hoy, slot)
  const desde = i > 0
    ? limaA(hoy, HORARIOS_TEMAS[i - 1])
    : new Date(limaA(hoy, HORARIOS_TEMAS[HORARIOS_TEMAS.length - 1]).getTime() - 86400_000)
  return { desde, hasta }
}

export function ventanaDiaria(hoy: string): { desde: Date; hasta: Date } {
  const hasta = limaA(hoy, HORA_DIARIO_TEMAS)
  return { desde: new Date(hasta.getTime() - 86400_000), hasta }
}

function nombreTema(t: Tema): string {
  return t.label || t.keyword
}

function via(v: string | null): string {
  if (!v) return ""
  if (v === "google_news") return "Google News"
  if (v === "competencia") return "Competencia"
  return v.indexOf("feed:") === 0 ? v.slice(5) : v
}

/** "14:05" si es de hoy; "17/10 14:05" si no. */
function cuando(iso: string): string {
  const hoy = limaDayOf(Date.now())
  if (limaDayOf(new Date(iso)) === hoy) return horaLima(iso)
  const dia = new Date(iso).toLocaleDateString("es-PE", { timeZone: TZ_LIMA, day: "2-digit", month: "2-digit" })
  return `${dia} ${horaLima(iso)}`
}

const ts = (h: Hallazgo) => new Date(h.published_at || h.created_at).getTime() || 0

export function armarTemas(grupos: Grupo[], modo: Modo): Correo | null {
  const conHits = grupos.filter((g) => g.hits.length)
  if (!conHits.length) return null
  const total = conHits.reduce((n, g) => n + g.hits.length, 0)
  const nombres = conHits.map((g) => nombreTema(g.tema))

  const bloques = conHits.map((g) => {
    const orden = g.hits.slice().sort((a, b) => ts(b) - ts(a))
    const visibles = orden.slice(0, MAX_POR_TEMA)
    const filas = visibles.map((h) => {
      const meta = [h.source, cuando(h.published_at || h.created_at), via(h.found_via)].filter(Boolean).map((x) => esc(x)).join(" · ")
      return `<tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;vertical-align:top">
        <div style="font-size:14px;font-weight:600">${link(h.url, recorta(h.title, 160), "#111827")}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:2px">${meta}</div>
      </td></tr>`
    }).join("")
    const resto = orden.length - visibles.length
    return `
      <h2 style="margin:20px 0 4px;font-size:15px;border-left:4px solid #0D9488;padding-left:8px">${esc(nombreTema(g.tema))}
        <span style="color:#6b7280;font-weight:400;font-size:13px">(${g.hits.length})</span></h2>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${filas}</table>
      ${resto > 0 ? `<p style="margin:6px 0 0;font-size:12px"><a href="${PANEL}/radar" style="color:#0D9488">y ${resto} más en el panel →</a></p>` : ""}`
  }).join("")

  const plural = total === 1 ? "publicación nueva" : "publicaciones nuevas"
  const hora = modo.slot !== undefined ? `${String(modo.slot).padStart(2, "0")}:00` : ""
  let titulo: string
  let subtitulo: string
  let subject: string
  if (modo.tipo === "inmediato") {
    titulo = "Radar de temas"
    subtitulo = `RPP Noticias · ${total} ${plural} sobre tus temas`
    subject = total === 1
      ? `🔔 ${recorta(nombres[0], 40)}: ${recorta(conHits[0].hits[0].title, 90)}`
      : `🔔 ${total} ${plural}: ${recorta(nombres.join(", "), 90)}`
  } else if (modo.tipo === "horarios") {
    const i = HORARIOS_TEMAS.indexOf(modo.slot ?? -1)
    const desde = i > 0 ? `desde las ${String(HORARIOS_TEMAS[i - 1]).padStart(2, "0")}:00` : "desde el cierre de ayer"
    titulo = `Radar de temas · ${hora}`
    subtitulo = `RPP Noticias · lo publicado ${desde}`
    subject = `🗞️ Radar de temas ${hora}: ${total} ${plural} (${recorta(nombres.join(", "), 70)})`
  } else {
    titulo = "Radar de temas · resumen del día"
    subtitulo = "RPP Noticias · lo publicado en las últimas 24 horas"
    subject = `🗞️ Radar de temas del día: ${total} ${plural} (${recorta(nombres.join(", "), 70)})`
  }

  const pie = `Recibes este correo porque sigues ${conHits.length === 1 ? "este tema" : "estos temas"} en el Radar ` +
    `(${esc(FRECUENCIA_INFO[modo.tipo].corto)}). Para cambiar la frecuencia o dejar de recibirlo, usa la campana 🔔 del tema en ` +
    `<a href="${PANEL}/radar" style="color:#0D9488">Radar de temas</a>.`

  const text = conHits.map((g) =>
    `${nombreTema(g.tema).toUpperCase()} (${g.hits.length})\n` +
    g.hits.slice().sort((a, b) => ts(b) - ts(a)).slice(0, MAX_POR_TEMA)
      .map((h) => `- ${h.title}${h.source ? ` (${h.source})` : ""}\n  ${h.url}`).join("\n")
  ).join("\n\n") + `\n\n${textoPanel("temas")}`

  return { subject, html: marco(titulo, subtitulo, bloques, pie, "temas"), text }
}

/** Agrupa los hallazgos de una persona por tema, en el orden en que se suscribió. */
function agrupar(subs: Suscripcion[], temas: Record<string, Tema>, hits: Hallazgo[], filtro?: (s: Suscripcion, h: Hallazgo) => boolean): Grupo[] {
  return subs.filter((s) => temas[s.keyword_id]).map((s) => ({
    tema: temas[s.keyword_id],
    hits: hits.filter((h) => h.keyword_id === s.keyword_id && (!filtro || filtro(s, h))),
  }))
}

/**
 * Envía los avisos que tocan en esta pasada. Lo llama /api/notificar cada 5 min.
 * Devuelve cuántos correos salieron y cuántos fallaron.
 */
export async function enviarTemas(
  db: SupabaseClient,
  ctx: {
    hoy: string; hora: number; reservar: Reservar; liberar: Liberar
    enviar: (para: string, c: Correo) => Promise<void>
    /** false = se acabó el presupuesto de la pasada: lo que falta sale en la siguiente. */
    hayTiempo: () => boolean
  },
): Promise<{ enviados: number; fallos: number; pendientes: boolean }> {
  const out = { enviados: 0, fallos: 0, pendientes: false }
  const { data: s, error } = await db.from("watch_subscriptions").select("keyword_id, email, frequency, updated_at")
  if (error) { console.error("[notificar] no se pudo leer avisos de temas:", error.message); return out }
  const subs = ((s ?? []) as Suscripcion[]).filter((x) => isAllowedEmail(x.email))
  if (!subs.length) return out

  const ids = Array.from(new Set(subs.map((x) => x.keyword_id)))
  const { data: t } = await db.from("watch_keywords").select("id, keyword, label").in("id", ids)
  const temas: Record<string, Tema> = {}
  ;((t ?? []) as Tema[]).forEach((x) => { temas[x.id] = x })

  async function despachar(email: string, kind: string, refs: string[], armar: (mias: string[]) => Correo | null) {
    if (!ctx.hayTiempo()) { out.pendientes = true; return }
    const mias = await ctx.reservar(kind, refs, email)
    if (!mias.length) return
    const correo = armar(mias)
    if (!correo) { await ctx.liberar(kind, mias, email); return }
    try {
      await ctx.enviar(email, correo)
      out.enviados++
    } catch (e) {
      console.error(`[notificar] falló el aviso de temas (${kind}):`, e instanceof Error ? e.message : e)
      await ctx.liberar(kind, mias, email)
      out.fallos++
    }
  }

  const porPersona = (lista: Suscripcion[]) => {
    const m: Record<string, Suscripcion[]> = {}
    lista.forEach((x) => { (m[x.email] = m[x.email] ?? []).push(x) })
    return m
  }

  async function leerHits(keywordIds: string[], desde: Date, hasta?: Date): Promise<Hallazgo[]> {
    let q = db.from("watch_hits").select(CAMPOS_HIT).in("keyword_id", keywordIds)
      .eq("dismissed", false).gte("created_at", desde.toISOString())
    if (hasta) q = q.lt("created_at", hasta.toISOString())
    const { data, error: e } = await q.order("created_at", { ascending: false }).limit(1000)
    if (e) { console.error("[notificar] no se pudo leer hallazgos:", e.message); return [] }
    return (data ?? []) as Hallazgo[]
  }

  // 1. Al momento: cada hallazgo se reserva por separado, así lo que llegue en
  //    la próxima corrida del radar sale en el próximo correo y nada se repite.
  const inmediatas = subs.filter((x) => x.frequency === "inmediato")
  if (inmediatas.length) {
    const hits = await leerHits(Array.from(new Set(inmediatas.map((x) => x.keyword_id))), new Date(Date.now() - INMEDIATO_MAX_HORAS * 3600_000))
    const personas = porPersona(inmediatas)
    for (const email of Object.keys(personas)) {
      const grupos = agrupar(personas[email], temas, hits, (sub, h) => Date.parse(h.created_at) >= Date.parse(sub.updated_at))
      const refs = grupos.reduce<string[]>((acc, g) => acc.concat(g.hits.map((h) => h.id)), [])
      if (!refs.length) continue
      await despachar(email, "tema", refs, (mias) =>
        armarTemas(grupos.map((g) => ({ ...g, hits: g.hits.filter((h) => mias.indexOf(h.id) >= 0) })), { tipo: "inmediato" }))
    }
  }

  // 2. Por horarios: 08:00, 13:00 y 18:00, dentro del margen.
  const slot = HORARIOS_TEMAS.filter((x) => x <= ctx.hora && ctx.hora < x + MARGEN_HORAS).pop()
  const programadas = subs.filter((x) => x.frequency === "horarios")
  if (slot !== undefined && programadas.length) {
    const { desde, hasta } = ventanaHorario(ctx.hoy, slot)
    const hits = await leerHits(Array.from(new Set(programadas.map((x) => x.keyword_id))), desde, hasta)
    const personas = porPersona(programadas)
    for (const email of Object.keys(personas)) {
      const correo = armarTemas(agrupar(personas[email], temas, hits), { tipo: "horarios", slot })
      if (!correo) continue  // sin novedades no hay correo
      await despachar(email, "tema_horario", [`${ctx.hoy}@${slot}`], () => correo)
    }
  }

  // 3. Uno al día, a las 08:00.
  const diarias = subs.filter((x) => x.frequency === "diario")
  if (diarias.length && ctx.hora >= HORA_DIARIO_TEMAS && ctx.hora < HORA_DIARIO_TEMAS + MARGEN_HORAS) {
    const { desde, hasta } = ventanaDiaria(ctx.hoy)
    const hits = await leerHits(Array.from(new Set(diarias.map((x) => x.keyword_id))), desde, hasta)
    const personas = porPersona(diarias)
    for (const email of Object.keys(personas)) {
      const correo = armarTemas(agrupar(personas[email], temas, hits), { tipo: "diario" })
      if (!correo) continue
      await despachar(email, "tema_diario", [ctx.hoy], () => correo)
    }
  }

  return out
}

/**
 * Correo de prueba: lo último que trajeron (24 h) los temas que sigue `para`,
 * o solo `keywordId` si se indica. No toca el registro de envíos.
 */
export async function armarPruebaTemas(db: SupabaseClient, para: string, keywordId?: string | null): Promise<Correo | null> {
  let ids: string[]
  if (keywordId) ids = [keywordId]
  else {
    const { data } = await db.from("watch_subscriptions").select("keyword_id").eq("email", para)
    ids = ((data ?? []) as { keyword_id: string }[]).map((x) => x.keyword_id)
  }
  if (!ids.length) return null
  const [{ data: t }, { data: h }] = await Promise.all([
    db.from("watch_keywords").select("id, keyword, label").in("id", ids),
    db.from("watch_hits").select(CAMPOS_HIT).in("keyword_id", ids).eq("dismissed", false)
      .gte("created_at", new Date(Date.now() - 86400_000).toISOString())
      .order("created_at", { ascending: false }).limit(300),
  ])
  const hits = (h ?? []) as Hallazgo[]
  const grupos = ((t ?? []) as Tema[]).map((tema) => ({ tema, hits: hits.filter((x) => x.keyword_id === tema.id).slice(0, 5) }))
  return armarTemas(grupos, { tipo: "inmediato" })
}
