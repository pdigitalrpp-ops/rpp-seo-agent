# RPP SEO Agent — Contexto para Claude Code

Agente SEO de contenidos para RPP Noticias (rpp.pe). Un agente de **3 etapas**
que recopila señales, las puntúa y genera recomendaciones editoriales en un
dashboard web.

**Stack:** Python 3.11 + GitHub Actions + Supabase + Next.js 14 en Vercel
**Costo:** $0/mes (free tier). Repo público → minutos de Actions ilimitados.

---

## Estado actual

**Fecha último avance:** 2026-07-10
**Estado:** v2 en producción y **funcionando end-to-end**. El radar corre en
GitHub Actions, recolecta de Marfeel + Google Trends + competencia, puntúa y
guarda recomendaciones en Supabase; el dashboard las muestra en vivo. El
benchmark matutino también quedó **verificado escribiendo data real** (ver abajo).
Rediseño visual "RPP Digital" en producción (ver sección Dashboard Next.js).
Benchmark matutino del 2026-07-08 corrido y verificado (run #24, Success):
179 artículos, 500 filas GSC, 41 en content decay, 3 insights, 7 auditorías
on-page (sin sugerencias IA — Gemini sigue bloqueado, ver Fase 2 LLM).

**2026-07-09 — GSC Discover + SerpApi integrados, pestaña renombrada:** el
usuario se suscribió a SerpApi y pidió combinarla con GSC (que ya traía
Discover implementado pero sin usar) en vez de reemplazarla. Ver detalle en
"Google Search Console" y "SerpApi" más abajo. Pestaña `/search-console` →
`/busqueda` ("Búsqueda & Discover" en el nav), ahora con 3 secciones: búsqueda
web (igual que antes), Discover (nuevo), oportunidades SERP en vivo (nuevo,
SerpApi). Tabla nueva `serp_opportunities` en Supabase.
**Verificado end-to-end (run #26, manual, 2026-07-09):** `sources_ok` incluyó
`gsc_discover` y `serpapi`; 200 filas de Discover y 8 de `serp_opportunities`
con datos reales (RPP ya detectado en un carrusel de noticias, 0 featured
snippets propios → oportunidades libres). Ver query de ejemplo en el historial
de la sesión si hace falta repetir la verificación.

**2026-07-09 — Amazon Bedrock (Claude) como proveedor LLM preferido:** el
usuario obtuvo credenciales AWS con acceso a modelos Claude en Bedrock. Se creó
`agent/llm/bedrock.py` (mismo contrato que `gemini.py`: `categorize_topics`,
`rewrite_onpage_batch`, rules-first) y `agent/llm/provider.py` — un facade que
los orquestadores importan (`from llm import provider as llm`) en vez de un
proveedor específico. Orden de preferencia: **Bedrock > Gemini > reglas**,
porque Bedrock cobra por uso real (sin el `limit: 0` que bloquea a Gemini
hoy). Ver sección "Amazon Bedrock" más abajo. **Pendiente del usuario:** pegar
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` en GitHub Secrets
(ya referenciados en ambos workflows) — sin eso, el facade cae a Gemini
(bloqueado) y de ahí a reglas, sin romper nada.

**2026-07-10 — Dashboard: tooltips explicativos en las 8 pestañas + OpenRouter
(Tencent Hy3) reemplaza a Bedrock como proveedor LLM preferido — VERIFICADO
en producción:** (1) Componente `dashboard/components/ui/InfoTooltip.tsx`
(ícono "?" con panel por hover/tap, portal a `document.body` con posición fija
para no recortarse en tarjetas `overflow-hidden`) añadido al título y secciones
core de las 8 pestañas del dashboard. Desplegado y verificado en Vercel (READY).
(2) `agent/llm/openrouter.py` nuevo + `provider.py` actualizado: orden
**OpenRouter > Bedrock > Gemini > reglas** (Bedrock nunca respondió en
producción, cuenta AWS con modelos Claude gen. 3 marcados Legacy). El usuario
pegó `OPENROUTER_API_KEY` en GitHub Secrets y se corrió `radar.yml` manualmente
varias veces: **funciona en producción** (`✅ LLM categorizó 177/177 titulares`,
`10/10 temas`). Hubo que arreglar un bug real en el camino — Tencent Hy3 es un
modelo razonador y se quedaba sin `max_tokens` pensando antes de responder
(`finish_reason=length`); el fix fue capar el razonamiento con
`reasoning: {effort: "low", exclude: true}` (parámetro unificado de
OpenRouter), no subir tokens a lo bruto. Ver detalle completo en "Fase 2 —
capa LLM" más abajo.
(3) Corregido: el GitHub MCP no está bloqueado por sesión — la red corporativa
de RPP lo bloquea y activarlo requiere permisos de admin que el usuario no
tiene. Ver nota actualizada en "Conexiones MCP" más abajo.

**2026-07-10 — Categorización de competencia con LLM (siempre) + cobertura RPP
(feature nueva) + informativo de actualización por pestaña:**
(1) `provider.categorize_articles` re-categoriza CADA titular de competencia
con el LLM (las reglas por keyword fallaban con nombres propios: "Canal 5 y
TUDN…" → política, Haaland → política). Corre siempre en morning y radar.
Requirió además arreglar `save_competitor_articles`: usaba
`ignore_duplicates=True`, así que una URL ya vista NUNCA se re-categorizaba
aunque el LLM mejorara — ahora hace upsert real.
(2) **Cobertura RPP** en la pestaña Competencia: por cada titular de
competencia se marca si RPP ya publicó una nota del mismo tema (badge
"✓ Publicado en RPP" / "⚠ Pendiente" + filtro "¿RPP ya lo publicó?"). Fuente de
lo propio: `collectors/rpp_own_feed.py` (RSS `https://rpp.pe/rss`, NO Marfeel
— Marfeel mide tráfico, no "lo último publicado"). Matching en
`analyzers/coverage.py`: rules-first (solapamiento de tokens ponderado por IDF,
con umbral de token distintivo) + refinamiento LLM. Corre **solo en el radar**
(no en el morning: ventanas de competencia 24h vs feed propio 5h → falsos
"pendiente"). Verificado con datos reales de producción y ajustado dos veces
tras detectar falsos positivos (tokens temporales genéricos, y misma
entidad/distinto hecho — p.ej. "bebés llamados Haaland" vs "pronóstico de
Haaland"). Columnas nuevas en `competitor_articles` (`rpp_has_coverage`,
`rpp_matched_title`, `rpp_matched_url`, `coverage_checked_at`). Ver sección
"Cobertura RPP" más abajo.
(3) **Informativo de actualización:** las 8 pestañas muestran ahora cadencia
("cada ~10 min" / "1 vez al día") + hora exacta de la última corrida (no solo
fecha). Requirió columna nueva `agent_runs.kind` ("morning"|"radar") con
backfill de los registros históricos. Ver "Dashboard Next.js" más abajo.

- **Repo:** `https://github.com/pdigitalrpp-ops/rpp-seo-agent` (rama `master`)
- **Dashboard:** `https://rpp-seo-agent.vercel.app` (Vercel, team PDIGITAL RPP)
- **Supabase:** project ref `tfrnpjbvxulswvqtosoq`
- Git local del usuario autentica como `pdigitalrpp-ops` vía Git Credential Manager.

### Conexiones MCP disponibles para Claude Code (2026-07-07)
- **Supabase MCP:** conectado, `project_id=tfrnpjbvxulswvqtosoq` (usar `execute_sql`/`apply_migration`).
  A veces devuelve 429/503 con ráfagas de queries; esperar unos segundos y reintentar.
- **Vercel MCP:** conectado y verificado. Team **PDIGITAL RPP** = `team_J5ILqbtm0EDZ4BSl158WrhD8`.
  Proyectos: `rpp-seo-agent` = `prj_2w37k5pifcwXtoQlVNZ1qszB8ect` (el dashboard real),
  `rpp-dashboard` = `prj_HQsOhCJALxcVutbXs595EJjQVS8U` (sin usar por ahora). Con esto se puede
  listar deployments/logs de build sin navegador (`list_deployments`, `get_deployment`).
- **GitHub MCP: BLOQUEADO, no es un problema de sesión.** Causa real (corregido 2026-07-10):
  la red corporativa de Grupo RPP bloquea la conexión, y activar el conector requiere permisos
  de administrador que el usuario no tiene — no se soluciona abriendo un chat nuevo. (Nota
  histórica: el 2026-07-07 se pensó que era un problema de que los conectores cargan tools
  solo al arrancar sesión; esa hipótesis quedó descartada.) Mientras tanto, GitHub se opera con
  `git push` (código) + navegador (workflows/secrets), que es el flujo que se ha usado en toda
  la sesión y funciona bien.

### Pendientes
- **Alertas Etapa 3 (Teams/WhatsApp):** definir `SECTION_RESPONSIBLES` (canal por
  sección). Hasta entonces las alertas quedan solo en Supabase/dashboard. (El
  usuario lo dejó para el final.)
- **`SERPAPI_KEY` (RESUELTO):** configurada en GitHub Secrets, confirmada en logs
  de corridas reales (`SERPAPI_KEY: ***` presente en el env del workflow).
- **Filtrar no-artículos (RESUELTO):** solo se considera contenido editorial de rpp.pe lo
  que matchea `-(noticia|live)-<id>` (notas + coberturas en vivo tipo minuto-a-minuto).
  Se descarta home, homes de sección (`/deportes`), landings/herramientas
  (`/calculadora-...`, `/simulador-...`), buscador, `/ultimas-noticias`, `/tv-vivo`,
  `/audio/en-vivo`, listados `/noticias/...` y el widget `experiences.mrf.io`. Filtro
  aplicado en DOS lenguajes (deben coincidir): `agent/article_filter.py` (Python — extraído
  de `run_morning.py` el 2026-07-10 para que `collectors/rpp_own_feed.py` lo reuse sin
  import circular; usado por `run_morning.py` y ahora también por la cobertura RPP) y
  `isRealArticle` en `TraficoClient.tsx` (dashboard, TS). Si aparece un tipo de contenido con otro sufijo (video,
  galería…), ampliar el regex en ambos.
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
│                                       trafico, busqueda, auditoria, alertas
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
  El intervalo es **65s** (con 60s justos la API igual devolvía 429).
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

### Google Search Console (FUNCIONANDO desde 2026-07-06)
- Service account (secreto `GSC_CREDENTIALS_JSON`) añadida como usuario en la
  propiedad por el admin de GSC. El email a añadir es el `client_email` del JSON
  (termina en `.iam.gserviceaccount.com`), NO un gmail.
- **Gotcha de propiedad:** pedir `https://rpp.pe/` daba 403; `sc-domain:rpp.pe`
  también. La solución fue **auto-detectar**: `_resolve_site_url()` en `gsc.py`
  llama `sites().list()`, loguea las propiedades visibles (diagnóstico definitivo
  de permisos) y usa la de rpp.pe (dominio > prefijo). `GSC_SITE_URL` por env
  fuerza una propiedad específica; vacío = auto-detección (default).
- Con esto `gsc_daily` se puebla y /busqueda muestra quick wins, CTR bajo
  y top queries.
- **Frescura (fix 2026-07-07):** la ventana del collector termina AYER (hoy-1),
  no hoy-2: con `dataState: "all"` Google entrega data fresca (parcial) de hasta
  ayer. Con hoy-2 el dashboard mostraba partidos de hace 3-5 días como actuales.
- **Modelo de datos gsc_daily (clave para no romperlo):** cada corrida guarda un
  SNAPSHOT completo (agregado de la ventana de ~3 días de GSC) con `date` = día
  de corrida, reemplazando la fecha (delete+insert). Las ventanas de días
  consecutivos SE SOLAPAN → el dashboard debe leer SOLO el snapshot más reciente
  (`eq date = max(date)`), nunca `gte` de varios días (duplica todo y revive data
  vieja — bug visto 2026-07-07). Una query puede repetirse legítimamente en el
  snapshot si rankea con varias páginas (dimensiones page+query).
- **Discover conectado (2026-07-09):** `fetch_discover_performance()` existía
  desde antes pero nunca se llamaba. Ahora `run_morning.py` la invoca junto a
  `fetch_search_performance` y ambos resultados se guardan JUNTOS en
  `gsc_daily`, distinguidos por la columna `search_type` (`"web"` default vs
  `"Discover"`). **Importante:** las queries del dashboard que leen `gsc_daily`
  para quick wins/low CTR/top queries deben filtrar `.eq("search_type", "web")`
  explícitamente, o mezclan filas de Discover (que no traen `query` ni
  `position`) — ya aplicado en `dashboard/app/(dashboard)/busqueda/page.tsx`.

### SerpApi (conectado 2026-07-09 — complementa a GSC, no lo reemplaza)
- **División del trabajo:** GSC mide el pasado medido de rpp.pe (clics/
  impresiones/posición reales, con 1+ día de rezago); SerpApi mira el SERP en
  vivo, cualquier dominio, y expone lo que GSC no puede (featured snippet,
  People Also Ask, carrusel de noticias). No tiene sentido usar SerpApi para
  medir tráfico propio — para eso ya está GSC.
- **Presupuesto:** `SERPAPI_DAILY_LIMIT = 10`/día (`config.py`, free tier). En
  vez de gastarlo en todas las keywords del radar, `collect_serp_opportunities()`
  en `run_morning.py` lo gasta SOLO en las quick wins de GSC (posición 4-10, ya
  priorizadas por impresiones), hasta `SERPAPI_QUERIES_PER_RUN = 8` por corrida
  (margen bajo 10 por si el benchmark se re-corre el mismo día). Corre 1
  vez/día (dentro de `run_morning.py`), no en el radar.
- Usa `serpapi.fetch_serp_features(query)` (ya existía en `collectors/serpapi.py`,
  no se tocó) → featured snippet + PAA + top stories + image/local pack. Se
  guarda en la tabla nueva `serp_opportunities` (delete+insert por fecha, mismo
  patrón que `gsc_daily`), marcando `rpp_has_snippet`/`rpp_in_top_stories` si
  `SITE_DOMAIN` aparece en la fuente del snippet o en los links del carrusel.
- Rules-first: sin `SERPAPI_KEY` en el entorno, `collect_serp_opportunities`
  devuelve `[]` de inmediato — no rompe el resto del benchmark.
- **Pendiente del usuario:** pegar `SERPAPI_KEY` en GitHub Secrets (el
  workflow `morning.yml` ya lo referencia desde antes). Sin eso, la sección
  "Oportunidades en el SERP" del dashboard queda vacía.

### Google Trends
- **pytrends NO funciona desde GitHub Actions** (bloqueo por IP de datacenter).
- Se usa el feed RSS oficial **`https://trends.google.com/trending/rss?geo=PE`**
  (el endpoint clásico `/trends/trendingsearches/daily/rss` da 404). Devuelve ~10
  tendencias con `ht:approx_traffic`. El `growth_score` (0-10) sale de ese tráfico.

### Competencia
- El Comercio y Gestión usan su RSS `arcio` directo. La República, Peru21 e Infobae
  usan **Google News RSS por dominio** (`news.google.com/rss/search?q=when:1d site:...`)
  porque sus feeds propios cambiaron/fallan.
- **Categorización con LLM (2026-07-10):** las reglas por keyword clasificaban
  mal muchos titulares (nombres propios: "Canal 5 y TUDN…" → política, Haaland →
  política). `provider.categorize_articles(articles, categories)` re-categoriza
  con el LLM en lotes de 40 títulos únicos (rules-first: sin proveedor conserva
  la categoría por reglas). Corre SIEMPRE tras recolectar competencia, en
  morning y radar.
- **Guardado idempotente (gotcha):** `save_competitor_articles` hace upsert real
  `on_conflict="url"` (NO `ignore_duplicates=True`). Con ignore_duplicates un
  artículo ya visto quedaba con su primera categoría para siempre — la
  re-categorización del LLM no se propagaba a URLs ya guardadas.

### Cobertura RPP (2026-07-10) — ¿RPP ya publicó lo que publicó la competencia?
- **Objetivo:** por cada titular de competencia, badge "✓ Publicado en RPP" /
  "⚠ Pendiente" en el dashboard. "Pendiente" = brecha (la competencia lo cubre,
  RPP no).
- **Fuente de lo propio:** `collectors/rpp_own_feed.py` lee el RSS oficial
  `https://rpp.pe/rss` (~60 items, ~48 en 5h). **No Marfeel:** Marfeel mide
  tráfico, una nota recién publicada con pocas visitas no aparece; el RSS lista
  lo último sin ese sesgo. `/sitemap-news.xml` devuelve HTML (soft-404), no usar.
- **Matching (`analyzers/coverage.py`):** rules-first (solapamiento de tokens
  ponderado por IDF sobre los titulares de RPP, umbral ≥2 tokens y score ≥2.5) +
  refinamiento LLM (`provider.match_coverage` → `openrouter.match_coverage`,
  devuelve por titular el índice de la nota de RPP que lo cubre o -1). El LLM
  corrige lo que las reglas confunden por tokens genéricos (p.ej. "precio del
  euro" vs "precio del dólar" comparten precio/perú/julio → las reglas matchean,
  el LLM no). Rules-first da un badge a TODOS aunque el LLM no esté.
- **Solo en el radar, no en el morning:** la competencia del morning es de 24h y
  el feed propio de 5h → comparar ventanas tan distintas marca "pendiente" notas
  que RPP cubrió hace >5h. En el radar ambas ventanas (~6h vs 5h) coinciden.
- **Tope de costo:** `RPP_COVERAGE_LLM_MAX=60` (config, por env) — solo los 60
  titulares más recientes van al LLM (≈3 llamadas, chunk 25 en `provider.py`);
  el resto queda con rules-first. Con la categorización (que también gasta),
  días activos pueden rozar el límite free de OpenRouter (~50 req/día) — es el
  argumento para un modelo de pago/mejor.
- **Filtro editorial compartido:** `is_real_article` se movió de `run_morning.py`
  a `agent/article_filter.py` (módulo nuevo) para que `rpp_own_feed` lo reuse sin
  import circular. El dashboard mantiene su copia en TS (`isRealArticle` en
  `TraficoClient`): si cambia el regex, actualizar AMBOS.

### Scoring 0-100
- `SCORE_WEIGHTS` (suman 100): market_trend 30, competition_gap 20, rpp_relevance 15,
  discover_potential 15, time_sensitivity 10, own_momentum 10.
- Cada dimensión se normaliza 0-1 y se pondera. `learning` = multiplicadores por
  dimensión (de `scoring_weights`, aprendizajes de la mañana).
- Urgencia: INMEDIATO ≥80, HOY ≥60, ESTA SEMANA ≥40, si <40 → DESCARTAR (se filtra).
- **Secciones reemplazan a "programas".** `assign_section(category, sections)` mapea la
  categoría a una sección real de rpp.pe (dimensión `section` de Marfeel).

### Auditoría SEO on-page (`onpage_audit.py`)
- Corre en el benchmark matutino sobre notas donde rinde optimizar: quick-wins
  de GSC (con su keyword), CTR bajo de GSC, y top de ayer de Marfeel.
- `parse_article` (BeautifulSoup) extrae señales on-page; `audit_article` emite
  issues con severidad (high/med/low) y un score 0-100.
- **Split editorial vs plataforma (clave):** cada issue tiene `class`.
  - `editorial` (lo arregla el redactor): title, meta desc, H1, H2, profundidad,
    keyword en intro/H1/meta, enlazado interno, alt, freshness. **Solo esto cuenta
    para el score por nota.**
  - `platform` (sistémico, CMS/plantilla; lo arregla dev/SEO): og:image <1200
    (RPP declara 860px → pierde Discover), canonical, structured_data, social
    (og/twitter). El dashboard los muestra **agregados una sola vez** ("Pendientes
    técnicos del sitio"), no repetidos por nota, y NO penalizan el score.
  - Motivo: al validar, esos checks salían en el 100% de las notas (son de
    plantilla) e inflaban el ruido; separarlos hace que el score priorice de
    verdad. La regla de `slug` se quitó (rpp usa slugs 70-140c por diseño; ruido).
- `save_onpage_audits` borra por `audited_date` y reinserta (re-correr reemplaza).

### Supabase
- **Usar `supabase==2.31.0` + `httpx>=0.26`.** Versiones viejas dan
  `Client.__init__() got an unexpected keyword argument 'proxy'` y bloquean la escritura.
- Tablas con RLS + política `public_read` (`SELECT USING true`). Dashboard usa anon key
  (lectura), agente usa service_role (escritura).
- **REGLA para saves (aprendida 2026-07-07): todo snapshot debe ser idempotente
  por fecha** — borrar la fecha y reinsertar (o upsert por clave natural), NUNCA
  insert append-only. Un append-only + re-correr el workflow duplicó gsc_daily ×5
  (Search Console mostraba todo repetido). Únicas excepciones: tablas de EVENTOS
  (`alerts`). Patrones vigentes: delete+insert (gsc_daily, own_traffic,
  daily_trends, own_traffic_channels, recommendations, onpage_audits,
  daily_insights, scoring_weights) · upsert (competitor_articles por url,
  content_decay por page_path, publishing_windows por fecha).

### Dashboard Next.js
- App Router + RSC. `export const revalidate = 60` en todas las páginas (el radar
  actualiza cada ~10 min; 1h de ISR era demasiado stale).
- Nueva página `/auditoria` (onpage_audits). Home muestra "Aprendizajes de hoy"
  (daily_insights). recomendaciones/home usan `section` y score `/100`.
- **Zona horaria (gotcha):** los Server Components renderizan en el runtime de Vercel
  (UTC). Al mostrar horas hay que forzar `timeZone: "America/Lima"` en
  `toLocaleTimeString`/`toLocaleString`, o se ven ~5h adelantadas. Ya aplicado en
  `competencia/CompetenciaClient.tsx` (hora de artículos) y `page.tsx` (última
  actualización). La data en Supabase siempre está en UTC con tz — el ajuste es SOLO de display.
- **`/competencia` (client component):** navegador de medios a la izquierda (TODOS + cada
  medio con conteo y favicon), ventana única con las notas, identificador con logo (favicon
  vía `google.com/s2/favicons`, fallback a inicial de color) por nota, y chips de categoría
  clicables. Filtrado cruzado tipo facetas (medio ↔ categoría). `page.tsx` solo hace fetch.
- **Diseño visual "RPP Digital" (2026-07-07):** header amarillo (`bg-rpp-yellow`
  `#F5D414`) con nav en pills (`components/NavPills.tsx`, detecta ruta activa vía
  `usePathname` — antes no existía esa detección), tipografía Inter (`next/font/google`
  en `app/layout.tsx`). Tokens en `tailwind.config.ts`: `rpp-yellow`/`rpp-ink`
  (`#111827`)/`rpp-teal` (`#0D9488`). **Rojo se reserva para semántica de alerta/crítico**
  (severidad alta, caídas, score bajo); el "activo" de filtros/pills pasa a teal para no
  chocar con el amarillo del header. Tarjetas estandarizadas a `rounded-2xl border
  border-gray-200`.
  - Componentes compartidos nuevos en `dashboard/components/`: `ui/Pill.tsx` (variantes
    `solid`/`accent`/`tag` como `<button>`, más `pillClasses()` exportada para usar
    directo sobre un `<Link>` — **nunca anidar un `<Pill>` dentro de `<Link>`**, sería un
    `<button>` dentro de `<a>` = HTML inválido), `ui/StatCard.tsx` (KPI con acento de
    color vía `border-l-4` inline).
  - `<select>` de filtros (Sección en `/trafico`) migrado a fila de `Pill(variant="solid")`.
  - Mapas de color planos (`URGENCY_COLORS`, `CATEGORY_COLORS`, `SEVERITY_BADGE`, etc.)
    en las páginas migrados a `TagBadge`/`Pill(variant="tag")`, coloreado por hex vía
    `style` (no clases Tailwind dinámicas — evita problemas de purge en build).
  - **Nota de entorno:** este proyecto no tiene Node/npm instalable en el sandbox de
    Claude Code (Bash y `preview_start` no lo encuentran) — no se puede `npm run build`
    ni levantar dev server local para verificar. La verificación real ocurre en el build
    de Vercel (que sí tiene Node) tras el push; usar el Vercel MCP
    (`list_deployments`/`get_deployment_build_logs`) para confirmar `state: "READY"`.
- **Tooltips informativos (2026-07-10):** `components/ui/InfoTooltip.tsx` — ícono "?"
  junto al título y secciones core de las 8 pestañas, con panel explicativo por
  hover (desktop) o tap (touch). Implementado con un portal a `document.body` +
  `position: fixed` (no `position: absolute` dentro de la tarjeta): varias tarjetas
  usan `overflow-hidden` y el panel se recortaba, sobre todo en estados "Sin datos"
  con la tarjeta casi vacía. Cierre por click-fuera, `Escape`, o scroll/resize.
  `StatCard` acepta prop `info` para mostrarlo junto al KPI.
- **Informativo de cadencia + última actualización (2026-07-10):**
  `components/ui/LastUpdated.tsx` — bloque en el header de cada pestaña con (a)
  cadencia legible ("cada ~10 min" para pestañas del radar, "1 vez al día" para
  las del morning) y (b) hora exacta (no solo fecha) de la última corrida, vía
  `lib/lastRun.ts` → `getLastRunFinishedAt(kind)` que lee `agent_runs` filtrando
  por la columna `kind` ("morning"|"radar", nueva — con backfill de los
  registros históricos por sus `sources_ok`). Mapeo: recomendaciones/tendencias/
  competencia/alertas → radar; tráfico/búsqueda/auditoría → morning; home → mixed
  (usa el último run de cualquier tipo). En los client components (competencia,
  tráfico) el `page.tsx` hace el fetch y pasa `lastRun` como prop.

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
| `competitor_articles` | radar/morning (upsert por url; radar añade cobertura RPP) | dashboard competencia |
| `recommendations` | radar (borra+reinserta por fecha) | dashboard recomendaciones, home |
| `alerts` | radar | dashboard alertas |
| `own_traffic` | morning | dashboard trafico (fallback), decay |
| `own_traffic_channels` | morning (borra+reinserta por fecha) | dashboard trafico (canal + folder) |
| `gsc_daily` | morning | dashboard search-console |
| `content_decay` | morning (upsert page_path) | dashboard alertas |
| `daily_insights` | morning (borra+reinserta) | dashboard home |
| `scoring_weights` | morning | radar (lee aprendizajes) |
| `onpage_audits` | morning | dashboard auditoria |
| `serp_opportunities` | morning (borra+reinserta, solo si hay `SERPAPI_KEY`) | dashboard busqueda |
| `publishing_windows` | (reusable) | dashboard home |
| `agent_runs` | ambos (con `kind`: "morning"\|"radar") | dashboard home (semáforo) + "última actualización" por pestaña |

---

## Variables de entorno

### Agente Python (GitHub Secrets)
```
MARFEEL_EMAIL          → pdigitalrpp@gmail.com                 [✅ configurado]
MARFEEL_PASSWORD       → password de API de Marfeel            [✅ configurado]
SUPABASE_URL           → https://tfrnpjbvxulswvqtosoq.supabase.co  [✅ configurado]
SUPABASE_KEY           → service_role key (NO la anon)         [✅ configurado]
GSC_CREDENTIALS_JSON   → service account de Google             [✅ configurado]
SERPAPI_KEY            → clave de serpapi.com                  [⏳ pendiente, opcional]
```

### Dashboard (Vercel) — todas ✅ configuradas
```
NEXTAUTH_URL, NEXTAUTH_SECRET
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
PASS_EDITORIAL / PASS_DIRECCION / PASS_ADMIN   (contraseñas temporales: <rol>2026)
```

---

## Fase 2 — capa LLM (OpenRouter preferido desde 2026-07-10, Bedrock y Gemini como fallback)

**Estado (2026-07-10): VERIFICADO EN PRODUCCIÓN.** La capa LLM está
implementada y funcionando con OpenRouter (modelo Tencent Hy3, gratis) como
proveedor real. `agent/llm/provider.py` es un facade que los orquestadores
importan (`from llm import provider as llm`) en vez de un cliente específico;
internamente elige **OpenRouter si hay `OPENROUTER_API_KEY`, si no Bedrock si
hay credenciales AWS, si no Gemini, si no reglas**. Cambiar de proveedor o
añadir uno nuevo no toca `run_morning.py` ni `run_radar.py`, solo `provider.py`.
Corridas reales confirmadas: `✅ LLM categorizó 177/177 titulares de
competencia`, `✅ LLM categorizó 10/10 temas` (radar, 2026-07-10). El log de
diagnóstico `🔑 Proveedores LLM detectados: openrouter=True bedrock=True
gemini=False` confirma qué credenciales llegaron al workflow (útil si algún
día vuelve a fallar en silencio).

**Por qué OpenRouter reemplaza a Bedrock como preferido:** Bedrock nunca llegó
a responder en producción — los 3 IDs de modelo Claude probados (Sonnet v1,
v2, Haiku default) dieron `ResourceNotFoundException`, la cuenta AWS del
usuario tiene los Claude de generación 3 marcados Legacy/sin acceso activo
(requeriría reactivar model access en la consola AWS, pendiente). Bedrock y
Gemini se dejaron en el facade como fallback en cadena (no cuesta nada
mantenerlos, rules-first) mientras eso no se resuelva.

**Lo que ya existe (no reescribir):**
- `agent/llm/provider.py` — facade/selector, ver arriba.
- `agent/llm/openrouter.py` — cliente REST (requests, formato OpenAI Chat
  Completions, `POST {OPENROUTER_BASE_URL}/chat/completions`). `is_enabled()`
  por `OPENROUTER_API_KEY`. Modelo por `OPENROUTER_MODEL`, default
  `tencent/hy3:free` (295B MoE, 21B activos, **gratis en OpenRouter solo del
  2026-07-06 al 2026-07-21** — si la promo termina o el modelo deja de estar
  disponible, cambiar `OPENROUTER_MODEL` por env sin tocar código; ver catálogo
  en openrouter.ai/models).
- `agent/llm/bedrock.py` — cliente boto3 (`bedrock-runtime.invoke_model`,
  Anthropic Messages API). `is_enabled()` por `AWS_ACCESS_KEY_ID` +
  `AWS_SECRET_ACCESS_KEY`. Modelo por `BEDROCK_MODEL_ID` (default Claude 3
  Haiku; bloqueado hoy, ver arriba).
- `agent/llm/gemini.py` — cliente REST (requests, sin SDK), sigue intacto como
  último fallback. `GEMINI_MODEL` overrideable por env (default gemini-2.0-flash).
- **A) Categorización (radar):** `categorize_topics(keywords, categories)` — 1
  llamada batch para los ~10 trends. Enchufada en `run_radar.py` vía el
  facade; `scoring.py` respeta `item["category"]` pre-asignada. Arregla
  "haaland → otros".
- **B) Reescritura (auditoría):** `rewrite_onpage_batch(items)` — 1 llamada batch
  para todas las notas con issues editoriales. Enchufada en `run_morning.py`
  vía el facade; se guarda en `onpage_audits.suggestions` (jsonb) y el
  dashboard la muestra como "✨ Sugerencia IA" (título/meta/H2 con contador de chars).
- **C) Cobertura (competencia vs RPP):** `match_coverage(comp_titles, own_titles)`
  — ver sección "Cobertura RPP" más abajo. Solo implementado en
  `openrouter.py`; Bedrock/Gemini no lo tienen (el facade cae a rules-first si
  el proveedor activo no expone el método, vía `getattr`).
- Workflows ya pasan `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`,
  `BEDROCK_MODEL_ID` y `GEMINI_API_KEY`. Todos configurados en GitHub Secrets
  (el usuario pegó `OPENROUTER_API_KEY` el 2026-07-10).
- `requirements.txt` incluye `boto3==1.34.144` (Bedrock); OpenRouter reutiliza
  `requests`, ya presente por Gemini — sin dependencias nuevas.

**Gotcha real de producción — Tencent Hy3 es un modelo razonador (fix
2026-07-10):** el primer run real dio `finish_reason=length` y `content` vacío
en TODAS las llamadas de categorización: el modelo gasta el mismo presupuesto
de `max_tokens` "pensando" antes de escribir la respuesta, y con lotes de
~80-100 ítems se quedaba sin tokens a mitad de razonamiento (nunca llegaba al
JSON). El fix NO fue subir `max_tokens` a lo bruto sino enviar
`"reasoning": {"effort": "low", "exclude": true}` en el body (parámetro
unificado de OpenRouter, ver openrouter.ai/docs/guides/best-practices/
reasoning-tokens) — limita el razonamiento y lo excluye de la respuesta. Se
combinó con bajar `_ARTICLE_CHUNK` de 100 a 40 (provider.py) y subir
`max_tokens` de categorización a 6000. **Importante:** el campo `reasoning`
que devuelve la API NUNCA es la respuesta pedida (es el monólogo interno
truncado) — no usarlo como fallback si `content` viene vacío, es el error que
se cometió y corrigió en el primer intento de fix.

**Gotcha de red (importante para probar localmente):** la red corporativa de
Grupo RPP bloquea `openrouter.ai` puntualmente (confirmado: otros dominios en
Cloudflare como discord.com/anthropic.com sí responden, solo openrouter.ai da
timeout de conexión). No probar `openrouter.py` desde un sandbox/máquina en la
red de RPP — el workflow de GitHub Actions corre en infraestructura de
GitHub, sin esa restricción, y ahí sí funciona (verificado).

### Análisis de consumo de la API (2026-07-08)
Volumen real medido (no teórico): el cron del radar NO cumple los `*/10 min`
— GitHub Actions lo retrasa/saltea en repos poco activos, así que en la
práctica corre **~4-6 veces/día**, no ~114. Con eso: `categorize_topics`
~4-6 llamadas/día, `rewrite_onpage_batch` 1/día → **~5-7 llamadas lógicas/día**.
No es un problema de volumen bruto.

**Dónde sí hay desperdicio (si algún día hay quota real que cuidar):**
1. `_generate()` en `gemini.py:30` reintenta 2 veces más en 429 (`retries=2`,
   backoff 12s/24s) — con `limit:0` el 429 es inevitable, así que cada llamada
   lógica cuesta **3 requests reales** y ~36s perdidos por corrida.
2. Sin caché: el feed de Trends apenas cambia entre corridas consecutivas
   (verificado: `daily_trends` de un día completo trae hasta 44 keywords con
   alto solape) y se re-clasifica la lista completa cada vez.
3. `categorize_topics` manda TODAS las keywords a Gemini, incluidas las que
   `_infer_category_from_keyword` (reglas) ya resuelve bien.

**Recordatorio clave:** el bloqueo es `limit: 0` (cero cuota gratuita en ese
proyecto de Google), no una cuota baja — bajar el consumo NO destraba el
free tier. Solo lo destraba habilitar billing en ese proyecto de Google Cloud
o usar una key de otro proyecto/cuenta con free tier real.

**Opciones de optimización (si llega una key funcional y el costo importa),
de mayor a menor impacto:** (1) caché `keyword→categoría` en Supabase con TTL
~24h, solo mandar a Gemini las keywords nuevas; (2) enviar a Gemini solo lo
que las reglas no resuelven ("otros"); (3) no reintentar en 429 (dejar que la
siguiente corrida del radar sea el reintento natural); (4) `GEMINI_MODEL=
gemini-2.0-flash-lite` por env, sin tocar código; (5) throttle explícito
(1 categorización/hora) si el cron algún día corre más seguido de verdad.
Ninguna implementada aún — quedó como informe, pendiente de decisión del
usuario sobre cuál aplicar.
morning = 1 call/día. Volumen mínimo; batch SIEMPRE (aprendido: por-nota saturó
el rate limit).

---

## Contexto RPP

- **SITE_URL:** `https://rpp.pe/` · **Zona horaria:** America/Lima (UTC-5, sin DST)
- **Categorías** (sin tilde, claves de `CATEGORY_KEYWORDS`): politica, economia, deportes,
  entretenimiento, tecnologia, salud, mundo, otros.
- **Secciones** reales salen de la dimensión `section` de Marfeel (fallback en `KNOWN_SECTIONS_FALLBACK`).
- Umbral decay 20%, alerta GSC 30%, quick wins pos 4-10 con ≥200 impresiones, low CTR ≤2% con ≥500.
```
