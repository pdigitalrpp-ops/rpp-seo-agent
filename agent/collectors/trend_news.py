"""
Noticias de Google News por tendencia — el "por qué es tendencia".

Para cada keyword del radar de tendencias se consulta el RSS de búsqueda de
Google News (mismo mecanismo que usa collectors/competitors.py para La
República/Perú21/Infobae, funciona desde GitHub Actions) y se extraen los
titulares principales. Esas noticias son la evidencia de por qué el tema está
en tendencia, y alimentan el resumen del LLM (llm.explain_trends).
"""

import logging
from urllib.parse import quote_plus

import feedparser

logger = logging.getLogger(__name__)

# hl/gl/ceid = español de Perú; when:2d limita a noticias recientes (una
# tendencia de hoy siempre tiene cobertura de las últimas 48h).
NEWS_SEARCH_URL = (
    "https://news.google.com/rss/search?q={query}+when:2d"
    "&hl=es-419&gl=PE&ceid=PE:es-419"
)


def fetch_news_for_keyword(keyword, limit=5):
    """
    Titulares recientes de Google News para una keyword.
    Devuelve lista de dicts {title, source, source_url, url, published_at}
    (posiblemente vacía; nunca lanza).
    """
    try:
        feed = feedparser.parse(NEWS_SEARCH_URL.format(query=quote_plus(keyword)))
        items = []
        for entry in feed.entries[:limit]:
            title = (entry.get("title") or "").strip()
            if not title:
                continue
            # Google News formatea "Titular - Medio"; el medio también viene
            # en <source>. Se limpia el sufijo para no repetirlo.
            source = ""
            source_url = ""
            src = entry.get("source")
            if src:
                source = (src.get("title") or "").strip()
                source_url = (src.get("href") or "").strip()
            if source and title.endswith(f" - {source}"):
                title = title[: -len(source) - 3].strip()
            published = entry.get("published") or ""
            items.append({
                "title":        title,
                "source":       source,
                "source_url":   source_url,
                "url":          (entry.get("link") or "").strip(),
                "published_at": published,
            })
        return items
    except Exception as e:
        logger.warning(f"Google News para '{keyword}' falló: {e}")
        return []


def fetch_news_for_trends(trends, limit=5):
    """
    {keyword: [noticias]} para cada tendencia de la lista. Secuencial (son
    ~10 requests RSS, sin rate limit conocido).
    """
    out = {}
    for t in trends:
        kw = t.get("keyword")
        if not kw:
            continue
        out[kw] = fetch_news_for_keyword(kw, limit=limit)
    total = sum(len(v) for v in out.values())
    logger.info(f"Google News: {total} noticias para {len(out)} tendencias")
    return out
