import os
import logging
from datetime import datetime, date, timedelta
from supabase import create_client, Client

logger = logging.getLogger(__name__)
_client: Client = None


def _get_client():
    global _client
    if _client is None:
        url = os.environ["SUPABASE_URL"]
        key = os.environ["SUPABASE_KEY"]
        _client = create_client(url, key)
    return _client


def save_run_log(run_data):
    sb = _get_client()
    sb.table("agent_runs").insert({
        "run_date":      str(date.today()),
        "started_at":    run_data.get("started_at", datetime.now()).isoformat(),
        "finished_at":   run_data.get("finished_at", datetime.now()).isoformat(),
        "status":        run_data.get("status", "unknown"),
        "sources_ok":    run_data.get("sources_ok", []),
        "sources_failed": run_data.get("sources_failed", []),
        "error_log":     run_data.get("error_log", ""),
    }).execute()


def save_trends(trends_list, run_date):
    if not trends_list:
        return
    sb = _get_client()
    # El radar corre cada ~10 min: cada corrida REEMPLAZA el snapshot del día
    # con las tendencias vigentes (no histórico intradía acumulado).
    sb.table("daily_trends").delete().eq("date", str(run_date)).execute()
    rows = [{
        "date":         str(run_date),
        "keyword":      t["keyword"],
        "growth_score": t.get("growth_score"),
        "category":     t.get("category"),
        "geo":          t.get("geo", "PE"),
        "rank":         t.get("rank"),
    } for t in trends_list]
    sb.table("daily_trends").insert(rows).execute()
    logger.info(f"Guardadas {len(rows)} tendencias")


def save_gsc_data(gsc_rows, run_date):
    if not gsc_rows:
        return
    sb = _get_client()
    # Borra la fecha y reinserta: re-correr el benchmark reemplaza el snapshot
    # (append-only duplicaba todo el set en cada corrida del día).
    sb.table("gsc_daily").delete().eq("date", str(run_date)).execute()
    rows = [{
        "date":        str(run_date),
        "page":        r["page"],
        "query":       r.get("query"),
        "clicks":      r.get("clicks", 0),
        "impressions": r.get("impressions", 0),
        "ctr":         r.get("ctr", 0),
        "position":    r.get("position", 0),
        "search_type": r.get("search_type", "web"),
    } for r in gsc_rows]
    for i in range(0, len(rows), 500):
        sb.table("gsc_daily").insert(rows[i:i+500]).execute()
    logger.info(f"Guardadas {len(rows)} filas GSC")


def save_traffic(traffic_rows, run_date):
    if not traffic_rows:
        return
    sb = _get_client()
    # Idempotente por fecha (grano: 1 fila/artículo/día). No toca otros días,
    # así que el histórico que usa el decay queda intacto.
    sb.table("own_traffic").delete().eq("date", str(run_date)).execute()
    rows = [{
        "date":                 str(run_date),
        "page_path":            r["page_path"],
        "sessions":             r.get("sessions", 0),
        "unique_users":         r.get("unique_users"),
        "title":                r.get("title"),
        "source":               r.get("source"),
        "bounce_rate":          r.get("bounce_rate"),
        "avg_session_duration": r.get("avg_session_duration"),
    } for r in traffic_rows]
    sb.table("own_traffic").insert(rows).execute()
    logger.info(f"Guardadas {len(rows)} filas de tráfico")


def save_traffic_channels(channel_rows, run_date):
    """Tráfico por (artículo × canal). Borra+reinserta la fecha (idempotente)."""
    sb = _get_client()
    sb.table("own_traffic_channels").delete().eq("date", str(run_date)).execute()
    if not channel_rows:
        return
    rows = [{
        "date":         str(run_date),
        "page_path":    r["page_path"],
        "title":        r.get("title"),
        "channel":      r.get("channel") or "Otros",
        "pageviews":    r.get("pageviews", 0),
        "unique_users": r.get("unique_users"),
    } for r in channel_rows if r.get("page_path")]
    if rows:
        sb.table("own_traffic_channels").insert(rows).execute()
    logger.info(f"Guardadas {len(rows)} filas de tráfico por canal")


def save_competitor_articles(articles):
    if not articles:
        return
    sb = _get_client()
    rows = [{
        "fetched_date": str(date.today()),
        "site":         a["site"],
        "title":        a["title"],
        "url":          a.get("url"),
        "published_at": a.get("published_at"),
        "category":     a.get("category"),
    } for a in articles]
    sb.table("competitor_articles").upsert(rows, on_conflict="url", ignore_duplicates=True).execute()
    logger.info(f"Guardados {len(rows)} artículos de competencia")


def save_recommendations(recs, run_date):
    if not recs:
        return
    sb = _get_client()
    sb.table("recommendations").delete().eq("date", str(run_date)).execute()
    rows = [{
        "date":            str(run_date),
        "rank":            r.get("rank"),
        "title_suggested": r.get("title_suggested"),
        "angle":           r.get("angle"),
        "why_now":         r.get("why_now"),
        "data_source":     r.get("data_source"),
        "urgency":         r.get("urgency"),
        "format":          r.get("format"),
        "section":         r.get("section"),
        "score":           r.get("score"),
        "category":        r.get("category"),
        "publish_window":  r.get("publish_window"),
    } for r in recs]
    sb.table("recommendations").insert(rows).execute()
    logger.info(f"Guardadas {len(rows)} recomendaciones")


def save_alerts(alerts):
    if not alerts:
        return
    sb = _get_client()
    rows = [{
        "date":        str(date.today()),
        "type":        a["type"],
        "severity":    a.get("severity", "medium"),
        "title":       a["title"],
        "description": a.get("description"),
        "url":         a.get("url"),
        "section":     a.get("section"),
        "score":       a.get("score"),
    } for a in alerts]
    sb.table("alerts").insert(rows).execute()
    logger.info(f"Guardadas {len(rows)} alertas")


def save_decay(decay_list, run_date):
    if not decay_list:
        return
    sb = _get_client()
    rows = [{
        "detected_date":   str(run_date),
        "page_path":       d["page_path"],
        "current_traffic": d.get("current_traffic"),
        "peak_traffic":    d.get("peak_traffic"),
        "drop_percentage": d.get("drop_percentage"),
        "suggested_action": d.get("suggested_action"),
    } for d in decay_list]
    sb.table("content_decay").upsert(rows, on_conflict="page_path").execute()
    logger.info(f"Guardados {len(rows)} artículos en decay")


def save_publishing_windows(windows_data, run_date):
    if not windows_data:
        return
    sb = _get_client()
    sb.table("publishing_windows").upsert({
        "updated_date":   str(run_date),
        "overall_best":   windows_data.get("overall_best"),
        "morning_peak":   windows_data.get("morning_peak"),
        "afternoon_peak": windows_data.get("afternoon_peak"),
        "evening_peak":   windows_data.get("evening_peak"),
        "raw_data":       windows_data,
    }, on_conflict="updated_date").execute()


def get_historical_traffic(days=90):
    sb = _get_client()
    cutoff = str((datetime.now() - timedelta(days=days)).date())
    result = sb.table("own_traffic").select("page_path,sessions,date").gte("date", cutoff).execute()
    return result.data if result.data else []


# ---------------------------------------------------------------------------
# v2 — insights del benchmark, pesos de aprendizaje y auditorías on-page
# ---------------------------------------------------------------------------

def save_daily_insights(insights, run_date):
    if not insights:
        return
    sb = _get_client()
    sb.table("daily_insights").delete().eq("date", str(run_date)).execute()
    rows = [{
        "date":     str(run_date),
        "section":  i.get("section"),
        "category": i.get("category"),
        "headline": i["headline"],
        "detail":   i.get("detail"),
        "evidence": i.get("evidence"),
    } for i in insights]
    sb.table("daily_insights").insert(rows).execute()
    logger.info(f"Guardados {len(rows)} insights del día")


def save_scoring_weights(weights, run_date):
    """weights: dict {dimension: {"multiplier": float, "rationale": str}} o {dimension: float}."""
    if not weights:
        return
    sb = _get_client()
    sb.table("scoring_weights").delete().eq("date", str(run_date)).execute()
    rows = []
    for dim, val in weights.items():
        if isinstance(val, dict):
            rows.append({"date": str(run_date), "dimension": dim,
                         "multiplier": val.get("multiplier", 1.0), "rationale": val.get("rationale")})
        else:
            rows.append({"date": str(run_date), "dimension": dim, "multiplier": val})
    sb.table("scoring_weights").insert(rows).execute()
    logger.info(f"Guardados {len(rows)} pesos de aprendizaje")


def get_scoring_weights(run_date=None):
    """Devuelve {dimension: multiplier} de la fecha dada (o la más reciente)."""
    sb = _get_client()
    q = sb.table("scoring_weights").select("dimension,multiplier")
    if run_date:
        q = q.eq("date", str(run_date))
    else:
        q = q.order("date", desc=True).limit(20)
    result = q.execute()
    return {r["dimension"]: r["multiplier"] for r in (result.data or [])}


def count_recent_alerts(section, minutes=60):
    """Anti-spam: cuántas alertas se enviaron a una sección en los últimos N minutos."""
    sb = _get_client()
    cutoff = (datetime.now() - timedelta(minutes=minutes)).isoformat()
    result = (sb.table("alerts").select("id", count="exact")
              .eq("section", section).gte("created_at", cutoff).execute())
    return result.count or 0


def save_onpage_audits(audits, run_date):
    if not audits:
        return
    sb = _get_client()
    # Borra las auditorías del día y reinserta, para que re-correr el benchmark
    # reemplace en vez de acumular duplicados.
    sb.table("onpage_audits").delete().eq("audited_date", str(run_date)).execute()
    rows = [{
        "audited_date":   str(run_date),
        "url":            a["url"],
        "title":          a.get("title"),
        "target_keyword": a.get("target_keyword"),
        "score":          a.get("score"),
        "issues":         a.get("issues"),
        "suggestions":    a.get("suggestions"),   # reescritura LLM (título/meta/H2)
    } for a in audits]
    sb.table("onpage_audits").insert(rows).execute()
    logger.info(f"Guardadas {len(rows)} auditorías on-page")


def save_serp_opportunities(opportunities, run_date):
    if not opportunities:
        return
    sb = _get_client()
    # Snapshot del día: borra y reinserta (mismo patrón que gsc_daily/onpage_audits).
    sb.table("serp_opportunities").delete().eq("date", str(run_date)).execute()
    rows = [{
        "date":                    str(run_date),
        "query":                   o["query"],
        "gsc_page":                o.get("gsc_page"),
        "gsc_position":            o.get("gsc_position"),
        "has_featured_snippet":    bool(o.get("featured_snippet")),
        "featured_snippet_source": (o.get("featured_snippet") or {}).get("source"),
        "rpp_has_snippet":         o.get("rpp_has_snippet", False),
        "paa_questions":           o.get("paa_questions") or [],
        "top_stories":             o.get("top_stories") or [],
        "rpp_in_top_stories":      o.get("rpp_in_top_stories", False),
        "has_image_pack":          o.get("has_image_pack", False),
        "has_local_pack":          o.get("has_local_pack", False),
    } for o in opportunities]
    sb.table("serp_opportunities").insert(rows).execute()
    logger.info(f"Guardadas {len(rows)} oportunidades SERP")
