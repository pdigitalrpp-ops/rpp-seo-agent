import os

SITE_URL = "https://rpp.pe/"
SITE_DOMAIN = "rpp.pe"

# ---------------------------------------------------------------------------
# Marfeel (reemplaza a GA4 como fuente de tráfico/audiencia)
# Auth: POST signin {email, password} -> bearer token (válido ~14 días).
# Datos: POST query. LÍMITE DURO: 1 request por minuto, 500 filas máx.
# ---------------------------------------------------------------------------
MARFEEL_SIGNIN_URL = "https://api.newsroom.bi/api/user/signin"
MARFEEL_QUERY_URL  = "https://api.newsroom.bi/api/dashboard/query"
MARFEEL_EMAIL      = os.environ.get("MARFEEL_EMAIL", "")
MARFEEL_PASSWORD   = os.environ.get("MARFEEL_PASSWORD", "")
MARFEEL_MIN_INTERVAL_SECONDS = 60   # rate-limiter: 1 req/min
MARFEEL_MAX_ROWS             = 500

# ---------------------------------------------------------------------------
# Competidores monitoreados (RSS, con fallback a sitemap-news.xml)
# ---------------------------------------------------------------------------
COMPETITOR_SITES = [
    {"name": "El Comercio",  "rss": "https://elcomercio.pe/arcio/rss/"},
    {"name": "La República", "rss": "https://larepublica.pe/arcio/rss/"},
    {"name": "Gestión",      "rss": "https://gestion.pe/arcio/rss/"},
    {"name": "Peru21",       "rss": "https://peru21.pe/arcio/rss/"},
    {"name": "Infobae Perú", "rss": "https://www.infobae.com/feeds/rss/peru/"},
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

# Etapa 3 — alertas en tiempo real
ALERT_SCORE_THRESHOLD          = 75   # solo alerta temas con score >= esto
ALERT_MAX_PER_SECTION_PER_HOUR = 3    # anti-spam

# ---------------------------------------------------------------------------
# SerpAPI (cuota escasa: free tier 100/mes). Mantener bajo.
# ---------------------------------------------------------------------------
SERPAPI_DAILY_LIMIT = 10

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
}
