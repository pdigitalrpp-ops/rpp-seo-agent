import os

SITE_URL = "https://rpp.pe/"
GA4_PROPERTY_ID = os.environ.get("GA4_PROPERTY_ID", "")

COMPETITOR_SITES = [
    {"name": "El Comercio",  "rss": "https://elcomercio.pe/arcio/rss/"},
    {"name": "La República", "rss": "https://larepublica.pe/arcio/rss/"},
    {"name": "Gestión",      "rss": "https://gestion.pe/arcio/rss/"},
    {"name": "Peru21",       "rss": "https://peru21.pe/arcio/rss/"},
    {"name": "Infobae Perú", "rss": "https://www.infobae.com/feeds/rss/peru/"},
]

PROGRAM_AFFINITY_MAP = {
    "política":        "Ampliación de Noticias",
    "economía":        "Economía al Día",
    "deportes":        "RPP Deportes",
    "entretenimiento": "Trome TV",
    "tecnología":      "Tech y Más",
    "internacional":   "Ampliación de Noticias",
    "salud":           "Vida Saludable",
    "otros":           "RPP Noticias",
}

GOOGLE_TRENDS_CATEGORIES = {
    "noticias":        16,
    "política":        396,
    "entretenimiento": 3,
    "deportes":        20,
    "economía":        7,
}

CATEGORY_KEYWORDS = {
    "política":        ["congreso","gobierno","presidente","ministro","elección","partido","municipio","alcalde","premier"],
    "economía":        ["economía","pbi","inflación","dólar","tipo de cambio","bcr","mef","empresa","mercado","bolsa"],
    "deportes":        ["fútbol","sport","sporting","alianza","universitario","selección","copa","mundial","gol","liga"],
    "entretenimiento": ["música","cine","serie","película","artista","concierto","show","baile","televisión","farándula"],
    "tecnología":      ["tecnología","inteligencia artificial","ia","app","startup","celular","google","meta","openai"],
    "salud":           ["salud","médico","hospital","vacuna","covid","enfermedad","minsa","clínica","tratamiento"],
    "internacional":   ["eeuu","trump","estados unidos","brasil","argentina","chile","venezuela","colombia","mundo"],
}

# Límite de llamadas SerpAPI por ejecución
SERPAPI_DAILY_LIMIT = 15

# Umbral de content decay (% de caída respecto al pico histórico)
DECAY_THRESHOLD = 0.20

# Umbral de alerta por caída de clics en GSC (24h vs semana anterior)
GSC_DROP_ALERT_THRESHOLD = 0.30
