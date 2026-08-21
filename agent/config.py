import os

SITE_URL = "https://rpp.pe/"
SITE_DOMAIN = "rpp.pe"

# Feed propio de RPP (qué acaba de publicar rpp.pe, sin sesgo de tráfico).
# Se usa para comparar contra la competencia y marcar cobertura
# (rpp_has_coverage) en el dashboard. Validado 2026-07-10: RSS 2.0, ~60 items,
# ~48 dentro de 5h. El endpoint /sitemap-news.xml devuelve HTML (soft-404).
RPP_RSS_URL = "https://rpp.pe/rss"
# Ventana de comparación de cobertura (horas). El feed cubre ~20h, así que 5h
# entra holgado; es el mismo horizonte que pidió el equipo editorial.
RPP_OWN_WINDOW_HOURS = int(os.environ.get("RPP_OWN_WINDOW_HOURS", "5"))
# Tope de titulares de competencia que se mandan al LLM para el match de
# cobertura por corrida (los más recientes). TODOS reciben match por reglas; el
# LLM solo refina hasta este tope, para no agotar la cuota free de OpenRouter
# (~50 req/día). 60 titulares ≈ 3 llamadas (chunk 25). Los demás quedan con el
# match por reglas, que ya da un badge razonable.
RPP_COVERAGE_LLM_MAX = int(os.environ.get("RPP_COVERAGE_LLM_MAX", "60"))

# Propiedad de Search Console. Vacío = auto-detectar: el collector lista las
# propiedades a las que la service account tiene acceso (sites().list) y elige
# la que corresponda a rpp.pe (prefiere dominio "sc-domain:rpp.pe" sobre
# prefijo "https://rpp.pe/"). Setear GSC_SITE_URL por env para forzar una.
GSC_SITE_URL = os.environ.get("GSC_SITE_URL", "")

# ---------------------------------------------------------------------------
# Marfeel (reemplaza a GA4 como fuente de tráfico/audiencia)
# Auth: POST signin {email, password} -> bearer token (válido ~14 días).
# Datos: POST query. LÍMITE DURO: 1 request por minuto, 500 filas máx.
# ---------------------------------------------------------------------------
MARFEEL_SIGNIN_URL = "https://api.newsroom.bi/api/user/signin"
MARFEEL_QUERY_URL  = "https://api.newsroom.bi/api/dashboard/query"
MARFEEL_EMAIL      = os.environ.get("MARFEEL_EMAIL", "")
MARFEEL_PASSWORD   = os.environ.get("MARFEEL_PASSWORD", "")
MARFEEL_MIN_INTERVAL_SECONDS = 65   # rate-limiter: 1 req/min (65s: con 60 justos la API igual devolvía 429)
MARFEEL_MAX_ROWS             = 500

# ---------------------------------------------------------------------------
# Competidores monitoreados (RSS, con fallback a sitemap-news.xml)
# ---------------------------------------------------------------------------
# El Comercio y Gestión funcionan con su RSS directo. Los otros 3 cambiaron de
# feed (RSS vacío / sitemap 404-403), así que usan Google News RSS por dominio,
# que es estable y trae las notas recientes de cada medio.
_GNEWS = "https://news.google.com/rss/search?q=when:1d%20site:{site}&hl=es-419&gl=PE&ceid=PE:es-419"
COMPETITOR_SITES = [
    {"name": "El Comercio",  "rss": "https://elcomercio.pe/arcio/rss/"},
    {"name": "Gestión",      "rss": "https://gestion.pe/arcio/rss/"},
    {"name": "La República", "rss": _GNEWS.format(site="larepublica.pe")},
    {"name": "Peru21",       "rss": _GNEWS.format(site="peru21.pe")},
    {"name": "Infobae Perú", "rss": _GNEWS.format(site="infobae.com/peru")},
]

# ---------------------------------------------------------------------------
# Secciones de rpp.pe
# La taxonomía REAL se deriva en runtime de la dimensión `section` de Marfeel
# (collectors/marfeel.py -> fetch_sections). Esta lista es solo fallback.
# SECTION_RESPONSIBLES enruta las alertas de la Etapa 3 (se define luego).
# ---------------------------------------------------------------------------
KNOWN_SECTIONS_FALLBACK = [
    "politica", "economia", "deportes", "mundo", "actualidad",
    "lima", "peru", "tecnologia", "salud", "entretenimiento",
    "cine-series", "musica", "viral",
]
SECTION_RESPONSIBLES = {
    # "politica": {"channel": "teams", "webhook": "", "team": ""},
    # se completará cuando el usuario defina responsables por sección
}

# ---------------------------------------------------------------------------
# Keywords para inferir categoría de un tema (Trends / competencia)
# ---------------------------------------------------------------------------
CATEGORY_KEYWORDS = {
    "politica":        ["congreso","gobierno","presidente","ministro","elección","partido","municipio","alcalde","premier"],
    "economia":        ["economía","pbi","inflación","dólar","tipo de cambio","bcr","mef","empresa","mercado","bolsa"],
    "deportes":        ["fútbol","sport","sporting","alianza","universitario","selección","copa","mundial","gol","liga"],
    "entretenimiento": ["música","cine","serie","película","artista","concierto","show","baile","televisión","farándula"],
    "tecnologia":      ["tecnología","inteligencia artificial","ia","app","startup","celular","google","meta","openai"],
    "salud":           ["salud","médico","hospital","vacuna","covid","enfermedad","minsa","clínica","tratamiento"],
    "mundo":           ["eeuu","trump","estados unidos","brasil","argentina","chile","venezuela","colombia","mundo"],
}

GOOGLE_TRENDS_CATEGORIES = {
    "noticias":        16,
    "politica":        396,
    "entretenimiento": 3,
    "deportes":        20,
    "economia":        7,
}

# ---------------------------------------------------------------------------
# Scoring 0-100 — pesos por dimensión (deben sumar 100)
# ---------------------------------------------------------------------------
SCORE_WEIGHTS = {
    "market_trend":        30,   # fuerza de la tendencia (Google Trends)
    "competition_gap":     20,   # cuántos competidores lo cubren / gap
    "rpp_relevance":       15,   # afinidad con secciones core de rpp.pe
    "discover_potential":  15,   # potencial en Google Discover
    "time_sensitivity":    10,   # urgencia temporal del tema
    "own_momentum":        10,   # tracción en tiempo real de contenido afín (Marfeel)
}

# Umbrales de urgencia sobre el score 0-100
URGENCY_THRESHOLDS = {
    "INMEDIATO":    80,
    "HOY":          60,
    "ESTA SEMANA":  40,
    # < 40 -> DESCARTAR
}

# Etapa 3 — alertas en tiempo real (ver analyzers/alerting.py).
# La alertabilidad es un score PROPIO (0-100), distinto del score de
# recomendación: mide "¿hay una noticia rompiendo ahora?" a partir de la
# evidencia de noticias + rank de Trends + términos de urgencia, NO del
# approx_traffic. El viejo ALERT_SCORE_THRESHOLD=75 sobre el score de
# recomendación dejaba la sección vacía días enteros (solo cruzaban deportes
# grandes); se reemplazó por estos umbrales, calibrados con datos reales.
ALERT_WORTHINESS_THRESHOLD     = 55   # alerta si la alertabilidad >= esto
ALERT_SEVERITY_HIGH            = 78   # >= esto → severidad "alta", si no "media"
ALERT_MAX_PER_SECTION_PER_HOUR = 3    # anti-spam por sección/hora
ALERT_DEDUP_HOURS              = 12   # no re-alertar el mismo evento en esta ventana

# ---------------------------------------------------------------------------
# Vigilancia de temas por keyword ("Google Alerts" propias) — 2026-08-20
# Ver collectors/watchlist.py. Las keywords NO viven acá: se administran desde
# el dashboard (tabla watch_keywords). Esto son solo los parámetros del
# recolector.
#
# Por qué existe: las alertas de Trends (analyzers/alerting.py) solo pueden ver
# el top ~10 nacional de búsquedas del día. Un tema de nicho pero editorialmente
# valioso — un concierto que se anuncia, una empresa, un vocero — nunca cruza
# ese umbral y hoy es invisible para el agente.
# ---------------------------------------------------------------------------
# Ventana de la query de Google News. Se deja en 1 día (no 1 hora) A PROPÓSITO:
# el cron de GitHub Actions se retrasa y saltea (medido: el radar corre 5-7
# veces/día con gaps de 2-5h, ver CLAUDE.md), así que una ventana corta perdería
# publicaciones en cada hueco. La ventana amplia + el dedup por URL de
# watch_hits hace que re-ver lo mismo sea gratis y no se pierda nada.
WATCH_NEWS_WINDOW = os.environ.get("WATCH_NEWS_WINDOW", "1d")
# Tope de keywords activas que se consultan por corrida (1 request RSS c/u).
WATCH_MAX_ACTIVE_KEYWORDS = int(os.environ.get("WATCH_MAX_ACTIVE_KEYWORDS", "25"))
# Tope de resultados por keyword y por fuente en cada corrida.
WATCH_MAX_HITS_PER_KEYWORD = int(os.environ.get("WATCH_MAX_HITS_PER_KEYWORD", "10"))
# Antigüedad máxima de una publicación para considerarla un hallazgo. Sin esto,
# al dar de alta una keyword nueva entraría todo lo del último día de golpe.
WATCH_MAX_AGE_HOURS = int(os.environ.get("WATCH_MAX_AGE_HOURS", "36"))

# Feeds RSS DIRECTOS que se escanean completos y se cruzan contra TODAS las
# keywords activas. Son las fuentes primarias del anuncio: publican el evento
# ANTES de que ningún medio escriba sobre él, así que son la mitad del sistema
# que gana tiempo real frente a Google News.
# Formato: {"name": "Etiqueta legible", "url": "https://…/feed"}.
#
# IMPORTANTE — cómo se filtran: a diferencia de Google News (que matchea contra
# el cuerpo del artículo), estos feeds se filtran por TITULAR contra la keyword.
# Por eso rinden con keywords tipo ENTIDAD ("shakira", "estadio nacional") —
# ahí sí matchea "SHAKIRA EN LIMA" apenas Teleticket publica la página. Las
# keywords tipo TEMA ("concierto en lima") las cubre Google News.
#
# Solo feeds VERIFICADOS (2026-08-20): un feed muerto se loguea como warning y
# se ignora, pero ensucia el log en cada corrida. Para una fuente que solo
# interesa a UNA keyword, usar su campo `extra_feeds` desde el dashboard en vez
# de esta lista global.
#
# Las 4 ticketeras principales del país. Solo Ticketmaster Perú se lee por su
# RSS nativo; las otras tres van por búsqueda `site:` en Google News, el mismo
# recurso que usa COMPETITOR_SITES para los medios cuyo RSS murió:
#   · Teleticket y Passline no tienen feed propio (`/feed` → 404, `/rss` → 403).
#   · Joinnus SÍ publica RSS 2.0 válido en blog.joinnus.com/feed, pero desde
#     GitHub Actions devuelve 0 items — bloqueo por IP de datacenter, igual que
#     pytrends. Se confirmó que un UA de navegador NO lo destraba (corridas
#     #712 y #713 siguieron en Joinnus=0). Vía Google News trae 50 items.
# Cambiar esto sin medir el conteo por feed que loguea el collector es
# retroceder: fue ese conteo el que hizo visible el 0 silencioso de Joinnus.
_GNEWS_SITE = (
    "https://news.google.com/rss/search?q=site:{site}%20when:2d"
    "&hl=es-419&gl=PE&ceid=PE:es-419"
)
WATCH_PRIMARY_FEEDS = [
    {"name": "Ticketmaster Perú", "url": "https://blog.ticketmaster.pe/feed"},
    {"name": "Joinnus",           "url": _GNEWS_SITE.format(site="joinnus.com")},
    {"name": "Teleticket",        "url": _GNEWS_SITE.format(site="teleticket.com.pe")},
    {"name": "Passline",          "url": _GNEWS_SITE.format(site="passline.com")},
]

# ---------------------------------------------------------------------------
# SerpAPI (cuota escasa: free tier 100/mes). Mantener bajo.
# Se usa 1 vez/día (benchmark matutino) sobre los quick wins de GSC (posición
# 4-10, ya priorizados): identifica featured snippet / PAA / top stories para
# esas queries. Con margen bajo el límite diario (10) por si el benchmark se
# re-corre manualmente el mismo día.
# ---------------------------------------------------------------------------
SERPAPI_DAILY_LIMIT = 10
SERPAPI_QUERIES_PER_RUN = 8

# ---------------------------------------------------------------------------
# Umbrales de análisis
# ---------------------------------------------------------------------------
DECAY_THRESHOLD          = 0.20   # caída vs pico histórico para content decay
GSC_DROP_ALERT_THRESHOLD = 0.30   # caída de clics 24h vs semana anterior

# Quick wins / low CTR (disparan auditoría on-page)
QUICK_WIN_POS_MIN        = 4.0
QUICK_WIN_POS_MAX        = 10.0
QUICK_WIN_MIN_IMPRESSIONS = 200
LOW_CTR_MAX              = 2.0
LOW_CTR_MIN_IMPRESSIONS  = 500

# ---------------------------------------------------------------------------
# Auditor SEO on-page de notas publicadas
# ---------------------------------------------------------------------------
ONPAGE = {
    "title_min_len":          30,
    "title_max_len":          60,
    "meta_desc_min_len":      120,
    "meta_desc_max_len":      160,
    "min_word_count":         300,
    "min_internal_links":     3,
    "discover_min_img_width": 1200,
    "fetch_timeout_seconds":  15,
    # reglas enriquecidas (v2 del auditor)
    "long_article_words":     700,   # a partir de aquí se espera estructura con varios H2
    "long_article_min_h2":    2,
    "stale_days":             180,   # nota que aún trae tráfico pero lleva medio año sin refresh
}

# ---------------------------------------------------------------------------
# Capa LLM — Google Gemini (fase 2)
# Rules-first sigue siendo la base: si no hay key o falla, el agente cae al
# comportamiento por reglas. Gemini solo AUMENTA la calidad (categorización real,
# reescritura de títulos/metas). Se usa la API REST (no SDK) con requests.
# ---------------------------------------------------------------------------
GEMINI_API_KEY  = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL    = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"
GEMINI_TIMEOUT_SECONDS = 30

# ---------------------------------------------------------------------------
# Capa LLM — Amazon Bedrock (Anthropic Claude). Preferido sobre Gemini cuando
# hay credenciales AWS: a diferencia del free tier de Gemini (limit: 0),
# Bedrock cobra por uso real desde el primer token, sin bloqueo de cuota.
# BEDROCK_MODEL_ID acepta el ID del modelo o un inference profile ARN/ID
# (algunos modelos Claude 3.5/3.7 en Bedrock solo se invocan vía profile,
# p.ej. "us.anthropic.claude-3-5-sonnet-20241022-v2:0" en vez del ID plano).
# Default: Claude 3 Haiku (barato, ampliamente invocable on-demand sin
# inference profile). Cambiar por env si se prefiere más calidad:
#   Claude 3 Sonnet      → anthropic.claude-3-sonnet-20240229-v1:0
#   Claude 3.5 Sonnet     → anthropic.claude-3-5-sonnet-20240620-v1:0 (o el
#                           inference profile "us.anthropic...-v2:0" según región)
#   Claude 3.7 Sonnet     → inference profile "us.anthropic.claude-3-7-sonnet-20250219-v1:0"
#   Claude Opus           → anthropic.claude-3-opus-20240229-v1:0
# ---------------------------------------------------------------------------
AWS_ACCESS_KEY_ID     = os.environ.get("AWS_ACCESS_KEY_ID", "")
AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY", "")
# El workflow siempre define estas dos env vars (aunque el secret no exista,
# GitHub Actions las pasa como cadena vacía) — usar "or" para que el default
# aplique también cuando el secret opcional no está configurado.
AWS_REGION            = os.environ.get("AWS_REGION") or "us-east-1"
BEDROCK_MODEL_ID      = os.environ.get("BEDROCK_MODEL_ID") or "anthropic.claude-3-haiku-20240307-v1:0"

# ---------------------------------------------------------------------------
# Capa LLM — OpenRouter (proveedor preferido desde 2026-07-10, reemplaza a
# Bedrock: la cuenta AWS del usuario tiene los Claude de gen. 3 marcados
# Legacy/sin acceso, Bedrock nunca llegó a responder en producción).
# API REST compatible con OpenAI Chat Completions (POST /chat/completions).
# Modelo default: "openrouter/free" — el router oficial de OpenRouter que
# elige en cada llamada un modelo gratis realmente disponible ahora mismo
# (filtra por las features que pide la llamada). Se llegó acá tras que DOS
# slugs fijos seguidos murieran en producción el mismo día (tencent/hy3:free,
# promo hasta 2026-07-21, y luego meta-llama/llama-3.3-70b-instruct:free,
# también 404 "unavailable for free" — el catálogo free de OpenRouter rota
# más rápido de lo que se puede fijar a mano). Si el router también falla,
# se puede apuntar OPENROUTER_MODEL a un modelo de pago por env, sin tocar
# código — ver catálogo en openrouter.ai/models.
# ---------------------------------------------------------------------------
OPENROUTER_API_KEY  = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL    = os.environ.get("OPENROUTER_MODEL") or "openrouter/free"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_TIMEOUT_SECONDS = 30

# ---------------------------------------------------------------------------
# Capa LLM — OpenAI (proveedor PREFERIDO desde 2026-08-21: key propia del
# usuario). Desplaza a OpenRouter, que pasa a primer fallback.
#
# Por qué se prefiere: con OpenRouter el modelo real lo elegía el router
# `openrouter/free` en cada llamada — corridas de ~11 min (vs ~40s con modelo
# fijo) y algún lote perdido cuando enrutaba a un modelo que respondía prosa
# en vez de JSON. Con key propia el modelo es estable, conocido y factura por
# uso real, así que desaparecen las dos fuentes de ruido.
#
# POR QUÉ EL DEFAULT ES LUNA Y NO TERRA/SOL (decisión medida, 2026-08-21)
# La familia GPT-5.6 son tres modelos de razonamiento con el mismo contexto
# (1.05M) que se diferencian por precio: sol $5/$30, terra $2/$12,
# luna $0.20/$1.20 por millón de tokens (entrada/salida).
# El COSTO de este agente lo domina `categorize_articles`: ~470 titulares de
# competencia por corrida = ~12 de las ~17 llamadas, y es meter titulares en 8
# cajas — la tarea más fácil de las cinco. Las otras cuatro son extracción y
# clasificación con prompts ya calibrados, no razonamiento frontera. Terra
# cuesta 10× Luna por hacer lo mismo.
# Estimado con ~15k tokens de entrada y ~25k de salida por corrida (los tokens
# de razonamiento se facturan como SALIDA): a la cadencia real medida del cron
# (~6 corridas/día) Terra sale ~$60/mes y Luna ~$6/mes; si el cron `*/10`
# llegara a cumplirse, ~$1.100 vs ~$110/mes. Este proyecto figura como $0/mes.
# Todo es rules-first: si el modelo falla, se cae a reglas y no se rompe nada,
# lo que hace rendir todavía menos apostar por el modelo caro.
# Si una tarea concreta decepciona, se sube SOLO esa a terra (hoy el modelo es
# por proveedor; por tarea son pocas líneas más).
#
# OPENAI_MODEL es overrideable por env sin tocar código (misma disciplina que
# OPENROUTER_MODEL, y por la misma razón: los catálogos cambian).
# ---------------------------------------------------------------------------
OPENAI_API_KEY  = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL    = os.environ.get("OPENAI_MODEL") or "gpt-5.6-luna"
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1"
OPENAI_TIMEOUT_SECONDS = 60

# Cuánto puede "pensar" el modelo antes de responder. Acepta
# none|low|medium|high|xhigh|max; el default de OpenAI es `medium`.
# Acá va en "low" A PROPÓSITO: los tokens de razonamiento se facturan como
# salida (la parte cara) y salen del MISMO presupuesto que la respuesta, así
# que razonar de más no solo encarece — puede agotar el presupuesto antes de
# escribir el JSON, que es exactamente cómo se cayó la categorización con
# Tencent Hy3 el 2026-07-10. Las 5 tareas son clasificación/extracción con
# prompts explícitos: no ganan casi nada con más deliberación.
OPENAI_REASONING_EFFORT = os.environ.get("OPENAI_REASONING_EFFORT") or "low"

# Fuerza un proveedor concreto ignorando el orden de preferencia de
# llm/provider.py. Valores: "openai" | "openrouter" | "bedrock" | "gemini".
# Existe para no tener que BORRAR secretos de GitHub: con las keys de OpenAI y
# OpenRouter conviviendo, este switch decide cuál manda, y volver atrás ante un
# problema es cambiar una variable en vez de re-pegar una credencial.
LLM_PROVIDER = (os.environ.get("LLM_PROVIDER") or "").strip().lower()
