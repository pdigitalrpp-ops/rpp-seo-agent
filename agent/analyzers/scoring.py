"""
Scoring de temas — modelo 0-100.

Cada dimensión se normaliza a 0-1 y se pondera con SCORE_WEIGHTS (suman 100).
`learning` es un dict de multiplicadores por dimensión (default 1.0) que viene
de los aprendizajes del benchmark de la mañana (daily_insights): si ayer las
notas de cierta categoría/Discover funcionaron, su dimensión pesa más hoy.
"""

import logging
from config import (
    SCORE_WEIGHTS, URGENCY_THRESHOLDS, CATEGORY_KEYWORDS,
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


def score_topic(topic_data, weights=None, learning=None):
    """Devuelve un score 0-100 para un tema."""
    weights = weights or SCORE_WEIGHTS
    learning = learning or {}

    category = topic_data.get("category", "otros")
    growth_n = _norm_growth(topic_data.get("growth_score", 0))

    dims = {
        "market_trend": growth_n,
        "competition_gap": min(topic_data.get("competition_coverage", 0) / 3.0, 1.0),
        "rpp_relevance": (
            1.0 if category in CORE_CATEGORIES
            else 0.6 if category in SECONDARY_CATEGORIES
            else 0.3
        ),
        "discover_potential": (
            1.0 if topic_data.get("has_discover_potential")
            else 0.5 if category in {"entretenimiento", "deportes"}
            else 0.2
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
        })

    return sorted(scored, key=lambda x: x["score"], reverse=True)
