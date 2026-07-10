"""
Collector del feed propio de RPP — "qué acaba de publicar rpp.pe".

A diferencia de Marfeel (que mide TRÁFICO: una nota recién publicada con pocas
visitas aún no aparece en su top), el RSS oficial lista lo último publicado sin
sesgo de audiencia — justo lo que se necesita para comparar contra lo que
publica la competencia y saber si RPP ya cubrió un tema.

Fuente: https://rpp.pe/rss (RSS 2.0, ~60 items, cubre ~20h; validado 2026-07-10:
trae title + link + pubDate fresca; la sección se deriva del path de la URL,
igual que en el dashboard de tráfico). El endpoint /sitemap-news.xml devuelve
HTML (soft-404), NO usar.
"""

import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import feedparser

from config import RPP_RSS_URL, RPP_OWN_WINDOW_HOURS
from article_filter import is_real_article  # mismo filtro editorial (notas/live)

logger = logging.getLogger(__name__)


def _parse_date(entry):
    val = getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
    if val:
        try:
            return datetime(*val[:6], tzinfo=timezone.utc)
        except Exception:
            pass
    return datetime.now(timezone.utc)


def _section_of(url):
    """Primer segmento del path como sección (deportes, economia, futbol...)."""
    try:
        seg = [s for s in urlparse(url).path.split("/") if s]
        return seg[0] if seg else ""
    except Exception:
        return ""


def fetch_recent_articles(window_hours=RPP_OWN_WINDOW_HOURS):
    """
    Devuelve las notas de rpp.pe publicadas en las últimas `window_hours`,
    como lista de dicts {title, url, published_at (iso), section}. Solo
    contenido editorial real (notas/live), ordenado de más reciente a más
    antiguo. Rules-first: si el RSS falla, devuelve [] (no rompe la corrida).
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=window_hours)
    try:
        feed = feedparser.parse(RPP_RSS_URL)
    except Exception as e:
        logger.warning(f"RSS propio de RPP falló: {e}")
        return []

    if not feed.entries:
        logger.warning("RSS propio de RPP: sin entradas")
        return []

    out = []
    for entry in feed.entries:
        url = getattr(entry, "link", "") or ""
        if not is_real_article(url):
            continue
        pub = _parse_date(entry)
        if pub < cutoff:
            continue
        out.append({
            "title":        (getattr(entry, "title", "") or "").strip(),
            "url":          url,
            "published_at": pub.isoformat(),
            "section":      _section_of(url),
        })

    out.sort(key=lambda a: a["published_at"], reverse=True)
    logger.info(f"RSS propio de RPP: {len(out)} notas en las últimas {window_hours}h")
    return out
