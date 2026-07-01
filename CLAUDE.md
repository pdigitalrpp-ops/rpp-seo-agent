# RPP SEO Agent — Contexto para Claude Code

Agente SEO de contenidos para RPP Noticias (rpp.pe). Un agente de **3 etapas**
que recopila señales, las puntúa y genera recomendaciones editoriales en un
dashboard web.

**Stack:** Python 3.11 + GitHub Actions + Supabase + Next.js 14 en Vercel
**Costo:** $0/mes (free tier). Repo público → minutos de Actions ilimitados.

---

## Estado actual

**Fecha último avance:** 2026-07-01
**Estado:** v2 en producción y **funcionando end-to-end**. El radar corre en
GitHub Actions, recolecta de Marfeel + Google Trends + competencia, puntúa y
guarda recomendaciones en Supabase; el dashboard las muestra en vivo. El
benchmark matutino también quedó **verificado escribiendo data real** (ver abajo).

- **Repo:** `https://github.com/pdigitalrpp-ops/rpp-seo-agent` (rama `master`)
- **Dashboard:** `https://rpp-seo-agent.vercel.app` (Vercel, team PDIGITAL RPP)
- **Supabase:** project ref `tfrnpjbvxulswvqtosoq`
- Git local del usuario autentica como `pdigitalrpp-ops` vía Git Credential Manager.

### Pendientes
- **Alertas Etapa 3 (Teams/WhatsApp):** definir `SECTION_RESPONSIBLES` (canal por
  sección). Hasta entonces las alertas quedan solo en Supabase/dashboard. (El
  usuario lo dejó para el final.)
- **Secretos opcionales:** `GSC_CREDENTIALS_JSON` (posiciones SEO) y `SERPAPI_KEY`.
  El agente ya funciona sin ellos (esas fuentes fallan de forma controlada).
- **Filtrar no-artículos del benchmark:** own_traffic incluye filas que no son notas
  editoriales (home `rpp.pe`, `/audio/en-vivo`, y el widget `experiences.mrf.io/...`
  del recomendador de Marfeel). Conviene excluir en run_morning los page_path que no
  sean rutas de artículo de rpp.pe / dominios ajenos (mrf.io). No implementado aún.
- **Fase 2 — capa LLM (Claude):** ver más abajo. Es lo que corrige la calidad.

---

## Arquitectura de 3 etapas

```
🌅 Etapa 1 — Benchmark de la mañana   (run_morning.py, cron 11:00 UTC = 06:00 Lima)
   Marfeel (ayer) + GSC + competencia → rendimiento de ayer, por qué funcionó,
   auditoría on-page de notas, aprendizajes (scoring_weights) para el día.

📡 Etapa 2 — Radar en tiempo real      (run_radar.py, cron cada ~10 min diurno Lima)
   Marfeel (hoy) + Trends + "más leídas" competencia → temas con score 0-100,
   mapeados a sección, aplicando los aprendizajes de la mañana.

🚨 Etapa 3 — Alertas por sección       (dentro de run_radar.py)
   Temas con score ≥ umbral → alerta al equipo de la sección (Teams/WhatsApp).
   Con anti-spam. PENDIENTE: canal por sección (SECTION_RESPONSIBLES).
```

El **ciclo de aprendizaje**: cada mañana mide qué funcionó y ajusta los pesos del
scoring que usa el radar el resto del día. Rules-first hoy; con Claude (fase 2)
sería razonamiento real.

---

## Estructura de archivos

```
rpp-seo-agent/
├── .github/workflows/
│   ├── morning.yml                 ← cron 11:00 UTC → run_morning.py
│   └── radar.yml                   ← cron */10 (horario Lima) → run_radar.py
├── agent/
│   ├── config.py                   ← Marfeel, SECTION_MAP, SCORE_WEIGHTS, umbrales, ONPAGE
│   ├── run_morning.py              ← Etapa 1 (benchmark + insights + auditoría)
│   ├── run_radar.py                ← Etapas 2-3 (radar + alertas)
│   ├── collectors/
│   │   ├── marfeel.py              ← tráfico/audiencia (REEMPLAZA a GA4)
│   │   ├── gsc.py                  ← Google Search Console (posiciones, CTR, drops)
│   │   ├── trends.py               ← Google Trends vía RSS (NO pytrends en CI)
│   │   ├── competitors.py          ← RSS de competencia
│   │   ├── rpp_articles.py         ← descarga+parseo HTML de notas (auditor on-page)
│   │   └── serpapi.py              ← rankings/SERP (cuota escasa)
│   ├── analyzers/
│   │   ├── scoring.py              ← score 0-100 con pesos de aprendizaje; assign_section
│   │   ├── opportunities.py        ← quick wins, CTR bajo, build_recommendations
│   │   ├── decay.py                ← content decay vs pico histórico
│   │   ├── signals.py              ← early signals, ventanas (reusable)
│   │   └── onpage_audit.py         ← auditoría SEO on-page de una nota
│   ├── notifiers/notify.py         ← dispatch de alertas a Teams/WhatsApp (WhatsApp = stub)
│   ├── writers/supabase_writer.py  ← escribe todas las tablas
│   └── db/schema.sql               ← 12 tablas (9 v1 + v2: daily_insights, scoring_weights, onpage_audits)
├── dashboard/app/(dashboard)/      ← Next.js: page, recomendaciones, trends, competencia,
│                                       trafico, search-console, auditoria, alertas
├── requirements.txt
└── .env.example
```

`ga4.py` y `run.py` (v1) fueron **eliminados**.

---

## Decisiones de diseño y "gotchas" importantes

### Marfeel (fuente de tráfico — reemplaza a GA4)
- Auth: `POST https://api.newsroom.bi/api/user/signin` con `{email, password}` →
  bearer token (válido ~14 días, se cachea en `marfeel.py`).
- Datos: `POST https://api.newsroom.bi/api/dashboard/query`.
- **LÍMITE DURO: 1 request/minuto.** `marfeel.py` tiene un rate-limiter global.
- **El query DEBE llevar `dates`.** Sin `dates` + `granularity:"realtime"` devuelve
  `{"msg":"Invalid params"}`. Se usa `granularity:"daily"` + `dates:{last:{number:1,dimension:"day"}}`.
- **Estructura de la respuesta agrupada (clave):** los datos por dimensión están en
  `actualData.values[]`, NO en `actualData.data[]` (esa es la serie temporal por fecha).
  Cada entry: `{"key": hash, "total": N, "items": [{"id","value","type"}]}` donde
  `type` = nombre de la dimensión (`url`, `title`, `section`, `source`). `_rows_from_response`
  en `marfeel.py` parsea esto. (Bug histórico: leía `data[]` → guardaba fechas como page_path.)
- **Verificado (2026-07-01, run_morning #6 manual):** own_traffic quedó con 200 filas,
  todas con URL real (`https://rpp.pe/...`) y título → el fix del parser funciona
  end-to-end. (Ver pendiente "filtrar no-artículos" arriba.)
- Secretos: `MARFEEL_EMAIL`, `MARFEEL_PASSWORD`.
- **Tráfico por canal (nuevo):** `fetch_yesterday_by_channel()` agrupa por
  `url+title+source` → una fila por (artículo, canal). Alimenta `own_traffic_channels`
  y la página `/trafico` (filtro por canal + folder, default Google). **Sin verificar
  contra la API en vivo** que Marfeel devuelva `source` por URL al agrupar en 3 dims;
  se confirma en la próxima corrida de `run_morning`. Si `source` no viene por fila,
  habría que consultar por canal (un `filters` por source, +60s c/u por el rate-limit).

### Google Trends
- **pytrends NO funciona desde GitHub Actions** (bloqueo por IP de datacenter).
- Se usa el feed RSS oficial **`https://trends.google.com/trending/rss?geo=PE`**
  (el endpoint clásico `/trends/trendingsearches/daily/rss` da 404). Devuelve ~10
  tendencias con `ht:approx_traffic`. El `growth_score` (0-10) sale de ese tráfico.

### Competencia
- El Comercio y Gestión usan su RSS `arcio` directo. La República, Peru21 e Infobae
  usan **Google News RSS por dominio** (`news.google.com/rss/search?q=when:1d site:...`)
  porque sus feeds propios cambiaron/fallan.

### Scoring 0-100
- `SCORE_WEIGHTS` (suman 100): market_trend 30, competition_gap 20, rpp_relevance 15,
  discover_potential 15, time_sensitivity 10, own_momentum 10.
- Cada dimensión se normaliza 0-1 y se pondera. `learning` = multiplicadores por
  dimensión (de `scoring_weights`, aprendizajes de la mañana).
- Urgencia: INMEDIATO ≥80, HOY ≥60, ESTA SEMANA ≥40, si <40 → DESCARTAR (se filtra).
- **Secciones reemplazan a "programas".** `assign_section(category, sections)` mapea la
  categoría a una sección real de rpp.pe (dimensión `section` de Marfeel).

### Supabase
- **Usar `supabase==2.31.0` + `httpx>=0.26`.** Versiones viejas dan
  `Client.__init__() got an unexpected keyword argument 'proxy'` y bloquean la escritura.
- Tablas con RLS + política `public_read` (`SELECT USING true`). Dashboard usa anon key
  (lectura), agente usa service_role (escritura).

### Dashboard Next.js
- App Router + RSC. `export const revalidate = 60` en todas las páginas (el radar
  actualiza cada ~10 min; 1h de ISR era demasiado stale).
- Nueva página `/auditoria` (onpage_audits). Home muestra "Aprendizajes de hoy"
  (daily_insights). recomendaciones/home usan `section` y score `/100`.
- **Zona horaria (gotcha):** los Server Components renderizan en el runtime de Vercel
  (UTC). Al mostrar horas hay que forzar `timeZone: "America/Lima"` en
  `toLocaleTimeString`/`toLocaleString`, o se ven ~5h adelantadas. Ya aplicado en
  `competencia/page.tsx` (hora de artículos) y `page.tsx` (última actualización).
  La data en Supabase siempre está en UTC con tz — el ajuste es SOLO de display.

### GitHub Actions
- **El cron se retrasa/saltea mucho** en repos de poca actividad (hoy corrió ~3 veces,
  no cada 10 min). Para tiempo real de verdad haría falta un worker dedicado.
- `run_radar.py` sólo escribe `daily_trends`, `competitor_articles`, `recommendations`,
  `alerts`, `agent_runs`. `run_morning.py` escribe `own_traffic`,
  `own_traffic_channels`, `gsc_daily`, `content_decay`, `daily_insights`,
  `scoring_weights`, `onpage_audits`.

---

## Tablas Supabase

| Tabla | Escribe | Lee |
|-------|---------|-----|
| `daily_trends` | radar | dashboard trends, home |
| `competitor_articles` | radar (upsert por url) | dashboard competencia |
| `recommendations` | radar (borra+reinserta por fecha) | dashboard recomendaciones, home |
| `alerts` | radar | dashboard alertas |
| `own_traffic` | morning | dashboard trafico (fallback), decay |
| `own_traffic_channels` | morning (borra+reinserta por fecha) | dashboard trafico (canal + folder) |
| `gsc_daily` | morning | dashboard search-console |
| `content_decay` | morning (upsert page_path) | dashboard alertas |
| `daily_insights` | morning (borra+reinserta) | dashboard home |
| `scoring_weights` | morning | radar (lee aprendizajes) |
| `onpage_audits` | morning | dashboard auditoria |
| `publishing_windows` | (reusable) | dashboard home |
| `agent_runs` | ambos | dashboard home (semáforo) |

---

## Variables de entorno

### Agente Python (GitHub Secrets)
```
MARFEEL_EMAIL          → pdigitalrpp@gmail.com                 [✅ configurado]
MARFEEL_PASSWORD       → password de API de Marfeel            [✅ configurado]
SUPABASE_URL           → https://tfrnpjbvxulswvqtosoq.supabase.co  [✅ configurado]
SUPABASE_KEY           → service_role key (NO la anon)         [✅ configurado]
GSC_CREDENTIALS_JSON   → service account de Google             [⏳ pendiente, opcional]
SERPAPI_KEY            → clave de serpapi.com                  [⏳ pendiente, opcional]
```

### Dashboard (Vercel) — todas ✅ configuradas
```
NEXTAUTH_URL, NEXTAUTH_SECRET
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
PASS_EDITORIAL / PASS_DIRECCION / PASS_ADMIN   (contraseñas temporales: <rol>2026)
```

---

## Fase 2 — capa agéntica LLM (pendiente, decidida)

El agente actual es **rules-first**. La categorización por keywords falla notoriamente:
nombres de jugadores ("erling haaland", "lebron james", "van gaal") caen en "otros"
en vez de "deportes" → baja relevancia → se filtran → se pierde señal. Los títulos son
templados ("todo lo que necesitas saber").

**Fase 2 = agregar Claude** que: (1) categorice/razone los temas de verdad, (2) redacte
titulares y ángulos reales, (3) explique en lenguaje natural por qué funcionó el contenido.
Los datos ya limpios en Supabase son la base. Enchufar en costuras marcadas. **Rules-first
primero (ya hecho), IA después.**

---

## Contexto RPP

- **SITE_URL:** `https://rpp.pe/` · **Zona horaria:** America/Lima (UTC-5, sin DST)
- **Categorías** (sin tilde, claves de `CATEGORY_KEYWORDS`): politica, economia, deportes,
  entretenimiento, tecnologia, salud, mundo, otros.
- **Secciones** reales salen de la dimensión `section` de Marfeel (fallback en `KNOWN_SECTIONS_FALLBACK`).
- Umbral decay 20%, alerta GSC 30%, quick wins pos 4-10 con ≥200 impresiones, low CTR ≤2% con ≥500.
```
