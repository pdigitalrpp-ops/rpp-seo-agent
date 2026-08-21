/**
 * Tipos de la vigilancia por keyword, compartidos entre el Server Component
 * que consulta Supabase (page.tsx) y el Client Component que la pinta
 * (RadarClient.tsx). Espejan las tablas watch_keywords / watch_hits del
 * agente (agent/db/schema.sql).
 */

export type WatchKeyword = {
  id: string
  /** Query verbatim que se manda a Google News: acepta sus operadores. */
  keyword: string
  /** Nombre legible en el panel; si falta se muestra la query cruda. */
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
  /** Cuándo lo publicó el medio. Varios feeds no la traen → null. */
  published_at: string | null
  /** 'google_news' | 'competencia' | 'feed:<nombre>' */
  found_via: string | null
  /** Cuándo lo ENCONTRÓ el agente. Siempre presente: es el default de la DB. */
  created_at: string
}
