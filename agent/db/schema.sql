-- Ejecutar una sola vez en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS daily_trends (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date         date NOT NULL,
  keyword      text NOT NULL,
  growth_score float,
  category     text,
  geo          text DEFAULT 'PE',
  rank         integer,
  why_trending text,     -- resumen LLM: por qué es tendencia hoy (v. bloque 2026-07-15)
  news         jsonb,    -- noticias de Google News que lo evidencian
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gsc_daily (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date         date NOT NULL,
  page         text NOT NULL,
  query        text,
  clicks       integer,
  impressions  integer,
  ctr          float,
  position     float,
  search_type  text DEFAULT 'web',
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS own_traffic (
  id                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date                 date NOT NULL,
  page_path            text NOT NULL,
  sessions             integer,
  source               text,
  bounce_rate          float,
  avg_session_duration float,
  created_at           timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS competitor_articles (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  fetched_date date NOT NULL,
  site         text NOT NULL,
  title        text NOT NULL,
  url          text UNIQUE,
  published_at timestamptz,
  category     text,
  created_at   timestamptz DEFAULT now(),
  -- Cobertura: ¿RPP ya publicó una nota del mismo tema? (analyzers/coverage.py,
  -- rules-first + LLM, comparando contra el RSS propio de rpp.pe en ~5h)
  rpp_has_coverage    boolean,
  rpp_matched_title   text,
  rpp_matched_url     text,
  coverage_checked_at timestamptz
);

CREATE TABLE IF NOT EXISTS recommendations (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date            date NOT NULL,
  rank            integer,
  title_suggested text,
  angle           text,
  why_now         text,
  data_source     text,
  urgency         text,
  format          text,
  program         text,
  score           float,
  category        text,
  publish_window  text,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date        date NOT NULL,
  type        text NOT NULL,
  severity    text NOT NULL,
  title       text NOT NULL,
  description text,
  url         text,
  resolved    boolean DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_decay (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  detected_date    date NOT NULL,
  page_path        text NOT NULL,
  current_traffic  integer,
  peak_traffic     integer,
  drop_percentage  float,
  suggested_action text,
  resolved         boolean DEFAULT false,
  created_at       timestamptz DEFAULT now(),
  -- necesario para el upsert on_conflict=page_path del writer
  CONSTRAINT content_decay_page_path_key UNIQUE (page_path)
);

CREATE TABLE IF NOT EXISTS publishing_windows (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  updated_date   date NOT NULL,
  overall_best   text,
  morning_peak   text,
  afternoon_peak text,
  evening_peak   text,
  raw_data       jsonb,
  created_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  run_date        date NOT NULL,
  kind            text,                    -- "morning" | "radar" (para "última actualización" por pestaña)
  started_at      timestamptz,
  finished_at     timestamptz,
  status          text,
  sources_ok      text[],
  sources_failed  text[],
  error_log       text,
  created_at      timestamptz DEFAULT now()
);

-- Índices para queries frecuentes del dashboard
CREATE INDEX IF NOT EXISTS idx_daily_trends_date    ON daily_trends(date DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_daily_date       ON gsc_daily(date DESC);
CREATE INDEX IF NOT EXISTS idx_own_traffic_date     ON own_traffic(date DESC);
CREATE INDEX IF NOT EXISTS idx_competitor_date      ON competitor_articles(fetched_date DESC);
CREATE INDEX IF NOT EXISTS idx_recommendations_date ON recommendations(date DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved      ON alerts(resolved, date DESC);
CREATE INDEX IF NOT EXISTS idx_decay_resolved       ON content_decay(resolved, detected_date DESC);

-- Row Level Security
ALTER TABLE daily_trends        ENABLE ROW LEVEL SECURITY;
ALTER TABLE gsc_daily           ENABLE ROW LEVEL SECURITY;
ALTER TABLE own_traffic         ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_decay       ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishing_windows  ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs          ENABLE ROW LEVEL SECURITY;

-- Política: lectura pública (el dashboard usa anon key)
CREATE POLICY "public_read" ON daily_trends        FOR SELECT USING (true);
CREATE POLICY "public_read" ON gsc_daily           FOR SELECT USING (true);
CREATE POLICY "public_read" ON own_traffic         FOR SELECT USING (true);
CREATE POLICY "public_read" ON competitor_articles FOR SELECT USING (true);
CREATE POLICY "public_read" ON recommendations     FOR SELECT USING (true);
CREATE POLICY "public_read" ON alerts              FOR SELECT USING (true);
CREATE POLICY "public_read" ON content_decay       FOR SELECT USING (true);
CREATE POLICY "public_read" ON publishing_windows  FOR SELECT USING (true);
CREATE POLICY "public_read" ON agent_runs          FOR SELECT USING (true);

-- ===========================================================================
-- v2 (Marfeel + auditoría on-page + ciclo de aprendizaje) — 2026-06
-- Ejecutar este bloque en Supabase SQL Editor sobre la base ya existente.
-- ===========================================================================

ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS section text;
ALTER TABLE alerts          ADD COLUMN IF NOT EXISTS section text;
ALTER TABLE alerts          ADD COLUMN IF NOT EXISTS score float;
ALTER TABLE own_traffic     ADD COLUMN IF NOT EXISTS unique_users integer;
ALTER TABLE own_traffic     ADD COLUMN IF NOT EXISTS title text;

-- Constraint único que necesita el upsert on_conflict=page_path de content_decay
-- (sin él, el POST daba 42P10 y el decay nunca se guardaba). Idempotente.
ALTER TABLE content_decay DROP CONSTRAINT IF EXISTS content_decay_page_path_key;
ALTER TABLE content_decay ADD  CONSTRAINT content_decay_page_path_key UNIQUE (page_path);

-- Insights del benchmark de la mañana (narrativa para el dashboard)
CREATE TABLE IF NOT EXISTS daily_insights (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date       date NOT NULL,
  section    text,
  category   text,
  headline   text NOT NULL,
  detail     text,
  evidence   jsonb,
  created_at timestamptz DEFAULT now()
);

-- Pesos de aprendizaje que ajustan el scoring del día (ciclo de aprendizaje)
CREATE TABLE IF NOT EXISTS scoring_weights (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date       date NOT NULL,
  dimension  text NOT NULL,
  multiplier float NOT NULL DEFAULT 1.0,
  rationale  text,
  created_at timestamptz DEFAULT now()
);

-- Auditorías SEO on-page de notas publicadas
CREATE TABLE IF NOT EXISTS onpage_audits (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  audited_date   date NOT NULL,
  url            text NOT NULL,
  title          text,
  target_keyword text,
  score          integer,
  issues         jsonb,
  suggestions    jsonb,            -- reescritura LLM: {title, meta_description, h2[]}
  created_at     timestamptz DEFAULT now()
);
ALTER TABLE onpage_audits ADD COLUMN IF NOT EXISTS suggestions jsonb;

CREATE INDEX IF NOT EXISTS idx_daily_insights_date  ON daily_insights(date DESC);
CREATE INDEX IF NOT EXISTS idx_scoring_weights_date ON scoring_weights(date DESC);
CREATE INDEX IF NOT EXISTS idx_onpage_audits_date   ON onpage_audits(audited_date DESC);

ALTER TABLE daily_insights  ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE onpage_audits   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read" ON daily_insights  FOR SELECT USING (true);
CREATE POLICY "public_read" ON scoring_weights FOR SELECT USING (true);
CREATE POLICY "public_read" ON onpage_audits   FOR SELECT USING (true);

-- ===========================================================================
-- Tráfico por canal de adquisición (grano: fecha × artículo × canal).
-- Alimenta la página /trafico (filtro por canal + folder, estilo Marfeel).
-- Se mantiene APARTE de own_traffic (que sigue con grano 1 fila/artículo/día
-- para no alterar decay ni insights, que suman totales por artículo).
-- Ejecutar en Supabase SQL Editor sobre la base existente.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS own_traffic_channels (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date         date NOT NULL,
  page_path    text NOT NULL,
  title        text,
  channel      text NOT NULL,           -- fuente de Marfeel: Google, Google Discover, Direct, Internal, Home, Social...
  pageviews    integer,
  unique_users integer,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_own_traffic_channels_date    ON own_traffic_channels(date DESC);
CREATE INDEX IF NOT EXISTS idx_own_traffic_channels_channel ON own_traffic_channels(channel);

ALTER TABLE own_traffic_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON own_traffic_channels FOR SELECT USING (true);

-- ===========================================================================
-- "Por qué es tendencia" (2026-07-15): resumen LLM + noticias de Google News
-- por keyword en daily_trends. news = [{title, source, source_url, url,
-- published_at}]. YA APLICADO en producción vía Supabase MCP.
-- ===========================================================================
ALTER TABLE daily_trends ADD COLUMN IF NOT EXISTS why_trending text;
ALTER TABLE daily_trends ADD COLUMN IF NOT EXISTS news jsonb;

-- ===========================================================================
-- Vigencia de la demanda (2026-07-15): clasificación de cada query de GSC
-- según si su interés sigue vivo ('hot' | 'evergreen' | 'past' | NULL).
-- La escribe run_morning (reglas + LLM, analyzers/freshness.py); el dashboard
-- oculta las 'past' de la cola de acción de /busqueda.
-- PENDIENTE de aplicar en Supabase (el writer tolera su ausencia mientras).
-- ===========================================================================
ALTER TABLE gsc_daily ADD COLUMN IF NOT EXISTS query_freshness text;

-- ===========================================================================
-- Checklist de la auditoría on-page (/auditoria): estado marcado a mano por
-- el equipo para controlar qué se ha ido corrigiendo. Escribe el dashboard
-- con la anon key (mismo criterio MVP que el resto: RLS abierto, solo flags).
--   id editorial:  '<url>|<check>|<slot>'     (persiste entre re-auditorías;
--                  slot = nº de ocurrencia del check dentro de la nota)
--   id plataforma: 'platform|<check>|<message>'
-- ===========================================================================
CREATE TABLE IF NOT EXISTS audit_check_state (
  id         text PRIMARY KEY,
  done       boolean NOT NULL DEFAULT false,
  done_at    timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE audit_check_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read"   ON audit_check_state FOR SELECT USING (true);
CREATE POLICY "public_insert" ON audit_check_state FOR INSERT WITH CHECK (true);
CREATE POLICY "public_update" ON audit_check_state FOR UPDATE USING (true);
