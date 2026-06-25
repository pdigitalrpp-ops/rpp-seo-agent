import logging
from datetime import datetime

logger = logging.getLogger(__name__)


def find_gsc_quick_wins(gsc_data):
    if not gsc_data:
        return []
    return sorted(
        [r for r in gsc_data if 4.0 <= r.get("position", 99) <= 10.0 and r.get("impressions", 0) >= 200],
        key=lambda x: x["impressions"],
        reverse=True
    )[:20]


def find_low_ctr_opportunities(gsc_data):
    if not gsc_data:
        return []
    by_page = {}
    for row in gsc_data:
        page = row["page"]
        if page not in by_page:
            by_page[page] = {"impressions": 0, "clicks": 0}
        by_page[page]["impressions"] += row.get("impressions", 0)
        by_page[page]["clicks"]      += row.get("clicks", 0)

    opps = []
    for page, data in by_page.items():
        if data["impressions"] >= 500:
            ctr = data["clicks"] / data["impressions"] * 100 if data["impressions"] > 0 else 0
            if ctr <= 2.0:
                opps.append({"page": page, "impressions": data["impressions"],
                             "clicks": data["clicks"], "ctr": round(ctr, 2)})

    return sorted(opps, key=lambda x: x["impressions"], reverse=True)[:20]


def find_discover_opportunities(discover_data, traffic_data):
    if not discover_data:
        return []
    return sorted(
        [d for d in discover_data if d.get("clicks", 0) > 0],
        key=lambda x: x["clicks"],
        reverse=True
    )[:10]


def build_recommendations(scored_topics, gsc_data, ga4_data, decay_list=None, paa_data=None):
    if not scored_topics:
        return []

    top_topics  = scored_topics[:5]
    quick_wins  = find_gsc_quick_wins(gsc_data or [])
    discover_op = find_discover_opportunities(ga4_data or [], ga4_data or [])

    recommendations = []
    for i, topic in enumerate(top_topics):
        kw = topic["keyword"]

        why_parts = []
        if topic.get("growth_score", 0) >= 6:
            why_parts.append(f"tendencia en alza en Google Trends Perú (score {topic['growth_score']}/10)")
        if topic.get("competition_coverage", 0) >= 2:
            why_parts.append(f"cubierto por {topic['competition_coverage']} medios competidores")
        if topic.get("is_time_sensitive"):
            why_parts.append("tema con urgencia temporal")
        if not why_parts:
            why_parts.append("señal detectada en múltiples fuentes")

        angle = _suggest_angle(kw, topic["category"], quick_wins, paa_data)

        recommendations.append({
            "rank":            i + 1,
            "title_suggested": _generate_title(kw, topic["category"], topic["format"]),
            "angle":           angle,
            "why_now":         "; ".join(why_parts),
            "data_source":     "trends+competition" if topic.get("competition_coverage", 0) > 0 else "trends",
            "urgency":         topic["urgency"],
            "format":          topic["format"],
            "section":         topic.get("section"),
            "score":           topic["score"],
            "category":        topic["category"],
            "publish_window":  _get_publish_window(topic["category"]),
            "date":            datetime.now().strftime("%Y-%m-%d"),
        })

    return recommendations


def _suggest_angle(keyword, category, quick_wins, paa_data):
    if paa_data:
        for item in paa_data:
            if item.get("keyword", "").lower() in keyword.lower():
                questions = item.get("questions", [])
                if questions:
                    return f"Responder: {questions[0]}"

    ANGLES_BY_CATEGORY = {
        "politica":        "enfoque en impacto para los ciudadanos peruanos",
        "economia":        "implicancias para el bolsillo del peruano promedio",
        "deportes":        "perspectiva desde los protagonistas nacionales",
        "entretenimiento": "ángulo de interés humano y conexión local",
        "tecnologia":      "qué significa esto para el usuario peruano",
        "salud":           "qué hacer y a dónde ir para peruanos",
        "mundo":           "cómo afecta esto a Perú directamente",
    }
    return ANGLES_BY_CATEGORY.get(category, "perspectiva local y de servicio para el lector peruano")


def _generate_title(keyword, category, format_type):
    PREFIXES = {
        "explicador": "Qué es",
        "lista":      "Los mejores",
        "live blog":  "EN VIVO |",
        "artículo":   "",
    }
    prefix = PREFIXES.get(format_type, "")
    if prefix:
        return f"{prefix} {keyword}: lo que debes saber"
    return f"{keyword.capitalize()}: todo lo que necesitas saber"


def _get_publish_window(category):
    WINDOWS = {
        "politica":        "07:00–09:00",
        "economia":        "07:00–08:30",
        "deportes":        "10:00–12:00 o 19:00–21:00",
        "entretenimiento": "12:00–14:00",
        "tecnologia":      "09:00–11:00",
        "salud":           "08:00–10:00",
        "mundo":           "07:00–09:00",
    }
    return WINDOWS.get(category, "07:00–09:00")
