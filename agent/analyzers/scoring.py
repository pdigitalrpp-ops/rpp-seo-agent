import logging
from config import PROGRAM_AFFINITY_MAP, CATEGORY_KEYWORDS

logger = logging.getLogger(__name__)


def score_topic(topic_data):
    score = 0.0

    growth = topic_data.get("growth_score", 0)
    if growth >= 8:   score += 3.0
    elif growth >= 6: score += 2.0
    elif growth >= 4: score += 1.0
    else:             score += 0.5

    comp_coverage = topic_data.get("competition_coverage", 0)
    if comp_coverage >= 3:   score += 2.0
    elif comp_coverage == 2: score += 1.5
    elif comp_coverage == 1: score += 1.0

    category = topic_data.get("category", "otros")
    core_cats = ["política", "economía", "deportes"]
    sec_cats  = ["entretenimiento", "tecnología", "salud", "internacional"]
    if category in core_cats:  score += 2.0
    elif category in sec_cats: score += 1.0
    else:                      score += 0.5

    if topic_data.get("has_discover_potential", False):   score += 2.0
    elif category in ["entretenimiento", "deportes"]:     score += 1.0

    if topic_data.get("is_time_sensitive", False): score += 1.0
    elif growth >= 6:                              score += 0.5

    return round(min(score, 10.0), 1)


def assign_urgency(score, growth_score=0):
    if score >= 8 or growth_score >= 8: return "INMEDIATO"
    elif score >= 6:                    return "HOY"
    elif score >= 4:                    return "ESTA SEMANA"
    else:                               return "DESCARTAR"


def suggest_format(topic, category):
    title_lower = (topic or "").lower()

    if any(w in title_lower for w in ["en vivo", "directo", "ahora", "hoy", "sesión"]):
        return "live blog"
    if any(w in title_lower for w in ["mejores", "ranking", "top", "opciones", "tips"]):
        return "lista"
    if any(w in title_lower for w in ["qué es", "cómo funciona", "por qué", "explicación", "guía"]):
        return "explicador"

    FORMAT_BY_CATEGORY = {
        "política":        "artículo",
        "economía":        "explicador",
        "deportes":        "artículo",
        "entretenimiento": "artículo",
        "tecnología":      "explicador",
        "salud":           "explicador",
        "internacional":   "artículo",
    }
    return FORMAT_BY_CATEGORY.get(category, "artículo")


def assign_program(category):
    return PROGRAM_AFFINITY_MAP.get(category, PROGRAM_AFFINITY_MAP.get("otros", "RPP Noticias"))


def score_all_topics(trends_data, competitor_data, gsc_data, discover_data=None):
    if not trends_data:
        return []

    discover_categories = {"entretenimiento", "deportes", "salud"}
    if discover_data:
        for item in discover_data[:20]:
            page = item.get("page", "")
            for cat, keywords in CATEGORY_KEYWORDS.items():
                if any(kw in page.lower() for kw in keywords):
                    discover_categories.add(cat)

    comp_coverage = {}
    if competitor_data:
        for art in competitor_data:
            for word in art["title"].lower().split():
                if len(word) > 4:
                    if word not in comp_coverage:
                        comp_coverage[word] = set()
                    comp_coverage[word].add(art["site"])

    def is_time_sensitive(keyword):
        ts_words = ["hoy", "ahora", "mañana", "esta noche", "este", "nueva", "anuncia",
                    "oficial", "confirma", "alerta", "emergencia", "rompe", "sorprende"]
        return any(w in keyword.lower() for w in ts_words)

    scored = []
    for item in trends_data:
        kw       = item["keyword"]
        category = _infer_category_from_keyword(kw)
        kw_words = [w for w in kw.lower().split() if len(w) > 4]
        max_comp = max((len(comp_coverage.get(w, set())) for w in kw_words), default=0)

        topic_data = {
            "keyword":               kw,
            "growth_score":          item.get("growth_score", 0),
            "competition_coverage":  max_comp,
            "category":              category,
            "has_discover_potential": category in discover_categories,
            "is_time_sensitive":     is_time_sensitive(kw),
        }

        final_score = score_topic(topic_data)
        urgency     = assign_urgency(final_score, item.get("growth_score", 0))

        if urgency == "DESCARTAR":
            continue

        scored.append({
            **topic_data,
            "score":   final_score,
            "urgency": urgency,
            "format":  suggest_format(kw, category),
            "program": assign_program(category),
            "rank":    item.get("rank", 99),
        })

    return sorted(scored, key=lambda x: x["score"], reverse=True)


def _infer_category_from_keyword(keyword):
    kw_lower = keyword.lower()
    for cat, keywords in CATEGORY_KEYWORDS.items():
        if any(k in kw_lower for k in keywords):
            return cat
    return "otros"
