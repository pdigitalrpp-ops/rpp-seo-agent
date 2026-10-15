import type { SupabaseClient } from "@supabase/supabase-js"
import { TZ_LIMA } from "./dates"
import { isRealArticle, sectionGroup, sectionOf } from "./articleFilter"
import type { Correo } from "./notificaciones"

/**
 * Correo de TRÁFICO DEL DÍA ANTERIOR por sección (2026-10-14): para editores
 * que solo necesitan su sección (el primero, jpriale con Economía). Sale una
 * vez al día cuando termina el benchmark de la mañana, igual que el resumen.
 *
 * FECHAS: el benchmark del día X guarda el tráfico del día COMPLETO X-1. La
 * fila `date = hoy` es "ayer"; `date = ayer` es "anteayer".
 *
 * De dónde sale cada número:
 *  - total de la sección: own_traffic_sections (exacto, por sección de Marfeel);
 *  - canales: own_traffic_channels de las notas de la sección (top 500 pares
 *    nota × canal del sitio, así que es una muestra grande, no el total);
 *  - notas: own_traffic (top 500 notas del sitio).
 * La sección se cruza normalizando: Marfeel dice "Economía", la URL /economia/.
 * Deportes es un grupo (fútbol, vóley, tenis...), igual que en /trafico.
 */

const PANEL = "https://rpp-seo-agent.vercel.app"

type Fila = Record<string, any>

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
const num = (n: unknown) => Math.round(Number(n) || 0).toLocaleString("es-PE")
const recorta = (s: unknown, max: number) => {
  const t = String(s ?? "").trim()
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t
}
function diaAnterior(iso: string): string {
  const d = new Date(iso + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
function fechaLarga(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("es-PE", {
    timeZone: TZ_LIMA, weekday: "long", day: "numeric", month: "long",
  })
}
function delta(actual: number, previo: number | null): string {
  if (!previo) return ""
  const pct = ((actual - previo) / previo) * 100
  const color = pct >= 0 ? "#059669" : "#DC2626"
  return ` <span style="font-size:13px;color:${color};font-weight:700">${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}% vs el día anterior (${num(previo)})</span>`
}

/** Datos del correo; se leen una sola vez y sirven para todos los destinatarios. */
export async function leerTrafico(db: SupabaseClient, hoy: string) {
  const ayer = diaAnterior(hoy)
  const [secciones, totales, notas, canales] = await Promise.all([
    db.from("own_traffic_sections").select("date, section, page_views").in("date", [hoy, ayer]).limit(1000),
    db.from("own_traffic_totals").select("date, page_views").in("date", [hoy, ayer]),
    db.from("own_traffic").select("page_path, title, sessions").eq("date", hoy)
      .order("sessions", { ascending: false }).limit(1000),
    db.from("own_traffic_channels").select("page_path, channel, pageviews").eq("date", hoy).limit(1000),
  ])
  const err = secciones.error || totales.error || notas.error || canales.error
  if (err) throw new Error(err.message)
  if (!(secciones.data ?? []).some((r: Fila) => r.date === hoy)) return null   // aún no hay dato de ayer
  return { hoy, ayer, secciones: secciones.data ?? [], totales: totales.data ?? [], notas: notas.data ?? [], canales: canales.data ?? [] }
}

export function armarTrafico(datos: NonNullable<Awaited<ReturnType<typeof leerTrafico>>>, seccionesPedidas: string[]): Correo | null {
  const { hoy, ayer } = datos
  const totalSitio = datos.totales.filter((r: Fila) => r.date === hoy)[0]?.page_views ?? 0

  const bloques: string[] = []
  const texto: string[] = []
  const titulos: string[] = []
  for (const clave of seccionesPedidas) {
    const de = (fecha: string) => datos.secciones
      .filter((r: Fila) => r.date === fecha && sectionGroup(r.section) === clave)
      .reduce((s: number, r: Fila) => s + (r.page_views ?? 0), 0)
    const pv = de(hoy)
    const previo = de(ayer)
    const nombre = clave === "deportes" ? "Deportes" : datos.secciones.filter((r: Fila) => sectionGroup(r.section) === clave)[0]?.section ?? clave
    if (!pv) continue
    titulos.push(String(nombre))

    const enSeccion = (url: string) => sectionGroup(sectionOf(url)) === clave
    const notas = datos.notas.filter((r: Fila) => isRealArticle(r.page_path) && enSeccion(r.page_path)).slice(0, 10)
    const porCanal: Record<string, number> = {}
    datos.canales.filter((r: Fila) => enSeccion(r.page_path)).forEach((r: Fila) => {
      const c = r.channel || "otros"
      porCanal[c] = (porCanal[c] ?? 0) + (r.pageviews ?? 0)
    })
    const canalesOrden = Object.keys(porCanal).sort((a, b) => porCanal[b] - porCanal[a])
    const sumaCanales = canalesOrden.reduce((s, c) => s + porCanal[c], 0)

    bloques.push(`
      <h2 style="margin:22px 0 8px;font-size:16px;border-left:4px solid #0D9488;padding-left:8px">${esc(nombre)}</h2>
      <p style="margin:0"><span style="font-size:26px;font-weight:800">${num(pv)}</span>
        <span style="color:#6b7280;font-size:12px">páginas vistas</span>${delta(pv, previo || null)}</p>
      ${totalSitio ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280">${((pv / totalSitio) * 100).toFixed(1)}% del tráfico de todo el sitio (${num(totalSitio)})</p>` : ""}
      ${canalesOrden.length ? `
        <p style="margin:12px 0 4px;font-size:13px;font-weight:700">De dónde llegaron (notas de la sección)</p>
        <p style="margin:0;font-size:13px">${canalesOrden.slice(0, 6).map((c) =>
          `${esc(c)} <b>${((porCanal[c] / sumaCanales) * 100).toFixed(0)}%</b>`).join(" · ")}</p>` : ""}
      ${notas.length ? `
        <p style="margin:14px 0 4px;font-size:13px;font-weight:700">Las ${notas.length} notas más leídas</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${
          notas.map((r: Fila, i: number) => `<tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:14px">
            <b>${i + 1}.</b> <a href="${esc(r.page_path)}" style="color:#111827;text-decoration:none">${esc(recorta(r.title || r.page_path, 110))}</a>
            <span style="color:#6b7280;font-size:12px">${num(r.sessions)} vistas</span></td></tr>`).join("")
        }</table>` : ""}`)
    texto.push(`${String(nombre).toUpperCase()}: ${num(pv)} páginas vistas` +
      (previo ? ` (día anterior ${num(previo)})` : "") + "\n" +
      notas.map((r: Fila, i: number) => `${i + 1}. ${r.title || r.page_path} (${num(r.sessions)})`).join("\n"))
  }
  if (!bloques.length) return null

  return {
    subject: `Tráfico de ayer en ${titulos.join(", ")}, ${fechaLarga(ayer)}`,
    html: `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#111827;font-size:14px;line-height:1.45">
  <div style="background:#F5D414;padding:16px 20px;border-radius:12px 12px 0 0">
    <div style="font-weight:800;font-size:18px">Tráfico de ayer</div>
    <div style="font-size:12px;color:#374151;margin-top:2px">RPP Noticias · ${esc(fechaLarga(ayer))} completo</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:4px 20px 18px;border-radius:0 0 12px 12px">
    ${bloques.join("")}
    <p style="margin:22px 0 0;padding-top:12px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">
      Fuente: Marfeel. El total es exacto; canales y notas salen del top 500 del sitio.
      <a href="${PANEL}/trafico" style="color:#0D9488">Abrir Tráfico en el panel</a>
    </p>
  </div>
</div>`,
    text: texto.join("\n\n") + `\n\nPanel: ${PANEL}/trafico`,
  }
}
