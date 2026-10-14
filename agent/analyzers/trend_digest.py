"""
analyzers/trend_digest.py — historia del día de las tendencias, para el correo.

Pedido del 2026-10-14: varios usuarios del panel usan la pestaña Tendencias y
quieren recibirla por correo (08:00, 13:00 y 18:00, lo envía /api/notificar
del dashboard). Para eso faltaban dos cosas que este módulo agrega:

1. **La historia del día.** Google Trends solo entrega el top 10 del momento
   (el feed ignora filtros de categoría y de período, probado) y `daily_trends`
   guarda solo ese top 10, porque cada corrida lo reemplaza. Un correo que
   diga "lo nuevo desde el anterior" necesita saber cuándo apareció cada una:
   `trend_sightings`.
2. **Categoría con contexto y cobertura de RPP.** La categoría del radar se
   decide por la palabra sola ("bono" salía entretenimiento). Aquí el LLM la
   decide mirando la noticia que explica la tendencia, con las categorías del
   correo (`TREND_EMAIL_CATEGORIES`). Y por cada tendencia se marca si RPP ya
   tiene nota, con la misma búsqueda de notas propias que usan las alertas.

Solo se paga lo nuevo: una tendencia ya categorizada no se vuelve a mandar al
modelo, y la cobertura de una pendiente se revisa como mucho una vez por hora.
"""

import logging
from datetime import datetime, timedelta, timezone

from analyzers import alert_review, evidence
from collectors import rpp_own_feed
from config import (
    TREND_EMAIL_CATEGORIES, TREND_RPP_RECHECK_MINUTES, TREND_ENRICH_MAX_PER_RUN,
    ALERT_RPP_WINDOW_HOURS,
)
from llm import provider as llm
from text_keys import normalize_text
from writers.supabase_writer import (
    save_trend_sightings, get_trend_sightings, update_trend_sighting,
)

logger = logging.getLogger(__name__)


def _fecha(valor):
    try:
        return datetime.fromisoformat(str(valor).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def track_and_enrich(trends_data, today, seo_keys=None):
    """
    Guarda las tendencias de esta corrida en la historia del día y completa
    categoría y cobertura de RPP de las que lo necesiten. Nunca lanza: el
    correo de tendencias no debe poder tumbar el radar.
    """
    if not trends_data:
        return
    try:
        # Sin notas de secciones SEO de otros medios (gestion.pe/mix/...): el
        # correo enlaza la primera noticia de cada tendencia.
        limpias = []
        for t in trends_data:
            news = [n for n in (t.get("news") or []) if not alert_review.is_seo_content(n, seo_keys)]
            limpias.append(dict(t, news=news))
        save_trend_sightings(limpias, today, normalize_text)
        filas = {f["keyword_key"]: f for f in get_trend_sightings(today)}
    except Exception as e:
        logger.warning(f"Historia de tendencias: no se pudo guardar ({e})")
        return

    ahora = datetime.now(timezone.utc)
    pendientes = []
    for t in limpias:
        key = normalize_text(t["keyword"])
        fila = filas.get(key)
        if not fila:
            continue
        sin_categoria = not fila.get("categoria")
        revisada = _fecha(fila.get("rpp_checked_at"))
        revisar_rpp = not fila.get("rpp_url") and (
            revisada is None or ahora - revisada > timedelta(minutes=TREND_RPP_RECHECK_MINUTES))
        if sin_categoria or revisar_rpp:
            pendientes.append((key, t, fila))
    if not pendientes:
        return
    pendientes = pendientes[:TREND_ENRICH_MAX_PER_RUN]

    # RPP entre las noticias de la tendencia: cubierta, sin preguntarle a nadie.
    directas = {}
    for key, t, _ in pendientes:
        propia = next((n for n in t.get("news") or [] if evidence.is_own_source(n)), None)
        if propia:
            directas[key] = propia

    try:
        own = rpp_own_feed.fetch_recent_articles(window_hours=ALERT_RPP_WINDOW_HOURS)
    except Exception as e:
        logger.warning(f"Historia de tendencias: RSS propio no disponible ({e})")
        own = []

    items, candidatas = [], []
    for key, t, _ in pendientes:
        rpp = [] if key in directas else alert_review.rpp_candidates(
            {"title": t["keyword"], "_keywords": [t["keyword"]], "_news": t.get("news") or []}, own)
        candidatas.append(rpp)
        items.append({
            "keyword":   t["keyword"],
            "why":       t.get("why_trending") or "",
            "titulares": [n.get("title") or "" for n in (t.get("news") or [])],
            "rpp":       [r["title"] for r in rpp],
        })

    veredictos = llm.enrich_trends(items, TREND_EMAIL_CATEGORIES) or {}
    marcadas, categorizadas = 0, 0
    for i, (key, t, fila) in enumerate(pendientes):
        v = veredictos.get(i) or {}
        campos = {}
        if not fila.get("categoria") and v.get("categoria"):
            campos["categoria"] = v["categoria"]
            categorizadas += 1
        nota = None
        if key in directas:
            n = directas[key]
            nota = {"url": n.get("source_url") or n.get("url"), "title": n.get("title")}
        elif isinstance(v.get("rpp"), int) and 0 <= v["rpp"] < len(candidatas[i]):
            nota = candidatas[i][v["rpp"]]
        if nota:
            campos["rpp_url"] = nota.get("url")
            campos["rpp_title"] = (nota.get("title") or "")[:300]
            marcadas += 1
        # Se marca como revisada solo si hubo veredicto (o cobertura directa):
        # con el LLM caído se reintenta en la siguiente corrida.
        if v or key in directas:
            campos["rpp_checked_at"] = ahora.isoformat()
        if campos:
            try:
                update_trend_sighting(today, key, **campos)
            except Exception as e:
                logger.warning(f"Historia de tendencias: no se pudo actualizar '{t['keyword']}' ({e})")
    logger.info(f"📈 Historia de tendencias: {len(limpias)} vigentes, {len(pendientes)} revisadas, "
                f"{categorizadas} categorizadas, {marcadas} con nota de RPP")
