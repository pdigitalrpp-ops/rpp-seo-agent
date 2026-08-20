"""
collectors/watchlist.py — vigilancia de temas por keyword ("Google Alerts" propias).

QUÉ RESUELVE
------------
Las alertas de la Etapa 3 (analyzers/alerting.py) nacen del feed de Google
Trends Perú: ~10 keywords/día, las más buscadas del país. Eso deja ciego al
agente frente a temas de nicho pero editorialmente valiosos — un concierto que
se anuncia, una empresa, un vocero, un juicio. Nunca van a ser top-10 nacional,
pero el equipo sí quiere enterarse apenas alguien publique algo al respecto.

Acá el equipo define QUÉ vigilar (tabla `watch_keywords`, administrada desde el
dashboard) y el radar reporta las publicaciones nuevas.

TRES FUENTES, DELIBERADAMENTE
-----------------------------
1. **Google News RSS por keyword** (motor principal). Mismo mecanismo probado en
   `trend_news.py` y `competitors.py`: funciona desde GitHub Actions, es gratis
   y no necesita API key. La búsqueda WEB de Google no es alternativa: no tiene
   RSS, su API oficial (Custom Search JSON API) está cerrada a clientes nuevos
   desde 2025, y su filtro de fecha tiene granularidad mínima de 1 día. Google
   News además indexa notas de medios en minutos, que es justo lo que importa.
2. **Feeds RSS directos** (`WATCH_PRIMARY_FEEDS` globales + `extra_feeds` por
   keyword). Son las fuentes primarias que Google News no cubre: ticketeras,
   agendas, salas de prensa. Llegan ANTES que cualquier buscador porque son el
   origen del anuncio.
3. **La competencia que ya está en la DB** (`competitor_articles`). Costo cero:
   esos titulares ya se recolectaron en esta misma corrida del radar.

MATCHING: DOS CRITERIOS DISTINTOS A PROPÓSITO
---------------------------------------------
- Los hits de **Google News** NO se re-filtran por titular. Google matchea
  contra el CUERPO del artículo, así que "concierto en lima" devuelve
  legítimamente una nota titulada "Shakira anuncia fecha en el Estadio
  Nacional". Re-verificar contra el titular tiraría justo los hallazgos buenos.
  Solo se aplican los términos de exclusión (`-palabra`).
- Los hits de **feeds directos y de la DB** sí pasan por el matcher local: ahí
  nadie buscó nada, se está escaneando un feed completo, y sin filtro entraría
  todo.

Rules-first, sin LLM: la keyword la escribió una persona, no hay nada que
inferir. Si aparecen falsos positivos se descartan desde el panel (`dismissed`).
"""

import logging
import unicodedata
from datetime import datetime, timedelta, timezone
from urllib.parse import quote_plus, urlparse

import feedparser

from config import (
    WATCH_NEWS_WINDOW, WATCH_MAX_HITS_PER_KEYWORD, WATCH_MAX_AGE_HOURS,
    WATCH_PRIMARY_FEEDS,
)

logger = logging.getLogger(__name__)

# hl/gl/ceid = español de Perú, igual que trend_news.py y competitors.py.
NEWS_SEARCH_URL = (
    "https://news.google.com/rss/search?q={query}+when:{window}"
    "&hl=es-419&gl=PE&ceid=PE:es-419"
)


# ---------------------------------------------------------------------------
# Normalización y parseo de la query
# ---------------------------------------------------------------------------

def _normalize(text):
    """Minúsculas sin tildes ni diacríticos, para comparar titulares."""
    txt = (text or "").lower()
    return "".join(
        c for c in unicodedata.normalize("NFD", txt)
        if unicodedata.category(c) != "Mn"
    )


def parse_query(keyword):
    """
    Parsea la keyword al criterio de match LOCAL (feeds directos y DB).

    Soporta el subconjunto de la sintaxis de Google News que tiene sentido
    aplicar sobre un titular suelto:
      "frase exacta"  → la frase debe aparecer completa
      palabra         → todas las palabras sueltas deben aparecer (AND)
      -palabra        → si aparece, se descarta el resultado

    Los operadores que solo entiende Google (site:, OR) se ignoran acá: viajan
    intactos en la query de Google News, que es donde sí significan algo.
    """
    raw = keyword or ""
    phrases, tokens, excludes = [], [], []

    rest = raw
    # Frases entrecomilladas primero, para que sus espacios no se partan.
    while '"' in rest:
        start = rest.index('"')
        end = rest.find('"', start + 1)
        if end == -1:
            break
        phrase = _normalize(rest[start + 1:end]).strip()
        if phrase:
            phrases.append(phrase)
        rest = rest[:start] + " " + rest[end + 1:]

    for word in rest.split():
        if word.startswith("-") and len(word) > 1:
            excludes.append(_normalize(word[1:]))
            continue
        if ":" in word or word.upper() == "OR":
            continue          # site:, intitle:, OR → solo para Google
        norm = _normalize(word).strip()
        if norm:
            tokens.append(norm)

    return {"phrases": phrases, "tokens": tokens, "excludes": excludes}


def matches(text, parsed):
    """¿El titular satisface el criterio local de la keyword?"""
    norm = _normalize(text)
    if not norm:
        return False
    if any(x in norm for x in parsed["excludes"]):
        return False
    if not parsed["phrases"] and not parsed["tokens"]:
        return False          # keyword vacía: no matchea nada, no matchea todo
    if not all(p in norm for p in parsed["phrases"]):
        return False
    return all(t in norm for t in parsed["tokens"])


def is_excluded(text, parsed):
    """Solo los términos negativos. Es lo único que se aplica a Google News."""
    norm = _normalize(text)
    return any(x in norm for x in parsed["excludes"])


# ---------------------------------------------------------------------------
# Parseo de entradas RSS
# ---------------------------------------------------------------------------

def _domain(url):
    try:
        host = urlparse(url or "").netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except (ValueError, AttributeError):
        return ""


def _coerce_dt(value):
    """
    datetime UTC aware desde lo que sea que traiga la fuente, o None.
    Necesario porque `competitor_articles` guarda `published_at` como STRING
    ISO (competitors.py lo serializa antes de devolverlo) mientras que los
    feeds RSS dan struct_time — compararlos sin normalizar revienta.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _published_at(entry):
    """datetime UTC aware de la entrada, o None si el feed no la trae."""
    for attr in ("published_parsed", "updated_parsed"):
        val = getattr(entry, attr, None)
        if val:
            try:
                return datetime(*val[:6], tzinfo=timezone.utc)
            except (TypeError, ValueError):
                continue
    return None


def _entry_to_hit(entry, found_via, fallback_source=""):
    """Normaliza una entrada de feedparser al dict de hallazgo, o None."""
    title = (entry.get("title") or "").strip()
    url = (entry.get("link") or "").strip()
    if not title or not url:
        return None

    # Google News formatea "Titular - Medio" y repite el medio en <source>.
    source = fallback_source
    src = entry.get("source")
    if src:
        source = (src.get("title") or "").strip() or source
    if source and title.endswith(f" - {source}"):
        title = title[: -len(source) - 3].strip()
    if not source:
        source = _domain(url)

    return {
        "title":        title,
        "url":          url,
        "source":       source,
        "published_at": _published_at(entry),
        "found_via":    found_via,
    }


def _fetch_feed(url, found_via, fallback_source="", limit=50):
    """Entradas normalizadas de un feed RSS cualquiera. Nunca lanza."""
    try:
        feed = feedparser.parse(url)
        hits = []
        for entry in feed.entries[:limit]:
            hit = _entry_to_hit(entry, found_via, fallback_source)
            if hit:
                hits.append(hit)
        return hits
    except Exception as e:
        logger.warning(f"Feed '{url}' falló: {e}")
        return []


# ---------------------------------------------------------------------------
# Recolección
# ---------------------------------------------------------------------------

def fetch_google_news(keyword, window=None, limit=None):
    """Publicaciones recientes de Google News para la keyword (verbatim)."""
    url = NEWS_SEARCH_URL.format(
        query=quote_plus(keyword),
        window=window or WATCH_NEWS_WINDOW,
    )
    return _fetch_feed(
        url, "google_news",
        limit=limit or WATCH_MAX_HITS_PER_KEYWORD,
    )


def _is_fresh(hit, cutoff):
    """Sin fecha se acepta: varios feeds no la traen y el dedup por URL ya
    impide que un artículo viejo se reporte más de una vez."""
    pub = _coerce_dt(hit.get("published_at"))
    return pub is None or pub >= cutoff


def collect_hits(keywords, competitor_articles=None, now=None):
    """
    Devuelve los hallazgos de todas las keywords activas.

    `keywords` son filas de watch_keywords ({id, keyword, label, extra_feeds}).
    `competitor_articles` es lo que el radar ya recolectó en esta corrida
    ({title, url, site, published_at}); se cruza sin costo de red.

    Cada hallazgo: {keyword_id, keyword, title, url, source, published_at,
    found_via}. El dedup definitivo lo hace la constraint (keyword_id, url) de
    watch_hits; acá solo se deduplica dentro de la propia corrida.
    """
    if not keywords:
        return []

    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=WATCH_MAX_AGE_HOURS)

    # Los feeds globales se descargan UNA vez y se cruzan contra todas las
    # keywords (si se bajaran por keyword serían N descargas del mismo feed).
    global_entries = []
    for feed in WATCH_PRIMARY_FEEDS or []:
        global_entries.extend(
            _fetch_feed(feed["url"], f"feed:{feed['name']}", feed["name"])
        )

    # La competencia ya está en memoria: se adapta al mismo formato de hallazgo.
    competitor_entries = []
    for art in competitor_articles or []:
        if not art.get("title") or not art.get("url"):
            continue
        competitor_entries.append({
            "title":        art["title"],
            "url":          art["url"],
            "source":       art.get("site") or _domain(art["url"]),
            "published_at": _coerce_dt(art.get("published_at")),
            "found_via":    "competencia",
        })

    out = []
    for row in keywords:
        kw = (row.get("keyword") or "").strip()
        if not kw:
            continue
        parsed = parse_query(kw)
        found, seen_urls = [], set()

        def add(hit):
            url = hit.get("url")
            if not url or url in seen_urls or not _is_fresh(hit, cutoff):
                return
            seen_urls.add(url)
            found.append(dict(hit, keyword_id=row.get("id"), keyword=kw))

        # ORDEN DELIBERADO: primero las fuentes de match ESTRICTO (feeds
        # directos y competencia, filtradas por titular) y al final Google News
        # (match laxo, contra el cuerpo del artículo). El corte
        # `[:WATCH_MAX_HITS_PER_KEYWORD]` de abajo descarta por el final, así
        # que si sobran resultados se pierden los más laxos, no el anuncio de
        # la fuente primaria — que es lo más valioso y lo que llega antes.

        # 1. Feeds directos: nadie buscó nada, hay que filtrar por titular.
        per_keyword_entries = []
        for feed_url in (row.get("extra_feeds") or []):
            per_keyword_entries.extend(
                _fetch_feed(feed_url, f"feed:{_domain(feed_url)}", _domain(feed_url))
            )
        for hit in global_entries + per_keyword_entries:
            if matches(hit["title"], parsed):
                add(hit)

        # 2. Competencia ya recolectada en esta corrida: mismo criterio local.
        for hit in competitor_entries:
            if matches(hit["title"], parsed):
                add(hit)

        # 3. Google News: Google ya matcheó contra el CUERPO del artículo, así
        #    que re-verificar por titular tiraría los hallazgos buenos (ver el
        #    docstring del módulo). Solo se aplican los términos negativos.
        for hit in fetch_google_news(kw):
            if not is_excluded(hit["title"], parsed):
                add(hit)

        if found:
            kept = found[:WATCH_MAX_HITS_PER_KEYWORD]
            out.extend(kept)
            extra = len(found) - len(kept)
            logger.info(
                f"🔔 Vigilancia '{kw}': {len(kept)} publicación(es)"
                + (f" (+{extra} por encima del tope, descartadas)" if extra else "")
            )

    logger.info(
        f"Vigilancia: {len(out)} hallazgos sobre {len(keywords)} keyword(s) activas"
    )
    return out
