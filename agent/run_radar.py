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
    KNOWN_SECTIONS_FALLBACK, ALERT_MAX_PER_SECTION_PER_HOUR, ALERT_DEDUP_HOURS,
    CATEGORY_KEYWORDS, WATCH_MAX_ACTIVE_KEYWORDS,
)
from collectors import marfeel, trends, competitors, rpp_own_feed, trend_news, watchlist
from analyzers import scoring, opportunities, coverage, alerting, evidence
from llm import provider as llm
from notifiers import notify
from writers.supabase_writer import (
    get_llm_categories,
    save_run_log, save_recommendations, save_alerts, save_trends,
    save_competitor_articles, get_scoring_weights, count_recent_alerts,
    get_recent_alerts, refresh_alert, get_trends_context,
    get_watch_keywords, save_watch_hits, get_competitor_sources,
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


# La Etapa 3 (alertas) ahora vive en analyzers/alerting.py — se puntúa la
# "alertabilidad" con evidencia de noticias, no con el score de recomendación.


def run():
    today = date.today()
    # timestamps aware en UTC: la columna es timestamptz y un naive local (TZ=Lima
    # en el workflow) se interpretaba como UTC → dashboard restaba 5h dos veces
    run_data = {"started_at": datetime.now(timezone.utc), "sources_ok": [], "sources_failed": [], "kind": "radar"}
    logger.info(f"📡 Radar en tiempo real — {datetime.now():%H:%M}")
    logger.info(llm.describe_providers())

    # --- RECOLECCIÓN (ligera) ---
    realtime       = safe_collect("marfeel_realtime", marfeel.fetch_realtime_top,        run_data)
    trends_data    = safe_collect("trends",           trends.fetch_all_trends,           run_data)
    # La lista de medios la administra el equipo desde /competencia
    # (tabla competitor_sources). Si viene vacía — tabla sin filas o
    # consulta caída — el collector cae a COMPETITOR_SITES de config.py.
    comp_sources = get_competitor_sources()
    competitor_data = safe_collect("competitors",     competitors.fetch_all_competitors, run_data,
                                   hours_back=6, sites=comp_sources)

    # LLM: re-categoriza los titulares de competencia (las reglas por keyword
    # fallan seguido: "Canal 5..." → política, Haaland → política, etc.).
    # Rules-first: si no hay proveedor o falla, quedan las categorías por reglas.
    if competitor_data:
        cats_articles = list(dict.fromkeys(list(CATEGORY_KEYWORDS.keys()) + ["otros"]))
        # Solo se pagan las notas nuevas: las que el LLM ya clasificó en
        # corridas anteriores reusan su categoría (ver get_llm_categories).
        try:
            known = get_llm_categories()
        except Exception as e:
            logger.warning(f"No se pudo leer las categorías ya guardadas ({e}); se clasifica todo")
            known = {}
        n_cat = llm.categorize_articles(competitor_data, cats_articles, known=known)
        if n_cat is not None:
            nuevas, reusadas = n_cat
            logger.info(f"✅ LLM categorizó {nuevas} titulares de competencia nuevos "
                        f"y reusó {reusadas} ya clasificados (de {len(competitor_data)})")

        # Cobertura: ¿RPP ya publicó lo que publicó la competencia? (rules-first
        # + refinamiento LLM). Marca rpp_has_coverage en cada artículo.
        own_recent = safe_collect("rpp_own_feed", rpp_own_feed.fetch_recent_articles, run_data)
        n_cov = coverage.compute_coverage(competitor_data, own_recent or [])
        logger.info(f"📰 Cobertura RPP: {n_cov}/{len(competitor_data)} titulares ya publicados")

    # --- VIGILANCIA DE TEMAS (keywords que define el equipo) ---
    # Va ANTES del return por falta de tendencias: no depende de Google Trends
    # (justamente existe para cubrir lo que Trends no ve), así que un feed de
    # Trends caído no debe apagarla. Se guarda acá mismo porque el bloque
    # GUARDAR de abajo es inalcanzable en ese camino.
    try:
        watched = get_watch_keywords(WATCH_MAX_ACTIVE_KEYWORDS)
    except Exception as e:
        logger.warning(f"No se pudo leer la lista de temas vigilados: {e}")
        watched = []
    if watched:
        watch_hits = safe_collect(
            "watchlist", watchlist.collect_hits, run_data,
            keywords=watched, competitor_articles=competitor_data or [],
        )
        if watch_hits:
            try:
                save_watch_hits(watch_hits)   # loguea cuántos eran nuevos
            except Exception as e:
                logger.error(f"❌ Error guardando hallazgos de vigilancia: {e}")

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

    # "Por qué es tendencia": noticias asociadas por Google Trends (ht:news_item,
    # la evidencia directa) + Google News por keyword como complemento + resumen
    # LLM. El resumen del LLM SÍ se reusa dentro del día (cuesta cuota) — las
    # noticias NO (son gratis, solo RSS) desde el 2026-08-25.
    try:
        existing = get_trends_context(today)
    except Exception as e:
        logger.warning(f"No se pudo leer el contexto previo de tendencias: {e}")
        existing = {}
    # Versión del pipeline de contexto: viaja en cada noticia (news[].v).
    # Subirla sirve para invalidar el `why_trending` cacheado de un dia a otro
    # (p.ej. al cambiar el prompt o las fuentes) sin parchar datos a mano.
    TREND_CONTEXT_VERSION = 3
    now = datetime.now(timezone.utc)
    to_explain = []
    for item in trends_data:
        prev = existing.get(item["keyword"]) or {}
        # REFRESCADO SIEMPRE, no solo la primera vez que se ve la keyword hoy
        # (fix 2026-08-25). Antes, si una keyword ya habia aparecido hoy, se
        # reusaba la foto de noticias congelada de esa primera corrida durante
        # el resto del dia — "Alianza Lima pierde la punta tras fecha 6" seguia
        # apareciendo como recomendacion INMEDIATO horas despues de que los
        # medios ya cubrian la fecha 7, porque el radar nunca volvia a mirar.
        # Las dos fuentes de evidencia juntas, ORDENADAS por cercanía a la
        # audiencia peruana y luego por frescura — no concatenadas. Antes iban
        # primero los ht:news_item de Google Trends, que NO están localizados:
        # para "kick" adjuntaban Ligue 1 en inglés y empujaban fuera a ATV Perú
        # y América TV, que sí habían encontrado la historia real (la
        # streamer Zully en Kick.com). De ahí salían el titular del panel,
        # el resumen del LLM y la cuenta de medios peruanos del score.
        crudo = (list(item.get("trends_news") or [])
                 + trend_news.fetch_news_for_keyword(item["keyword"]))
        item["news"] = [dict(n, v=TREND_CONTEXT_VERSION)
                        for n in evidence.rank_news(crudo, limit=5, now=now)]
        # El resumen del LLM SI se reusa (es lo caro): si ya existe para esta
        # keyword hoy, se conserva aunque las noticias se hayan refrescado.
        # Se sigue respetando la version — un resumen guardado con el
        # algoritmo de evidencia viejo (news[].v distinto) no se reusa, igual
        # que antes, para poder invalidar el dia entero subiendo el numero.
        prev_news = prev.get("news") or []
        if prev_news and prev_news[0].get("v") == TREND_CONTEXT_VERSION:
            item["why_trending"] = prev.get("why_trending")
        else:
            item["why_trending"] = None
        if not item.get("why_trending") and item["news"]:
            to_explain.append(item)

    def _fmt_headline(n):
        parts = [n.get("title") or ""]
        if n.get("source"):
            parts.append(f'({n["source"]})')
        if n.get("published_at"):
            parts.append(f'[{n["published_at"][:16]}]')
        if n.get("from_trends"):
            parts.append("[asociada por Google Trends]")
        return " ".join(p for p in parts if p)

    if to_explain:
        explanations = llm.explain_trends([{
            "keyword":   it["keyword"],
            "headlines": [_fmt_headline(n) for n in it["news"]],
        } for it in to_explain])
        for it in to_explain:
            it["why_trending"] = (explanations or {}).get(it["keyword"])
        if explanations:
            logger.info(f"✅ LLM explicó {len(explanations)}/{len(to_explain)} tendencias nuevas")

    scored = scoring.score_all_topics(
        trends_data, competitor_data or [], gsc_data=[],
        sections=KNOWN_SECTIONS_FALLBACK, learning=learning,
    )

    recs = opportunities.build_recommendations(scored, gsc_data=[], ga4_data=realtime or [])

    # --- ALERTAS (Etapa 3) ---
    # Se puntúa la ALERTABILIDAD sobre las tendencias enriquecidas (news +
    # why_trending + rank), NO sobre `scored`: el score de recomendación
    # descarta temas de bajo tráfico Trends (una muerte, un feriado) que sí son
    # noticia. alerting.build_alerts consolida además eventos fragmentados.
    candidate_alerts = alerting.build_alerts(
        trends_data, sections=KNOWN_SECTIONS_FALLBACK,
    )
    try:
        already_alerted = get_recent_alerts(hours=ALERT_DEDUP_HOURS)
    except Exception as e:
        # Sin la lista de alertas previas NO se alerta en esta corrida. Antes
        # se seguía con la lista vacía y el dedup quedaba ciego: el 15-sep a
        # las 20:54 se repitieron las tres alertas de las 19:46 ("libertadores",
        # "sismo perú", "boca vs"). Saltarse una corrida cuesta 15 min;
        # repetir alertas cuesta la confianza del equipo en el panel.
        logger.warning(f"No se pudo leer las alertas recientes ({e}); "
                       f"se omiten las alertas de esta corrida")
        candidate_alerts, already_alerted = [], []

    sent_alerts = []
    for alert in candidate_alerts:
        section = alert["section"]
        title_key = (alert.get("title") or "").lower().strip()
        # Dedup por EVENTO, no por título exacto: Google Trends renombra el
        # mismo hecho entre corridas y así se colaban tres alertas del mismo
        # partido en un día (ver alerting.same_event).
        previa = next((a for a in already_alerted
                       if alerting.same_event(title_key, a.get("title"))), None)
        if previa:
            # La alerta guarda una foto fija: si la descripción cambió (p.ej.
            # porque se regeneró el contexto de la tendencia) se REFRESCA en
            # vez de dejar el texto viejo colgado, que era lo que pasaba antes.
            nueva_desc = alert.get("description")
            # La severidad solo SUBE: un partido que alertó como "media" y
            # horas después trae "campeón" pasa a "alta". Antes se refrescaba
            # el score pero no la severidad, y el panel mostraba "libertadores
            # 93/100 · media" — un número y una etiqueta que se contradecían.
            sube = alert["severity"] == "high" and previa.get("severity") != "high"
            if previa.get("id") and ((nueva_desc and nueva_desc != previa.get("description")) or sube):
                try:
                    refresh_alert(previa["id"], description=nueva_desc,
                                  url=alert.get("url"), score=alert.get("score"),
                                  severity="high" if sube else None)
                    previa["description"] = nueva_desc
                    if sube:
                        previa["severity"] = "high"
                    logger.info(f"Dedup: '{title_key}' ya alertado como "
                                f"'{previa.get('title')}'; se refrescó su descripción")
                    continue
                except Exception as e:
                    logger.warning(f"No se pudo refrescar la alerta '{title_key}': {e}")
            logger.info(f"Dedup: '{title_key}' es el mismo evento que "
                        f"'{previa.get('title')}' (últimas {ALERT_DEDUP_HOURS}h); se omite")
            continue
        try:
            recent = count_recent_alerts(section, minutes=60)
        except Exception:
            recent = 0
        if recent >= ALERT_MAX_PER_SECTION_PER_HOUR:
            logger.info(f"Anti-spam: '{section}' ya tiene {recent} alertas/hora; se omite")
            continue
        notify.dispatch_alert(alert)   # a Teams/WhatsApp si hay responsable
        sent_alerts.append(alert)
        already_alerted.append({"id": None, "title": title_key,
                                "description": alert.get("description"),
                                "severity": alert["severity"]})
        logger.info(
            f"🚨 Alerta [{alert['severity']}] {alert['score']}/100 · "
            f"'{title_key}' → {section} ({alert.get('_n_sources', 0)} fuentes)"
        )

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
