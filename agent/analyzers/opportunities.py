import logging
from datetime import datetime

from llm import provider as llm

logger = logging.getLogger(__name__)

# Tope de titulares de evidencia por tema. Son los que el radar ya recolectó de
# Google News (daily_trends.news); con 5 el modelo tiene de sobra para saber
# qué pasó y el prompt no se dispara de tamaño.
_EVIDENCE_HEADLINES = 5


def _llm_headlines(topics):
    """
    Pide al LLM titular + ángulo para los temas recomendados, en UNA llamada.

    Devuelve {keyword: {"title", "angle"}} o {} — rules-first: si no hay
    proveedor, si falla, o si un tema no trae titulares de evidencia, cada
    recomendación cae a la plantilla de abajo sin romperse.

    Solo se mandan los temas CON evidencia: sin titulares reales el modelo no
    puede decir qué pasó, y pedírselo igual es invitarlo a inventar (la lección
    de explain_trends, que hubo que afinar en producción por eso mismo).
    """
    con_evidencia = [t for t in topics if t.get("news")]
    if not con_evidencia:
        return {}

    items = [{
        "keyword":      t["keyword"],
        "categoria":    t.get("category"),
        "formato":      t.get("format"),
        "why_trending": t.get("why_trending"),
        "headlines":    [
            n.get("title") for n in (t.get("news") or [])[:_EVIDENCE_HEADLINES]
            if n.get("title")
        ],
    } for t in con_evidencia]

    try:
        out = llm.suggest_headlines(items) or {}
    except Exception as e:
        logger.warning(f"LLM no pudo sugerir titulares ({e}); se usa la plantilla")
        return {}

    if out:
        logger.info(f"✅ LLM sugirió titular/ángulo para {len(out)}/{len(items)} recomendaciones")
    else:
        logger.info("LLM no devolvió titulares; se usa la plantilla por reglas")
    return out


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

    llm_suggestions = _llm_headlines(top_topics)

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

        # El LLM manda cuando pudo escribir algo; si no, respaldo por reglas.
        sug = (llm_suggestions or {}).get(kw) or {}
        angle = sug.get("angle") or _suggest_angle(kw, topic["category"], quick_wins, paa_data)

        recommendations.append({
            "rank":            i + 1,
            "title_suggested": sug.get("title") or _generate_title(kw, topic["category"], topic["format"]),
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


# Palabras que no se capitalizan dentro de un titular (salvo al inicio).
_MINUSCULAS = {
    "de", "del", "la", "las", "el", "los", "y", "e", "o", "u", "a", "al",
    "en", "con", "por", "para", "sin", "sobre", "vs", "un", "una",
}


def _smart_case(keyword):
    """
    Capitaliza un tema respetando nombres propios y siglas.

    Reemplaza a `str.capitalize()`, que hacía DAÑO: ese método pone la primera
    letra en mayúscula **y el resto en minúscula**, así que
    "ALIANZA ATLÉTICO - SPORTING CRISTAL" salía como
    "Alianza atlético - sporting cristal" — nombres de equipos y países en
    minúscula, publicable en ningún sitio. Visto en producción el 2026-08-21.

    Heurística (es un RESPALDO, no pretende ser perfecta: cuando el LLM está
    disponible el titular lo escribe él):
      - una palabra que YA trae alguna mayúscula se deja intacta: cubre siglas
        (IGP, RPP), nombres propios que ya vienen bien escritos, y marcas con
        mayúscula interna como "iPhone" o "eSports", que con un `.upper()` a
        la primera letra saldrían como "IPhone";
      - las palabras funcionales van en minúscula salvo si abren o CIERRAN el
        titular: "de la cruz" → "De la Cruz", pero "serie a" → "Serie A",
        porque una preposición suelta al final casi nunca es preposición sino
        parte del nombre (la Serie A del fútbol italiano);
      - el resto se capitaliza sin tocar sus demás letras.
    """
    palabras = (keyword or "").split()
    ultimo = len(palabras) - 1
    out = []
    for i, w in enumerate(palabras):
        if any(c.isupper() for c in w):
            out.append(w)
        elif 0 < i < ultimo and w.lower() in _MINUSCULAS:
            out.append(w.lower())
        else:
            out.append(w[0].upper() + w[1:] if w else w)
    return " ".join(out)


def _generate_title(keyword, category, format_type):
    """
    Titular de RESPALDO, para cuando no hay LLM disponible (rules-first).

    **A propósito ya NO lleva muletilla.** Antes todo terminaba en "lo que
    debes saber" o "todo lo que necesitas saber" — con solo dos salidas
    posibles, el panel entero repetía la misma frase y el usuario lo reportó
    como ruido el 2026-08-21.

    Sin LLM no hay forma de saber QUÉ pasó (esa evidencia son los titulares de
    Google News, y resumirlos es justo lo que hace el modelo), así que este
    respaldo se limita a enunciar el tema bien escrito y con el formato
    sugerido. Es menos vistoso que una frase hecha, pero es honesto: no
    aparenta un titular que nadie redactó.
    """
    # El casing se aplica a TODAS las formas, también a las que llevan
    # prefijo: dejar el tema crudo ahí producía "…del banco central de reserva
    # del perú", con el país en minúscula. Capitalizar de más un sustantivo
    # común es un desliz de estilo; escribir "perú" es un error.
    tema = _smart_case(keyword)
    PREFIXES = {
        "explicador": f"Qué es {tema}",
        "lista":      f"Los mejores {tema}",
        "live blog":  f"EN VIVO | {tema}",
        "artículo":   tema,
    }
    return PREFIXES.get(format_type, tema)


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
