#!/usr/bin/env python3
"""
Etapa 1 — Benchmark de la mañana.
Corre 1 vez al día (~6-7 AM Lima). Revisa el rendimiento de AYER, lo cruza con
la competencia, audita las notas publicadas y destila aprendizajes (pesos de
scoring) que el radar de tiempo real usa el resto del día.
"""

import logging
import os
import re
import sys
from datetime import datetime, date
from urllib.parse import urlparse

from dotenv import load_dotenv
load_dotenv()

from config import SITE_DOMAIN, SERPAPI_QUERIES_PER_RUN
from collectors import marfeel, gsc, competitors, serpapi
from collectors.rpp_articles import parse_article
from analyzers import decay, onpage_audit, opportunities
from llm import provider as llm
from writers.supabase_writer import (
    save_run_log, save_traffic, save_traffic_channels, save_gsc_data,
    save_competitor_articles, save_decay, save_daily_insights,
    save_scoring_weights, save_onpage_audits, save_serp_opportunities,
    get_historical_traffic,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("run_morning")


# Contenido real de rpp.pe = notas (…-noticia-<id>) y coberturas en vivo (…-live-<id>).
# Todo lo demás (home, homes de sección /deportes, landings/herramientas, buscador,
# /ultimas-noticias, /tv-vivo, /audio/en-vivo, listados /noticias/..., widget mrf.io)
# NO es contenido editorial y se descarta antes de guardar/analizar.
_ARTICLE_RE = re.compile(r"-(noticia|live)-\d+", re.IGNORECASE)


def is_real_article(url):
    if not url:
        return False
    try:
        host = (urlparse(url).hostname or "").replace("www.", "")
    except Exception:
        return False
    if host != "rpp.pe" and not host.endswith(".rpp.pe"):
        return False
    return bool(_ARTICLE_RE.search(url))


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


def safe_save(name, func, run_data, *args, **kwargs):
    """
    Guarda de forma aislada: si un save falla, se loguea y se sigue con los
    demás (antes estaban todos en un try común, así que un solo error —p.ej. el
    del constraint de content_decay— abortaba el resto de guardados).
    """
    try:
        func(*args, **kwargs)
        logger.info(f"💾 {name}: guardado")
        return True
    except Exception as e:
        logger.error(f"❌ Error guardando {name}: {e}")
        run_data.setdefault("save_errors", []).append(name)
        return False


def _clamp(x, lo=0.7, hi=1.5):
    return max(lo, min(hi, x))


def compute_insights_and_weights(marfeel_perf, traffic_sources, quick_wins):
    """
    Rules-first: deriva insights narrativos + pesos de aprendizaje (multiplicadores
    por dimensión) a partir de qué funcionó ayer. Cuando entre Claude, este paso
    pasa a ser razonamiento real.
    """
    insights, weights = [], {}

    total_pv = sum((r.get("pageViewsTotal") or 0) for r in (traffic_sources or []))
    discover_pv = sum((r.get("pageViewsTotal") or 0)
                      for r in (traffic_sources or [])
                      if "discover" in (r.get("label") or "").lower())
    if total_pv:
        share = discover_pv / total_pv
        insights.append({
            "headline": f"Discover trajo {share*100:.0f}% del tráfico de ayer",
            "detail":   "Si Discover pesa mucho, conviene priorizar temas con potencial de Discover.",
            "evidence": {"discover_pv": discover_pv, "total_pv": total_pv},
        })
        weights["discover_potential"] = _clamp(1.0 + (share - 0.15) * 1.5)

    if marfeel_perf:
        top = max(marfeel_perf, key=lambda r: r.get("pageViewsTotal") or 0)
        insights.append({
            "headline": f"Nota más leída de ayer: {top.get('title') or top.get('label')}",
            "detail":   f"{top.get('pageViewsTotal', 0)} page views.",
            "evidence": {"url": top.get("label")},
        })

    if quick_wins:
        insights.append({
            "headline": f"{len(quick_wins)} quick wins en Search Console (posición 4-10)",
            "detail":   "Notas a un empujón de la página 1; priorizar su optimización on-page.",
            "evidence": {"count": len(quick_wins)},
        })

    return insights, weights


def collect_serp_opportunities(quick_wins, run_data):
    """
    Rules-first: sin SERPAPI_KEY simplemente no hay oportunidades SERP (no
    bloquea el resto del benchmark). Consulta como máximo SERPAPI_QUERIES_PER_RUN
    queries — las quick wins de GSC (posición 4-10) ya priorizadas por impresiones
    — para no acercarse al límite diario del free tier.
    """
    if not os.environ.get("SERPAPI_KEY") or not quick_wins:
        return []
    opportunities_out = []
    seen = set()
    for qw in quick_wins[:SERPAPI_QUERIES_PER_RUN]:
        q = qw.get("query")
        if not q or q in seen:
            continue
        seen.add(q)
        try:
            features = serpapi.fetch_serp_features(q)
        except Exception as e:
            logger.warning(f"SerpAPI falló para '{q}': {e}")
            continue
        snippet = features.get("featured_snippet")
        top_stories = features.get("top_stories") or []
        opportunities_out.append({
            "query":              q,
            "gsc_page":           qw.get("page"),
            "gsc_position":       qw.get("position"),
            "featured_snippet":   snippet,
            "rpp_has_snippet":    bool(snippet and SITE_DOMAIN in (snippet.get("source") or "")),
            "paa_questions":      features.get("paa_questions"),
            "top_stories":        top_stories,
            "rpp_in_top_stories": any(SITE_DOMAIN in (s.get("link") or "") for s in top_stories),
            "has_image_pack":     features.get("has_image_pack", False),
            "has_local_pack":     features.get("has_local_pack", False),
        })
    if opportunities_out:
        run_data["sources_ok"].append("serpapi")
    return opportunities_out


def run():
    today = date.today()
    run_data = {"started_at": datetime.now(), "sources_ok": [], "sources_failed": []}
    logger.info(f"🌅 Benchmark de la mañana — {today}")

    # --- RECOLECCIÓN ---
    marfeel_perf    = safe_collect("marfeel_yesterday", marfeel.fetch_yesterday_performance, run_data)
    marfeel_channel = safe_collect("marfeel_by_channel", marfeel.fetch_yesterday_by_channel, run_data)
    traffic_sources = safe_collect("marfeel_sources",   marfeel.fetch_traffic_sources,       run_data)
    gsc_search      = safe_collect("gsc_search",        gsc.fetch_search_performance,        run_data)
    gsc_discover    = safe_collect("gsc_discover",      gsc.fetch_discover_performance,      run_data)
    gsc_drops       = safe_collect("gsc_drops",         gsc.find_position_drops,             run_data)
    competitor_data = safe_collect("competitors",       competitors.fetch_all_competitors,   run_data)

    # Deja solo contenido editorial (fuera home, secciones, landings, mrf.io, audio/tv en vivo)
    marfeel_perf    = [r for r in (marfeel_perf or [])    if is_real_article(r.get("label"))]
    marfeel_channel = [r for r in (marfeel_channel or []) if is_real_article(r.get("page_path"))]
    logger.info(f"Filtrado a contenido: {len(marfeel_perf)} notas, {len(marfeel_channel)} filas por canal")

    # --- ANÁLISIS ---
    quick_wins = opportunities.find_gsc_quick_wins(gsc_search or [])
    insights, weights = compute_insights_and_weights(marfeel_perf or [], traffic_sources or [], quick_wins)

    # SerpApi: featured snippet / PAA / top stories para las quick wins de GSC
    # (rules-first: sin SERPAPI_KEY o sin quick wins, simplemente no hay datos).
    serp_opportunities = collect_serp_opportunities(quick_wins, run_data)

    # Content decay (tráfico de Marfeel vs histórico en Supabase)
    decay_list = []
    try:
        historical = get_historical_traffic(days=90)
        ga4_like = [{"page_path": r.get("label"), "sessions": r.get("pageViewsTotal", 0)}
                    for r in (marfeel_perf or [])]
        if historical:
            raw = decay.detect_content_decay(ga4_like, historical)
            decay_list = decay.prioritize_decay_articles(raw, gsc_search)
    except Exception as e:
        logger.warning(f"Decay analysis falló: {e}")

    # Auditoría on-page: quick wins (con su keyword) + CTR bajo (title/meta a
    # reescribir) + top notas de ayer. Son las notas donde más rinde optimizar.
    low_ctr = opportunities.find_low_ctr_opportunities(gsc_search or [])
    audits = []
    audit_targets = []
    for qw in quick_wins[:5]:
        audit_targets.append((qw["page"], qw.get("query")))
    for lc in low_ctr[:5]:
        audit_targets.append((lc["page"], None))
    for r in (marfeel_perf or [])[:3]:
        if r.get("label"):
            audit_targets.append((r["label"], None))
    seen = set()
    rewrite_items = []   # notas con problemas editoriales → reescritura LLM en batch
    for url, kw in audit_targets:
        if not url or url in seen:
            continue
        seen.add(url)
        parsed = parse_article(url)
        result = onpage_audit.audit_article(parsed, target_keyword=kw)
        result["target_keyword"] = kw
        result["title"] = parsed.get("title_tag")
        editorial = [i for i in result.get("issues", []) if i.get("class") == "editorial"]
        if editorial and not parsed.get("error"):
            rewrite_items.append((result, {
                "title":            parsed.get("title_tag"),
                "meta_description": parsed.get("meta_description"),
                "keyword":          kw,
                "issues":           editorial,
                "first_paragraph":  parsed.get("first_paragraph"),
            }))
        audits.append(result)

    # Fase 2 (LLM): el proveedor activo (Bedrock o Gemini, ver llm/provider.py)
    # reescribe título/meta/H2 de TODAS las notas con problemas editoriales en
    # UNA sola llamada. Rules-first: si no hay proveedor o falla, sin sugerencias.
    if rewrite_items:
        suggestions = llm.rewrite_onpage_batch([it for _, it in rewrite_items])
        if suggestions:
            for (result, _), sug in zip(rewrite_items, suggestions):
                result["suggestions"] = sug
            logger.info(f"✅ LLM reescribió {sum(1 for s in suggestions if s)}/{len(rewrite_items)} notas")

    # --- GUARDAR (cada save aislado: un fallo no bota a los demás) ---
    traffic_rows = [{
        "page_path":    r.get("label"),
        "sessions":     r.get("pageViewsTotal", 0),
        "unique_users": r.get("uniqueUsers"),
        "title":        r.get("title"),
        "source":       "marfeel",
    } for r in (marfeel_perf or []) if r.get("label")]
    gsc_rows_all = (gsc_search or []) + (gsc_discover or [])
    safe_save("own_traffic",          save_traffic,             run_data, traffic_rows, today)
    safe_save("own_traffic_channels", save_traffic_channels,    run_data, marfeel_channel or [], today)
    safe_save("gsc_daily",            save_gsc_data,            run_data, gsc_rows_all, today)
    safe_save("competitor_articles",  save_competitor_articles, run_data, competitor_data or [])
    safe_save("content_decay",        save_decay,               run_data, decay_list, today)
    safe_save("daily_insights",       save_daily_insights,      run_data, insights, today)
    safe_save("scoring_weights",      save_scoring_weights,     run_data, weights, today)
    safe_save("onpage_audits",        save_onpage_audits,       run_data, audits, today)
    safe_save("serp_opportunities",   save_serp_opportunities,  run_data, serp_opportunities, today)
    if run_data.get("save_errors"):
        run_data["error_log"] = "save_errors: " + ", ".join(run_data["save_errors"])

    # --- LOG ---
    run_data["finished_at"] = datetime.now()
    run_data["status"] = (
        "success" if not run_data["sources_failed"]
        else "partial" if run_data["sources_ok"] else "failed"
    )
    try:
        save_run_log(run_data)
    except Exception as e:
        logger.error(f"No se pudo guardar el run log: {e}")

    logger.info(f"🏁 Benchmark OK: {run_data['sources_ok']} | FAIL: {run_data['sources_failed']}")
    if run_data["status"] == "failed":
        sys.exit(1)


if __name__ == "__main__":
    run()
