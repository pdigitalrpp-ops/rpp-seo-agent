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

// ---------------------------------------------------------------------------
// Agrupación temática de secciones
// ---------------------------------------------------------------------------
// En rpp.pe los deportes NO cuelgan de /deportes/: fútbol, vóley, tenis y
// multideportes son secciones HERMANAS de primer nivel (/futbol/…, /voley/…),
// y /deportes/ es una landing repositorio que las reúne. Marfeel lo desglosa
// todavía más fino (Copa Sudamericana, Descentralizado, WWE, Automovilismo…).
//
// Para comparar segmentos temáticos eso fragmenta: fútbol compite consigo mismo
// repartido en media docena de etiquetas y ninguna se mide contra "Perú" o
// "Lima" en igualdad. Se fusionan todas bajo `deportes`, a pedido del equipo.
//
// La lista es AMPLIABLE a mano y a propósito: es criterio editorial, no algo
// que se pueda inferir de la URL. Si aparece una subsección deportiva nueva
// (un mundial, una liga), se añade acá y aplica al histórico sin tocar la DB.
const SECCIONES_DEPORTE = new Set([
  "futbol", "voley", "tenis", "multideportes", "apuestas deportivas",
  "apuestas-deportivas", "automovilismo", "lucha", "boxeo", "ufc", "wwe",
  "esports", "mas deportes", "mas futbol", "mas voley", "futbol mundial",
  "seleccion peruana", "descentralizado", "segunda division", "eliminatorias",
  "copa peru", "copa libertadores", "copa sudamericana", "copa america 2019",
  "champions league", "juegos olimpicos", "panamericanos", "rusia 2018",
  "qatar 2022", "el grafico", "futbol como cancha",
])

/** Minúsculas sin tildes: los dos lados escriben distinto ("Fútbol" vs "futbol"). */
export function sectionKey(raw: string): string {
  return (raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

/**
 * Sección temática de la que forma parte una sección cruda, ya normalizada.
 * Hoy solo fusiona deportes; el resto pasa tal cual.
 */
export function sectionGroup(raw: string): string {
  const k = sectionKey(raw)
  return SECCIONES_DEPORTE.has(k) ? "deportes" : k
}
