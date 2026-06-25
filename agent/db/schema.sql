-- Ejecutar una sola vez en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS daily_trends (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date         date NOT NULL,
  keyword      text NOT NULL,
  growth_score float,
  category     text,
  geo          text DEFAULT 'PE',
  rank         integer,
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
  created_at   timestamptz DEFAULT now()
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
  created_at       timestamptz DEFAULT now()
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
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_insights_date  ON daily_insights(date DESC);
CREATE INDEX IF NOT EXISTS idx_scoring_weights_date ON scoring_weights(date DESC);
CREATE INDEX IF NOT EXISTS idx_onpage_audits_date   ON onpage_audits(audited_date DESC);

ALTER TABLE daily_insights  ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE onpage_audits   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read" ON daily_insights  FOR SELECT USING (true);
CREATE POLICY "public_read" ON scoring_weights FOR SELECT USING (true);
CREATE POLICY "public_read" ON onpage_audits   FOR SELECT USING (true);
