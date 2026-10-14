import type { SupabaseClient } from "@supabase/supabase-js"
import { TZ_LIMA } from "./dates"
import type { Correo } from "./notificaciones"

/**
 * Correo de TENDENCIAS (2026-10-14): pedido de usuarios del panel que usan la
 * pestaña Tendencias. Tres envíos fijos al día (ENVIOS_TENDENCIAS, hora de
 * Lima), aparte del resumen matutino y de las alertas.
 *
 * Sale de `trend_sightings`, que el agente llena en cada corrida del radar
 * (agent/analyzers/trend_digest.py): cada tendencia vista hoy, cuándo apareció,
 * su pico de volumen, su categoría (decidida por el LLM con la noticia que la
 * explica) y si RPP ya tiene nota.
 */

export const ENVIOS_TENDENCIAS = [8, 13, 18]
/** Pasadas estas horas del horario, el envío ya no sale (llegaría tarde). */
export const MARGEN_ENVIO_HORAS = 3

const PANEL = "https://rpp-seo-agent.vercel.app"

/** Copia de TREND_EMAIL_CATEGORIES de agent/config.py: mantener AMBAS. El orden es el del correo. */
export const CATEGORIAS_TENDENCIAS: [string, string][] = [
  ["economia", "Economía y finanzas personales"],
  ["politica", "Política"],
  ["actualidad", "Actualidad y policiales"],
  ["clima", "Clima y desastres"],
  ["deportes", "Deportes"],
  ["entretenimiento", "Entretenimiento"],
  ["mundo", "Mundo"],
  ["tecnologia", "Tecnología"],
  ["salud", "Salud"],
  ["otros", "Otros"],
]

/** Una tendencia que no aparece en una corrida reciente ya no está "ahora". */
const VIGENTE_MIN = 25

type Fila = {
  keyword: string
  first_seen: string
  last_seen: string
  best_rank: number | null
  peak_volume: number | null
  categoria: string | null
  why_trending: string | null
  news: { title?: string; source?: string; url?: string }[] | null
  rpp_url: string | null
  rpp_title: string | null
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function recorta(s: unknown, max: number): string {
  const t = String(s ?? "").trim()
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t
}

function volumen(n: number | null): string {
  if (!n) return ""
  if (n >= 1000) return `${Math.round(n / 1000).toLocaleString("es-PE")} mil+ búsquedas`
  return `${n}+ búsquedas`
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-PE", { timeZone: TZ_LIMA, hour: "2-digit", minute: "2-digit", hour12: false })
}

function enlace(url: unknown, label: string): string {
  const u = String(url ?? "")
  if (u.indexOf("http://") !== 0 && u.indexOf("https://") !== 0) return esc(label)
  return `<a href="${esc(u)}" style="color:#0D9488;text-decoration:none">${esc(label)}</a>`
}

/**
 * Instante (ISO) desde el que una tendencia cuenta como NUEVA en el envío de
 * `slot`: la hora del envío anterior, o el inicio del día de Lima en el primero.
 */
export function desdeParaEnvio(hoy: string, slot: number): string {
  const i = ENVIOS_TENDENCIAS.indexOf(slot)
  const h = i > 0 ? ENVIOS_TENDENCIAS[i - 1] : 0
  // Lima es UTC-5 todo el año (sin horario de verano).
  return new Date(`${hoy}T${String(h).padStart(2, "0")}:00:00-05:00`).toISOString()
}

/** Filas de hoy, o null si el agente todavía no registró tendencias. */
export async function leerTendencias(db: SupabaseClient, hoy: string): Promise<Fila[] | null> {
  const { data, error } = await db.from("trend_sightings")
    .select("keyword, first_seen, last_seen, best_rank, peak_volume, categoria, why_trending, news, rpp_url, rpp_title")
    .eq("date", hoy)
  if (error) throw new Error(error.message)
  return data && data.length ? (data as Fila[]) : null
}

export function armarTendencias(
  filas: Fila[], slot: number, desde: string, categorias: string[] | null,
): Correo | null {
  const ultima = filas.reduce((m, f) => Math.max(m, new Date(f.last_seen).getTime()), 0)
  const desdeMs = new Date(desde).getTime()
  const permitidas = categorias && categorias.length ? categorias : null
  const delCorreo = filas.filter((f) => !permitidas || permitidas.indexOf(f.categoria ?? "otros") >= 0)
  if (!delCorreo.length) return null

  const vigentes = delCorreo.filter((f) => ultima - new Date(f.last_seen).getTime() <= VIGENTE_MIN * 60_000)
  const bajaron = delCorreo.filter((f) => vigentes.indexOf(f) < 0)
  const esNueva = (f: Fila) => new Date(f.first_seen).getTime() >= desdeMs
  const nuevas = vigentes.filter(esNueva).length
  const sinNota = vigentes.filter((f) => !f.rpp_url).length
  const desdeTxt = slot === ENVIOS_TENDENCIAS[0] ? "hoy" : `desde las ${String(ENVIOS_TENDENCIAS[ENVIOS_TENDENCIAS.indexOf(slot) - 1]).padStart(2, "0")}:00`

  const ordenar = (a: Fila, b: Fila) => (b.peak_volume ?? 0) - (a.peak_volume ?? 0) || (a.best_rank ?? 99) - (b.best_rank ?? 99)

  const item = (f: Fila) => {
    const nota = (f.news ?? []).filter((n) => n && n.url)[0]
    const rpp = f.rpp_url
      ? `<span style="color:#059669;font-weight:700">✓ RPP:</span> ${enlace(f.rpp_url, recorta(f.rpp_title || "ver nota", 90))}`
      : `<span style="color:#B45309;font-weight:700">⚠ Sin nota en RPP</span>`
    return `
      <tr><td style="padding:9px 0;border-bottom:1px solid #f3f4f6;vertical-align:top">
        <div><b style="font-size:15px">${esc(f.keyword)}</b>
          ${esNueva(f) ? `<span style="font-size:10px;font-weight:700;color:#fff;background:#0D9488;border-radius:4px;padding:1px 5px;margin-left:4px">NUEVA</span>` : ""}
          <span style="color:#6b7280;font-size:12px"> ${esc(volumen(f.peak_volume))} · desde ${hora(f.first_seen)}</span></div>
        ${f.why_trending ? `<div style="font-size:13px;color:#374151;margin-top:2px">${esc(recorta(f.why_trending, 230))}</div>` : ""}
        <div style="font-size:12px;margin-top:3px">${rpp}${nota ? ` · ${enlace(nota.url, "noticia de referencia")}` : ""}</div>
      </td></tr>`
  }

  const bloques = CATEGORIAS_TENDENCIAS.map(([clave, nombre]) => {
    const deLa = vigentes.filter((f) => (f.categoria ?? "otros") === clave).sort(ordenar)
    if (!deLa.length) return ""
    return `
      <h2 style="margin:20px 0 4px;font-size:14px;border-left:4px solid #0D9488;padding-left:8px">${esc(nombre)} <span style="color:#6b7280;font-weight:400">(${deLa.length})</span></h2>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${deLa.map(item).join("")}</table>`
  }).join("")

  const resto = bajaron.sort(ordenar).slice(0, 15)
  const bloqueResto = resto.length
    ? `<h2 style="margin:22px 0 4px;font-size:14px;color:#6b7280">Fueron tendencia hoy y ya bajaron</h2>
       <p style="margin:0;font-size:13px;color:#374151">${resto.map((f) =>
         `${esc(f.keyword)}${f.rpp_url ? "" : ' <span style="color:#B45309">⚠</span>'}`).join(" · ")}</p>`
    : ""

  const resumen = `<p style="margin:14px 0 0;font-size:13px">
    <b>${vigentes.length}</b> en tendencia ahora · <b>${nuevas}</b> nuevas ${esc(desdeTxt)} ·
    <b style="color:#B45309">${sinNota}</b> sin nota en RPP</p>`

  const horaSlot = `${String(slot).padStart(2, "0")}:00`
  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#111827;font-size:14px;line-height:1.45">
  <div style="background:#F5D414;padding:16px 20px;border-radius:12px 12px 0 0">
    <div style="font-weight:800;font-size:18px">Tendencias en Google Perú · ${horaSlot}</div>
    <div style="font-size:12px;color:#374151;margin-top:2px">RPP Noticias · lo más buscado ahora, por tema</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:4px 20px 18px;border-radius:0 0 12px 12px">
    ${resumen}
    ${bloques || '<p style="margin:16px 0 0">No hay tendencias vigentes de tus categorías en este momento.</p>'}
    ${bloqueResto}
    <p style="margin:22px 0 0;padding-top:12px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">
      Google publica el volumen en escalones ("2 mil+"). La explicación la escribe el modelo a partir de las noticias:
      verificar antes de publicar. <a href="${PANEL}/trends" style="color:#0D9488">Abrir Tendencias en el panel</a>
    </p>
  </div>
</div>`

  const top = vigentes.slice().sort(ordenar).slice(0, 3).map((f) => f.keyword).join(", ")
  const text = CATEGORIAS_TENDENCIAS.map(([clave, nombre]) => {
    const deLa = vigentes.filter((f) => (f.categoria ?? "otros") === clave).sort(ordenar)
    return deLa.length ? `${nombre.toUpperCase()}\n` + deLa.map((f) =>
      `- ${f.keyword}${esNueva(f) ? " (NUEVA)" : ""} · ${volumen(f.peak_volume)} · ${f.rpp_url ? "RPP ya tiene nota" : "SIN NOTA EN RPP"}\n  ${f.why_trending ?? ""}`).join("\n") : ""
  }).filter(Boolean).join("\n\n") + `\n\nPanel: ${PANEL}/trends`

  return {
    subject: `📈 Tendencias ${horaSlot}: ${recorta(top, 80)}${nuevas ? ` (${nuevas} nuevas)` : ""}`,
    html,
    text,
  }
}
