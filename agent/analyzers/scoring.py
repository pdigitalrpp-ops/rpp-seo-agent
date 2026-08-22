"""
Scoring de temas — modelo 0-100.

Cada dimensión se normaliza a 0-1 y se pondera con SCORE_WEIGHTS (suman 100).
`learning` es un dict de multiplicadores por dimensión (default 1.0) que viene
de los aprendizajes del benchmark de la mañana (daily_insights): si ayer las
notas de cierta categoría/Discover funcionaron, su dimensión pesa más hoy.
"""

import logging
from datetime import datetime, timezone
from config import (
    SCORE_WEIGHTS, URGENCY_THRESHOLDS, CATEGORY_KEYWORDS, PERUVIAN_SOURCES,
    OWN_SOURCE_MARKERS,
)

logger = logging.getLogger(__name__)

CORE_CATEGORIES = {"politica", "economia", "deportes"}
SECONDARY_CATEGORIES = {"entretenimiento", "tecnologia", "salud", "mundo"}


def _infer_category_from_keyword(keyword):
    kw = (keyword or "").lower()
    for category, words in CATEGORY_KEYWORDS.items():
        if any(w in kw for w in words):
            return category
    return "otros"


def _norm_growth(growth):
    """Normaliza el growth_score de Trends a 0-1, tolerando escala 0-10 o %."""
    if not growth:
        return 0.0
    if growth <= 10:
        return min(max(growth, 0) / 10.0, 1.0)
    return min(growth / 500.0, 1.0)


def _local_evidence(topic_data):
    """
    0-1 segun cuantos MEDIOS PERUANOS distintos cubren el tema.

    POR QUE PERUANOS Y NO "cuantas fuentes cubren el tema" (que fue el primer
    intento, descartado en calibracion): Google Trends solo lista temas que YA
    tienen cobertura, asi que "tiene noticias" satura en ~1.0 para casi todos y
    NO discrimina — el mismo defecto del approx_traffic con otra cara. Medido
    sobre 30 tendencias reales de 3 dias, la version generica subia los 30
    temas (+18.9 pts de media) sin reordenar nada, y hasta premiaba queries sin
    hecho noticioso ("libre", "flashscore").

    Contar solo medios PERUANOS si separa: el 40% de las tendencias no tiene
    NINGUNO (ariana grande, the strongest, sara bejlek — rebote global) y el
    resto se reparte 1-4. Y es la pregunta editorialmente correcta para RPP:
    no "esto es noticia en algun sitio" sino "esto le importa a mi audiencia".

    Satura en 3 medios peruanos = 1.0. Devuelve 0.0 sin noticias (rules-first:
    `market_trend` cae entonces a growth_n, el comportamiento anterior).
    """
    news = topic_data.get("news")
    if not news:
        return 0.0
    fuentes = set()
    for n in news:
        src = (n.get("source") or "").lower().strip()
        if not src or not any(p in src for p in PERUVIAN_SOURCES):
            continue
        # RPP NO cuenta como evidencia de si mismo: ver OWN_SOURCE_MARKERS en
        # config.py (bucle autoalimentado + doble computo con own_momentum).
        if any(m in src for m in OWN_SOURCE_MARKERS):
            continue
        fuentes.add(src)
    fuerza = min(len(fuentes) / 3.0, 1.0)

    # SIN hecho noticioso claro (why_trending null) se penaliza a la mitad,
    # igual que hace alerting.py. Lo detecto la calibracion: queries genericas
    # como "libre" o "montevideo city torque" no tienen historia detras pero SI
    # aparecen en medios peruanos (por coincidencia de palabras), y sin esta
    # guarda subian +30 puntos y se colaban entre las recomendaciones.
    if not topic_data.get("why_trending"):
        fuerza *= 0.5
    return fuerza


def score_topic(topic_data, weights=None, learning=None):
    """Devuelve un score 0-100 para un tema."""
    weights = weights or SCORE_WEIGHTS
    learning = learning or {}

    category = topic_data.get("category", "otros")
    growth_n = _norm_growth(topic_data.get("growth_score", 0))

    # EVIDENCIA DE NOTICIAS (2026-08-21): cuantas FUENTES distintas cubren el
    # tema y que tan frescas estan. Se reusa el calculo ya calibrado de
    # medios PERUANOS que lo cubren (ver _local_evidence: la version generica
    # se descarto en calibracion porque no discriminaba).
    local_n = _local_evidence(topic_data)

    dims = {
        # ANTES era solo `growth_n` (el approx_traffic de Google Trends). Medido
        # sobre 7 dias: el 90% de las tendencias caia en growth_score 1.5, o sea
        # que la dimension de MAYOR peso (30 pts) le daba lo mismo a casi todos y
        # no ordenaba nada. alerting.py ya habia llegado a esa conclusion en
        # julio y dejo de usarlo como driver.
        # Se toma el MAXIMO de las dos senales en vez de sustituir una por otra:
        #  - pico de busqueda sin cobertura peruana aun -> puntua por growth_n
        #    (es una oportunidad: nadie local lo ha escrito todavia);
        #  - tema que los medios peruanos ya cubren aunque se busque poco ->
        #    puntua por local_n (le importa a esta audiencia).
        # Quedarse solo con local_n habria matado el primer caso, que es
        # justamente el mas valioso para un medio.
        "market_trend": max(growth_n, local_n),
        # OJO: mas competidores cubriendolo = MAS puntos. Es deliberado
        # (estrategia "subirse a la ola", ver SCORE_WEIGHTS en config.py), y por
        # eso se renombro: antes se llamaba `competition_gap`, que prometia lo
        # contrario de lo que hace la formula.
        "market_validation": min(topic_data.get("competition_coverage", 0) / 3.0, 1.0),
        "rpp_relevance": (
            1.0 if category in CORE_CATEGORIES
            else 0.6 if category in SECONDARY_CATEGORIES
            else 0.3
        ),
        # ANTES era una lista blanca de categorias, y por eso un sismo de
        # magnitud 7.2 ("actualidad") se llevaba 0.2 mientras CUALQUIER partido
        # ("deportes") se llevaba 1.0 -- el sismo puntuaba POR DEBAJO de un
        # Tigres-Atlante pese a ser la nota mas leida del dia (139.361 page
        # views). La categoria sigue contando, pero ya no manda sola: una
        # historia con cobertura real y fresca rinde en Discover venga de donde
        # venga, que es como funciona Discover de verdad.
        "discover_potential": max(
            1.0 if topic_data.get("has_discover_potential")
            else 0.5 if category in {"entretenimiento", "deportes"}
            else 0.2,
            0.8 * local_n,
        ),
        "time_sensitivity": (
            1.0 if topic_data.get("is_time_sensitive")
            else 0.5 if growth_n >= 0.6
            else 0.2
        ),
        "own_momentum": min(max(topic_data.get("own_momentum", 0.0), 0.0), 1.0),
    }

    total = 0.0
    for dim, weight in weights.items():
        mult = learning.get(dim, 1.0)
        total += dims.get(dim, 0.0) * weight * mult

    return round(min(total, 100.0), 1)


def assign_urgency(score):
    for label, threshold in sorted(URGENCY_THRESHOLDS.items(), key=lambda x: -x[1]):
        if score >= threshold:
            return label
    return "DESCARTAR"


def assign_section(category, available_sections=None):
    """
    Mapea la categoría inferida a una sección REAL de rpp.pe
    (las secciones vienen de Marfeel — collectors.marfeel.fetch_sections).
    """
    available_sections = [s.lower() for s in (available_sections or [])]
    cat = (category or "").lower()
    if cat in available_sections:
        return cat
    for section in available_sections:
        if cat and cat in section:
            return section
    return cat or "actualidad"


def suggest_format(topic, category):
    title_lower = (topic or "").lower()
    if any(w in title_lower for w in ["en vivo", "directo", "ahora", "hoy", "sesión"]):
        return "live blog"
    if any(w in title_lower for w in ["mejores", "ranking", "top", "opciones", "tips"]):
        return "lista"
    if any(w in title_lower for w in ["qué es", "cómo funciona", "por qué", "explicación", "guía"]):
        return "explicador"
    FORMAT_BY_CATEGORY = {
        "politica":        "artículo",
        "economia":        "explicador",
        "deportes":        "artículo",
        "entretenimiento": "artículo",
        "tecnologia":      "explicador",
        "salud":           "explicador",
        "mundo":           "artículo",
    }
    return FORMAT_BY_CATEGORY.get(category, "artículo")


def _is_time_sensitive(keyword):
    ts_words = ["hoy", "ahora", "mañana", "esta noche", "este", "nueva", "anuncia",
                "oficial", "confirma", "alerta", "emergencia", "rompe", "sorprende"]
    return any(w in (keyword or "").lower() for w in ts_words)


def score_all_topics(trends_data, competitor_data, gsc_data,
                     discover_data=None, sections=None, learning=None):
    """
    Integra todas las fuentes y devuelve los temas puntuados (0-100),
    ordenados de mayor a menor, descartando los que caen bajo el umbral.
    """
    if not trends_data:
        return []

    # Categorías con potencial de Discover (base + las que vimos en GSC Discover)
    discover_categories = {"entretenimiento", "deportes", "salud"}
    if discover_data:
        for item in discover_data[:20]:
            page = (item.get("page", "") or "").lower()
            for cat, keywords in CATEGORY_KEYWORDS.items():
                if any(kw in page for kw in keywords):
                    discover_categories.add(cat)

    # Cobertura de competencia por palabra de título
    comp_coverage = {}
    for art in (competitor_data or []):
        for word in (art.get("title", "") or "").lower().split():
            if len(word) > 4:
                comp_coverage.setdefault(word, set()).add(art.get("site"))

    scored = []
    for item in trends_data:
        kw = item["keyword"]
        # Respeta la categoría ya asignada (p.ej. por Gemini en el radar);
        # si no viene, cae a la inferencia por keywords.
        category = item.get("category") or _infer_category_from_keyword(kw)
        kw_words = [w for w in kw.lower().split() if len(w) > 4]
        max_comp = max((len(comp_coverage.get(w, set())) for w in kw_words), default=0)

        topic_data = {
            "keyword":                kw,
            "growth_score":           item.get("growth_score", 0),
            "competition_coverage":   max_comp,
            "category":               category,
            "has_discover_potential": category in discover_categories,
            "is_time_sensitive":      _is_time_sensitive(kw),
            "own_momentum":           item.get("own_momentum", 0.0),
            # La evidencia de noticias entra al SCORE, no solo al dict final:
            # `market_trend` y `discover_potential` la miran (ver score_topic).
            "news":                   item.get("news") or [],
            # Necesario para la guarda de _local_evidence: sin hecho noticioso
            # la cobertura peruana puede ser casualidad de palabras.
            "why_trending":           item.get("why_trending"),
        }

        final_score = score_topic(topic_data, learning=learning)
        urgency = assign_urgency(final_score)
        if urgency == "DESCARTAR":
            continue

        scored.append({
            **topic_data,
            "score":   final_score,
            "urgency": urgency,
            "format":  suggest_format(kw, category),
            "section": assign_section(category, sections),
            "rank":    item.get("rank", 99),
            # La EVIDENCIA viaja con el tema. `topic_data` se arma de cero, así
            # que sin estas dos líneas `news` y `why_trending` se perdían acá y
            # build_recommendations quedaba a ciegas: por eso los titulares
            # sugeridos eran una plantilla fija ("…lo que necesitas saber")
            # aunque el radar ya tuviera los titulares reales del hecho.
            # Cuestan nada: son referencias a lo que ya está en memoria.
            "news":         item.get("news") or [],
            "why_trending": item.get("why_trending"),
        })

    return sorted(scored, key=lambda x: x["score"], reverse=True)
