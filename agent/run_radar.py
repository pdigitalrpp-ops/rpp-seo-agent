#!/usr/bin/env python3
"""
Etapas 2 y 3 — Radar en tiempo real + Alertas por sección.
Corre cada pocos minutos (limitado por Marfeel 1/min y Trends). Cruza el tráfico
del momento con tendencias y competencia, puntúa temas (0-100) aplicando los
aprendizajes de la mañana, y dispara alertas a la sección cuando un tema supera
el umbral. Las recomendaciones se publican en el dashboard.
"""

import logging
import sys
from datetime import datetime, date, timezone

from dotenv import load_dotenv
load_dotenv()

from config import (
    KNOWN_SECTIONS_FALLBACK, ALERT_SCORE_THRESHOLD, ALERT_MAX_PER_SECTION_PER_HOUR,
    CATEGORY_KEYWORDS,
)
from collectors import marfeel, trends, competitors, rpp_own_feed
from analyzers import scoring, opportunities, coverage
from llm import provider as llm
from notifiers import notify
from writers.supabase_writer import (
    save_run_log, save_recommendations, save_alerts, save_trends,
    save_competitor_articles, get_scoring_weights, count_recent_alerts,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("run_radar")


def safe_collect(name, func, run_data, **kwargs):
    try:
        result = func(**kwargs)
        run_data["sources_ok"].append(name)
        logger.info(f"✅ {name}: OK")
        return result
    except Exception as e:
        logger.error(f"❌ {name} falló: {e}")
        run_data["sources_failed"].append(name)
        return None


def build_alerts(scored_topics):
    """Etapa 3 — convierte los temas de score alto en alertas por sección."""
    alerts = []
    for topic in scored_topics:
        if topic["score"] < ALERT_SCORE_THRESHOLD:
            continue
        section = topic.get("section") or "actualidad"
        alerts.append({
            "type":        "trending_topic",
            "severity":    "high" if topic["score"] >= 85 else "medium",
            "section":     section,
            "title":       topic["keyword"],
            "description": f"Tendencia fuerte ahora · urgencia {topic['urgency']} · "
                           f"formato sugerido: {topic['format']}",
            "score":       topic["score"],
        })
    return alerts


def run():
    today = date.today()
    # timestamps aware en UTC: la columna es timestamptz y un naive local (TZ=Lima
    # en el workflow) se interpretaba como UTC → dashboard restaba 5h dos veces
    run_data = {"started_at": datetime.now(timezone.utc), "sources_ok": [], "sources_failed": [], "kind": "radar"}
    logger.info(f"📡 Radar en tiempo real — {datetime.now():%H:%M}")
    logger.info(
        "🔑 Proveedores LLM detectados (solo presencia de credenciales, no validez): "
        f"openrouter={llm.openrouter.is_enabled()} "
        f"bedrock={llm.bedrock.is_enabled()} "
        f"gemini={llm.gemini.is_enabled()}"
    )

    # --- RECOLECCIÓN (ligera) ---
    realtime       = safe_collect("marfeel_realtime", marfeel.fetch_realtime_top,        run_data)
    trends_data    = safe_collect("trends",           trends.fetch_all_trends,           run_data)
    competitor_data = safe_collect("competitors",     competitors.fetch_all_competitors, run_data,
                                   hours_back=6)

    # LLM: re-categoriza los titulares de competencia (las reglas por keyword
    # fallan seguido: "Canal 5..." → política, Haaland → política, etc.).
    # Rules-first: si no hay proveedor o falla, quedan las categorías por reglas.
    if competitor_data:
        cats_articles = list(dict.fromkeys(list(CATEGORY_KEYWORDS.keys()) + ["otros"]))
        n_cat = llm.categorize_articles(competitor_data, cats_articles)
        if n_cat is not None:
            logger.info(f"✅ LLM categorizó {n_cat}/{len(competitor_data)} titulares de competencia")

        # Cobertura: ¿RPP ya publicó lo que publicó la competencia? (rules-first
        # + refinamiento LLM). Marca rpp_has_coverage en cada artículo.
        own_recent = safe_collect("rpp_own_feed", rpp_own_feed.fetch_recent_articles, run_data)
        n_cov = coverage.compute_coverage(competitor_data, own_recent or [])
        logger.info(f"📰 Cobertura RPP: {n_cov}/{len(competitor_data)} titulares ya publicados")

    if not trends_data:
        logger.info("Sin tendencias; nada que puntuar en este ciclo")
        run_data["finished_at"] = datetime.now(timezone.utc)
        run_data["status"] = "partial" if run_data["sources_ok"] else "failed"
        try:
            save_run_log(run_data)
        except Exception:
            pass
        return

    # --- ANÁLISIS (Etapa 2) ---
    learning = {}
    try:
        learning = get_scoring_weights()   # aprendizajes de la mañana
    except Exception as e:
        logger.warning(f"No se pudieron leer los pesos de aprendizaje: {e}")

    # Categorización: el proveedor activo (Bedrock o Gemini, ver llm/provider.py)
    # clasifica todos los temas en 1 llamada (razona sobre nombres propios donde
    # las reglas fallan: 'haaland'→deportes, no 'otros'). Si no hay proveedor o
    # falla, cae a la inferencia por keywords.
    categories = list(CATEGORY_KEYWORDS.keys()) + ["otros"]
    llm_cats = llm.categorize_topics([t["keyword"] for t in trends_data], categories)
    if llm_cats:
        logger.info(f"✅ LLM categorizó {len(llm_cats)}/{len(trends_data)} temas")

    # Momentum propio: categorías con tracción en tiempo real (Marfeel)
    realtime_titles = " ".join((r.get("title") or "") for r in (realtime or [])).lower()
    for item in trends_data:
        kw_words = [w for w in item["keyword"].lower().split() if len(w) > 4]
        item["own_momentum"] = min(sum(1 for w in kw_words if w in realtime_titles) / 2.0, 1.0)
        item["category"] = ((llm_cats or {}).get(item["keyword"])
                            or scoring._infer_category_from_keyword(item["keyword"]))

    scored = scoring.score_all_topics(
        trends_data, competitor_data or [], gsc_data=[],
        sections=KNOWN_SECTIONS_FALLBACK, learning=learning,
    )

    recs = opportunities.build_recommendations(scored, gsc_data=[], ga4_data=realtime or [])

    # --- ALERTAS (Etapa 3) con anti-spam ---
    candidate_alerts = build_alerts(scored)
    sent_alerts = []
    for alert in candidate_alerts:
        section = alert["section"]
        try:
            recent = count_recent_alerts(section, minutes=60)
        except Exception:
            recent = 0
        if recent >= ALERT_MAX_PER_SECTION_PER_HOUR:
            logger.info(f"Anti-spam: '{section}' ya tiene {recent} alertas/hora; se omite")
            continue
        notify.dispatch_alert(alert)   # a Teams/WhatsApp si hay responsable
        sent_alerts.append(alert)

    # --- GUARDAR ---
    try:
        save_trends(trends_data, today)
        save_competitor_articles(competitor_data or [])
        save_recommendations(recs, today)
        save_alerts(sent_alerts)
        logger.info(f"✅ Radar guardado: {len(recs)} recomendaciones, {len(sent_alerts)} alertas")
    except Exception as e:
        logger.error(f"❌ Error guardando en Supabase: {e}")
        run_data["error_log"] = str(e)

    run_data["finished_at"] = datetime.now(timezone.utc)
    run_data["status"] = (
        "success" if not run_data["sources_failed"]
        else "partial" if run_data["sources_ok"] else "failed"
    )
    try:
        save_run_log(run_data)
    except Exception as e:
        logger.error(f"No se pudo guardar el run log: {e}")

    if run_data["status"] == "failed":
        sys.exit(1)


if __name__ == "__main__":
    run()
