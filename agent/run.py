#!/usr/bin/env python3
"""
Orquestador principal del Agente SEO RPP.
Ejecución diaria vía GitHub Actions a las 06:00 AM Lima (11:00 UTC).
"""

import logging
import sys
import time
from datetime import datetime, date

from dotenv import load_dotenv
load_dotenv()

from collectors import ga4, gsc, trends, competitors, serpapi
from analyzers   import scoring, opportunities, decay, signals
from writers.supabase_writer import (
    save_run_log, save_trends, save_gsc_data, save_traffic,
    save_competitor_articles, save_recommendations, save_alerts,
    save_decay, save_publishing_windows, get_historical_traffic,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("run")


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


def build_alerts(gsc_drops, decay_list):
    alert_list = []

    for drop in (gsc_drops or [])[:5]:
        alert_list.append({
            "type":        "traffic_drop",
            "severity":    "high" if drop["drop_pct"] >= 50 else "medium",
            "title":       f"Caída de {drop['drop_pct']}% en clics",
            "description": f"{drop['page']} pasó de {drop['clicks_prev']} a {drop['clicks_recent']} clics",
            "url":         drop["page"],
        })

    for item in (decay_list or [])[:3]:
        alert_list.append({
            "type":        "decay",
            "severity":    "medium",
            "title":       f"Content decay detectado ({item['drop_percentage']}% caída)",
            "description": item["suggested_action"],
            "url":         item["page_path"],
        })

    return alert_list


def run():
    today = date.today()
    run_data = {
        "started_at":    datetime.now(),
        "sources_ok":    [],
        "sources_failed": [],
    }

    logger.info(f"🚀 Iniciando Agente SEO RPP — {today}")

    # PASO 1: RECOLECCIÓN
    ga4_top        = safe_collect("ga4_top",      ga4.fetch_top_articles,            run_data)
    ga4_recent     = safe_collect("ga4_recent",   ga4.fetch_recent_articles_performance, run_data)
    ga4_hourly     = safe_collect("ga4_hourly",   ga4.fetch_hourly_traffic_pattern,  run_data)
    gsc_search     = safe_collect("gsc_search",   gsc.fetch_search_performance,      run_data)
    gsc_discover   = safe_collect("gsc_discover", gsc.fetch_discover_performance,    run_data)
    gsc_drops      = safe_collect("gsc_drops",    gsc.find_position_drops,           run_data)
    trends_data    = safe_collect("trends",        trends.fetch_all_trends,           run_data)
    competitor_data = safe_collect("competitors", competitors.fetch_all_competitors, run_data)
    serp_data      = safe_collect(
        "serpapi", serpapi.fetch_keyword_rankings, run_data,
        keywords=["noticias perú hoy", "política perú", "economía perú",
                  "deporte perú", "entretenimiento perú"],
    )

    # PASO 2: ANÁLISIS
    historical = None
    try:
        historical = get_historical_traffic(days=90)
    except Exception as e:
        logger.warning(f"No se pudo leer histórico: {e}")

    scored_topics = scoring.score_all_topics(
        trends_data or [], competitor_data or [], gsc_search or [], gsc_discover
    )

    cross_signals = signals.cross_reference_signals(
        trends_data or [], competitor_data or [], gsc_search or []
    )

    rising_terms = []
    if trends_data:
        for item in (trends_data or [])[:5]:
            try:
                rising = trends.fetch_rising_terms(item["keyword"])
                rising_terms.extend(rising)
                time.sleep(3)
            except Exception:
                pass
    early_signals = signals.detect_early_signals(rising_terms, gsc_search)

    recs = opportunities.build_recommendations(
        scored_topics, gsc_search or [], ga4_top or []
    )

    decay_list = []
    if historical:
        try:
            raw_decay  = decay.detect_content_decay(ga4_top or [], historical)
            decay_list = decay.prioritize_decay_articles(raw_decay, gsc_search)
        except Exception as e:
            logger.warning(f"Decay analysis falló: {e}")

    pub_windows = None
    if ga4_hourly:
        pub_windows = signals.calculate_window_recommendations(ga4_hourly)

    alerts_list = build_alerts(gsc_drops, decay_list)

    # PASO 3: GUARDAR EN SUPABASE
    try:
        save_trends(trends_data, today)
        save_gsc_data((gsc_search or []) + (gsc_discover or []), today)
        save_traffic(ga4_top or [], today)
        save_competitor_articles(competitor_data or [])
        save_recommendations(recs, today)
        save_alerts(alerts_list)
        save_decay(decay_list, today)
        if pub_windows:
            save_publishing_windows(pub_windows, today)
        logger.info("✅ Todos los datos guardados en Supabase")
    except Exception as e:
        logger.error(f"❌ Error guardando en Supabase: {e}")
        run_data["error_log"] = str(e)

    # PASO 4: LOG FINAL
    run_data["finished_at"] = datetime.now()
    run_data["status"] = (
        "success" if not run_data["sources_failed"]
        else "partial" if run_data["sources_ok"]
        else "failed"
    )
    try:
        save_run_log(run_data)
    except Exception as e:
        logger.error(f"No se pudo guardar el run log: {e}")

    duration = (run_data["finished_at"] - run_data["started_at"]).seconds
    logger.info(
        f"🏁 Agente completado en {duration}s | "
        f"OK: {run_data['sources_ok']} | "
        f"FAIL: {run_data['sources_failed']}"
    )

    if run_data["status"] == "failed":
        sys.exit(1)


if __name__ == "__main__":
    run()
