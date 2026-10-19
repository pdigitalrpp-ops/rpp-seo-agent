import type { SupabaseClient } from "@supabase/supabase-js"
import { isRealArticle } from "./articleFilter"
import { TZ_LIMA } from "./dates"

/**
 * Contenido de los correos del agente: resumen matutino y alertas.
 *
 * POR QUÉ SE ENVÍA DESDE AQUÍ Y NO DESDE EL AGENTE. Las credenciales de Gmail
 * ya viven en Vercel (las usa el código de acceso) y el panel ya lee todo de
 * Supabase. Mandarlo desde Python habría obligado a duplicar el secreto en
 * GitHub y a armar el HTML en otro lenguaje. El agente no cambia: escribe en
 * la base como siempre y /api/notificar (llamada por pg_cron) decide qué hay
 * nuevo para enviar.
 *
 * El correo es HTML con estilos EN LÍNEA y tablas simples: Outlook (que es lo
 * que usa la redacción) ignora <style>, flexbox y grid.
 */

export const PANEL = "https://rpp-seo-agent.vercel.app"

export type Correo = { subject: string; html: string; text: string }

type Fila = Record<string, any>

// ---------------------------------------------------------------------------
// Utilidades de formato
// ---------------------------------------------------------------------------

export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function num(n: unknown): string {
  return Math.round(Number(n) || 0).toLocaleString("es-PE")
}

export function recorta(s: unknown, max: number): string {
  const t = String(s ?? "").trim()
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t
}

function fechaLarga(iso: string): string {
  // Mediodía UTC: así el día no se corre al pasarlo a la zona de Lima.
  return new Date(iso + "T12:00:00Z").toLocaleDateString("es-PE", {
    timeZone: TZ_LIMA, weekday: "long", day: "numeric", month: "long",
  })
}

export function horaLima(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-PE", {
    timeZone: TZ_LIMA, hour: "2-digit", minute: "2-digit", hour12: false,
  })
}

function diaAnterior(iso: string): string {
  const d = new Date(iso + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** Enlace seguro: solo http(s); cualquier otra cosa se queda en texto. */
export function link(url: unknown, label: string, color = "#0D9488"): string {
  const u = String(url ?? "")
  if (u.indexOf("http://") !== 0 && u.indexOf("https://") !== 0) return esc(label)
  return `<a href="${esc(u)}" style="color:${color};text-decoration:none">${esc(label)}</a>`
}

export function marco(titulo: string, subtitulo: string, cuerpo: string, pie: string): string {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#111827;font-size:14px;line-height:1.45">
  <div style="background:#F5D414;padding:16px 20px;border-radius:12px 12px 0 0">
    <div style="font-weight:800;font-size:18px">${esc(titulo)}</div>
    <div style="font-size:12px;color:#374151;margin-top:2px">${esc(subtitulo)}</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:6px 20px 18px;border-radius:0 0 12px 12px">
    ${cuerpo}
    <p style="margin:22px 0 0;padding-top:12px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">${pie}</p>
  </div>
</div>`
}

function seccion(titulo: string, contenido: string, verMas?: { href: string; label: string }): string {
  if (!contenido) return ""
  const mas = verMas
    ? ` <a href="${PANEL}${verMas.href}" style="font-size:12px;font-weight:400;color:#0D9488;text-decoration:none">${esc(verMas.label)} →</a>`
    : ""
  return `
    <h2 style="margin:22px 0 8px;font-size:15px;border-left:4px solid #0D9488;padding-left:8px">${esc(titulo)}${mas}</h2>
    ${contenido}`
}

function lista(items: string[]): string {
  if (!items.length) return ""
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${
    items.map((it) => `<tr><td style="padding:7px 0;border-bottom:1px solid #f3f4f6;font-size:14px;vertical-align:top">${it}</td></tr>`).join("")
  }</table>`
}

const gris = (t: string) => `<span style="color:#6b7280;font-size:12px">${t}</span>`

// ---------------------------------------------------------------------------
// Resumen matutino
// ---------------------------------------------------------------------------

/**
 * Arma el resumen del día `hoy` (día de Lima en que corrió el benchmark).
 * Recordatorio de fechas: el benchmark del día X guarda el tráfico del día
 * COMPLETO X-1, así que la fila `date = hoy` de own_traffic* es "ayer".
 */
export async function armarResumen(db: SupabaseClient, hoy: string): Promise<Correo> {
  const ayer = diaAnterior(hoy)

  const { data: gscUlt } = await db.from("gsc_daily").select("date")
    .order("date", { ascending: false }).limit(1).maybeSingle()
  const gscDate = gscUlt?.date ?? hoy

  const [totales, notas, secciones, insights, quick, recos, trends, audits, corrida] = await Promise.all([
    db.from("own_traffic_totals").select("date, page_views").in("date", [hoy, ayer]),
    db.from("own_traffic").select("page_path, title, sessions").eq("date", hoy)
      .order("sessions", { ascending: false }).limit(40),
    db.from("own_traffic_sections").select("section, page_views").eq("date", hoy)
      .order("page_views", { ascending: false }).limit(8),
    db.from("daily_insights").select("headline, detail").eq("date", hoy).limit(6),
    db.from("gsc_daily").select("query, page, position, impressions, clicks, query_freshness")
      .eq("date", gscDate).eq("search_type", "web").gte("position", 4).lte("position", 10)
      .gte("impressions", 200).order("impressions", { ascending: false }).limit(40),
    db.from("recommendations").select("title_suggested, angle, why_now, urgency, score, section")
      .eq("date", hoy).order("score", { ascending: false }).limit(5),
    db.from("daily_trends").select("keyword, why_trending, approx_traffic, rank, created_at")
      .eq("date", hoy).order("created_at", { ascending: false }).limit(40),
    db.from("onpage_audits").select("url, title, score, suggestions, issues").eq("audited_date", hoy)
      .order("score", { ascending: true }).limit(3),
    db.from("agent_runs").select("finished_at, sources_failed").eq("kind", "morning").eq("run_date", hoy)
      .order("finished_at", { ascending: false }).limit(1).maybeSingle(),
  ])

  const partes: string[] = []
  const texto: string[] = []

  // --- Ayer en cifras -------------------------------------------------------
  const tHoy = (totales.data ?? []).filter((r: Fila) => r.date === hoy)[0]
  const tAnt = (totales.data ?? []).filter((r: Fila) => r.date === ayer)[0]
  if (tHoy) {
    let delta = ""
    if (tAnt && tAnt.page_views > 0) {
      const pct = ((tHoy.page_views - tAnt.page_views) / tAnt.page_views) * 100
      const color = pct >= 0 ? "#059669" : "#DC2626"
      delta = ` <span style="font-size:13px;color:${color};font-weight:700">${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}% vs el día anterior</span>`
    }
    partes.push(seccion(`Ayer en cifras (${fechaLarga(ayer)})`,
      `<p style="margin:0"><span style="font-size:26px;font-weight:800">${num(tHoy.page_views)}</span> ${gris("páginas vistas en todo el sitio")}${delta}</p>`,
      { href: "/trafico", label: "Tráfico" }))
    texto.push(`AYER: ${num(tHoy.page_views)} páginas vistas en el sitio`)
  }

  const top = (notas.data ?? []).filter((r: Fila) => isRealArticle(r.page_path)).slice(0, 5)
  if (top.length) {
    partes.push(seccion("Las 5 notas más leídas de ayer", lista(top.map((r: Fila, i: number) =>
      `<b>${i + 1}.</b> ${link(r.page_path, recorta(r.title || r.page_path, 110), "#111827")} ${gris(num(r.sessions) + " vistas")}`))))
    texto.push("MÁS LEÍDAS:\n" + top.map((r: Fila, i: number) => `${i + 1}. ${r.title || r.page_path} (${num(r.sessions)})`).join("\n"))
  }

  // "Unknown" es el cajón de Marfeel para portada y homes: no es una sección.
  const secs = (secciones.data ?? []).filter((r: Fila) => String(r.section).toLowerCase() !== "unknown").slice(0, 5)
  if (secs.length) {
    partes.push(`<p style="margin:10px 0 0;font-size:13px">${gris("Secciones con más tráfico:")} ${
      secs.map((r: Fila) => `${esc(r.section)} <b>${num(r.page_views)}</b>`).join(" · ")}</p>`)
  }

  // --- Aprendizajes ---------------------------------------------------------
  const ins = insights.data ?? []
  if (ins.length) {
    partes.push(seccion("Lo que dejó ayer", lista(ins.map((r: Fila) =>
      `<b>${esc(r.headline)}</b><br>${gris(esc(recorta(r.detail, 220)))}`))))
    texto.push("APRENDIZAJES:\n" + ins.map((r: Fila) => `- ${r.headline}`).join("\n"))
  }

  // --- Qué cubrir hoy -------------------------------------------------------
  const rec = recos.data ?? []
  if (rec.length) {
    partes.push(seccion("Qué cubrir ahora", lista(rec.map((r: Fila) =>
      `<b>${esc(r.title_suggested)}</b> ${gris(`${esc(r.urgency)} · ${Math.round(r.score)}/100 · ${esc(r.section ?? "")}`)}` +
      (r.angle ? `<br>${gris("Ángulo: " + esc(recorta(r.angle, 160)))}` : ""))) +
      `<p style="margin:6px 0 0">${gris("El titular es una sugerencia del modelo: verificar los hechos antes de publicar.")}</p>`,
      { href: "/recomendaciones", label: "Recomendaciones" }))
    texto.push("QUÉ CUBRIR:\n" + rec.map((r: Fila) => `- ${r.title_suggested} (${r.urgency}, ${Math.round(r.score)}/100)`).join("\n"))
  }

  // --- Tendencias: solo la corrida más reciente -----------------------------
  const tr = trends.data ?? []
  if (tr.length) {
    const ultima = new Date(tr[0].created_at).getTime()
    const vigentes = tr.filter((r: Fila) => ultima - new Date(r.created_at).getTime() < 5 * 60_000)
      .sort((a: Fila, b: Fila) => (a.rank ?? 99) - (b.rank ?? 99)).slice(0, 5)
    partes.push(seccion(`En tendencia en Google Perú (${horaLima(tr[0].created_at)})`, lista(vigentes.map((r: Fila) =>
      `<b>${esc(r.keyword)}</b>${r.approx_traffic ? " " + gris(num(r.approx_traffic) + "+ búsquedas") : ""}` +
      (r.why_trending ? `<br>${gris(esc(recorta(r.why_trending, 200)))}` : ""))),
      { href: "/trends", label: "Tendencias" }))
    texto.push("TENDENCIAS: " + vigentes.map((r: Fila) => r.keyword).join(", "))
  }

  // --- Search Console -------------------------------------------------------
  const qw = (quick.data ?? []).filter((r: Fila) => r.query_freshness !== "past").slice(0, 5)
  if (qw.length) {
    partes.push(seccion("Notas a un empujón del top 3 en Google", lista(qw.map((r: Fila) =>
      `<b>${esc(r.query)}</b> ${gris(`posición ${Number(r.position).toFixed(1)} · ${num(r.impressions)} impresiones`)}` +
      `<br>${link(r.page, recorta(String(r.page ?? "").replace(/^https?:\/\/(www\.)?rpp\.pe/, ""), 90))}`)),
      { href: "/busqueda", label: "Búsqueda" }))
    texto.push("CERCA DEL TOP 3:\n" + qw.map((r: Fila) => `- ${r.query} (pos. ${Number(r.position).toFixed(1)})`).join("\n"))
  }

  // --- Auditoría ------------------------------------------------------------
  const aud = (audits.data ?? []).filter((r: Fila) => r.suggestions && r.suggestions.title)
  if (aud.length) {
    partes.push(seccion("Títulos por mejorar", lista(aud.map((r: Fila) =>
      `${gris("Actual:")} ${link(r.url, recorta(r.title, 120), "#111827")}<br>${gris("Propuesto:")} <b>${esc(r.suggestions.title)}</b>`)),
      { href: "/auditoria", label: "Auditoría" }))
  }

  // --- Estado del agente ----------------------------------------------------
  const fallas: string[] = (corrida.data?.sources_failed as string[] | null) ?? []
  const estado = fallas.length
    ? `<span style="color:#B45309">Aviso: en el benchmark de hoy falló ${esc(fallas.join(", "))}; esa parte del resumen puede estar incompleta.</span><br>`
    : ""

  if (!partes.length) {
    partes.push(`<p style="margin:16px 0 0">El benchmark de hoy no dejó datos para el resumen. Revisar el <a href="${PANEL}/status" style="color:#0D9488">estado del agente</a>.</p>`)
  }

  const pie = `${estado}Generado por el SEO Agent${corrida.data?.finished_at ? ` con el benchmark de las ${horaLima(corrida.data.finished_at)}` : ""}. ` +
    `<a href="${PANEL}" style="color:#0D9488">Abrir el panel</a>`

  return {
    subject: `Resumen SEO de hoy, ${fechaLarga(hoy)}`,
    html: marco("Resumen SEO de la mañana", `RPP Noticias · ${fechaLarga(hoy)}`, partes.join(""), pie),
    text: texto.join("\n\n") + `\n\nPanel: ${PANEL}`,
  }
}

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

const SEVERIDAD: Record<string, { label: string; color: string }> = {
  high:   { label: "ALTA",  color: "#DC2626" },
  medium: { label: "MEDIA", color: "#D97706" },
  low:    { label: "BAJA",  color: "#6B7280" },
}

/** Orden de severidad, para el filtro "mínimo" de cada destinatario. */
export const NIVEL: Record<string, number> = { low: 1, medium: 2, high: 3 }

export function armarAlertas(alertas: Fila[]): Correo {
  const orden = alertas.slice().sort((a, b) => (NIVEL[b.severity] ?? 0) - (NIVEL[a.severity] ?? 0) || (b.score ?? 0) - (a.score ?? 0))
  const hayAlta = orden.some((a) => a.severity === "high")
  const primero = orden[0]

  const bloques = orden.map((a) => {
    const sev = SEVERIDAD[a.severity] ?? SEVERIDAD.low
    return `
    <div style="margin:14px 0 0;padding:12px 14px;border:1px solid #e5e7eb;border-left:4px solid ${sev.color};border-radius:8px">
      <div style="font-size:11px;font-weight:700;color:${sev.color};letter-spacing:.5px">
        ${sev.label}${a.section ? " · " + esc(String(a.section).toUpperCase()) : ""}${a.score != null ? ` · ${Math.round(a.score)}/100` : ""} · ${horaLima(a.created_at)}
      </div>
      <div style="font-size:17px;font-weight:800;margin:3px 0 4px">${esc(a.title)}</div>
      ${a.keyword && a.keyword !== a.title ? `<div style="font-size:12px;color:#6b7280;margin:0 0 5px">${a.type === "coverage_gap" ? "Evento programado sin nota en RPP · " : ""}Búsqueda en tendencia: <b>${esc(a.keyword)}</b></div>` : ""}
      ${a.description ? `<div>${esc(recorta(a.description, 400))}</div>` : ""}
      ${a.url ? `<div style="margin-top:6px;font-size:13px">${link(a.url, "Ver la noticia que lo origina →")}</div>` : ""}
    </div>`
  }).join("")

  const subject = orden.length === 1
    ? `${hayAlta ? "🔴" : "🟠"} Alerta SEO ${(SEVERIDAD[primero.severity] ?? SEVERIDAD.low).label}: ${recorta(primero.title, 80)}`
    : `${hayAlta ? "🔴" : "🟠"} ${orden.length} alertas SEO: ${recorta(orden.map((a) => a.title).join(", "), 90)}`

  const pie = `Solo se alerta de hechos que RPP aún no ha publicado. ALTA = hay un hecho rompiendo. MEDIA = evento con mucha búsqueda. ` +
    `<a href="${PANEL}/alertas" style="color:#0D9488">Ver todas las alertas de hoy</a>`

  return {
    subject,
    html: marco(orden.length === 1 ? "Alerta SEO" : `${orden.length} alertas SEO`,
      "RPP Noticias · tendencia en Google Perú ahora", bloques, pie),
    text: orden.map((a) => `[${(SEVERIDAD[a.severity] ?? SEVERIDAD.low).label}] ${a.title}\n${a.description ?? ""}\n${a.url ?? ""}`).join("\n\n") +
      `\n\nPanel: ${PANEL}/alertas`,
  }
}
