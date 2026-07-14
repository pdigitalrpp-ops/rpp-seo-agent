/**
 * Solo contenido editorial de rpp.pe: notas (…-noticia-<id>) y coberturas en vivo
 * (…-live-<id>). Descarta home, homes de sección (/deportes), landings/herramientas,
 * buscador, /ultimas-noticias, /tv-vivo, /audio/en-vivo, listados y el widget mrf.io.
 * Debe coincidir con `is_real_article` de agent/article_filter.py (Python) — si
 * cambia el patrón allá, replicar aquí también.
 */
const ARTICLE_RE = /-(noticia|live)-\d+/i

export function isRealArticle(pagePath: string): boolean {
  try {
    const u = new URL(pagePath)
    const host = u.hostname.replace(/^www\./, "")
    if (host !== "rpp.pe" && !host.endsWith(".rpp.pe")) return false
    return ARTICLE_RE.test(u.pathname)
  } catch {
    return false
  }
}

/** Deriva la "sección" (primer segmento del path) desde la URL del artículo. */
export function sectionOf(pagePath: string): string {
  try {
    const u = new URL(pagePath)
    const host = u.hostname.replace(/^www\./, "")
    if (host !== "rpp.pe" && !host.endsWith(".rpp.pe")) return host // dominios ajenos (mrf.io…)
    const seg = u.pathname.split("/").filter(Boolean)
    if (seg.length === 0) return "(home)"
    return seg[0]
  } catch {
    return "(otros)"
  }
}
