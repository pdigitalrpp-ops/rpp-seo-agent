"""
Auditoría SEO on-page de notas ya publicadas en rpp.pe.
Toma el dict que devuelve collectors.rpp_articles.parse_article y emite una
lista priorizada de puntos críticos de mejora, más un score de salud 0-100.

Pensado como las tareas que hace un SEO de contenidos al revisar una nota:
title, meta description, H1, estructura, profundidad, enlazado interno,
alt de imágenes, structured data, indexabilidad y readiness para Discover.
"""

import logging
from datetime import datetime, timezone
from urllib.parse import urlparse

from config import ONPAGE

logger = logging.getLogger(__name__)

# Penalización en el score 0-100 por severidad
_PENALTY = {"high": 20, "medium": 10, "low": 5}

# Clase de cada issue:
#  - "editorial": lo arregla el redactor al escribir/editar la nota.
#  - "platform":  es sistémico (CMS/plantilla), lo arregla dev/SEO técnico;
#                 sale igual en casi todas las notas, así que NO cuenta para el
#                 score por-nota (si no, no prioriza) y se muestra agregado aparte.
_CHECK_CLASS = {
    "title":            "editorial",
    "meta_description": "editorial",
    "h1":               "editorial",
    "headings":         "editorial",
    "depth":            "editorial",
    "keyword_intro":    "editorial",
    "internal_links":   "editorial",
    "image_alt":        "editorial",
    "freshness":        "editorial",
    "structured_data":  "platform",
    "indexability":     "platform",
    "canonical":        "platform",
    "discover":         "platform",
    "social":           "platform",
}


def _issue(check, severity, message):
    return {"check": check, "severity": severity, "message": message,
            "class": _CHECK_CLASS.get(check, "editorial")}


def _norm_url(u):
    """host+path en minúsculas, sin www, sin query/fragment ni slash final."""
    if not u:
        return ""
    try:
        p = urlparse(u if "://" in u else "https://" + u.lstrip("/"))
    except Exception:
        return u.strip().lower()
    host = (p.hostname or "").replace("www.", "")
    path = (p.path or "").rstrip("/")
    return f"{host}{path}".lower()


def _days_since(iso_date):
    """Días desde una fecha ISO (datePublished/dateModified). None si no parsea."""
    if not iso_date:
        return None
    raw = str(iso_date).strip().replace("Z", "+00:00")
    for candidate in (raw, raw[:19]):   # tolera con y sin offset
        try:
            dt = datetime.fromisoformat(candidate)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return (datetime.now(timezone.utc) - dt).days
        except ValueError:
            continue
    return None


def audit_article(parsed, target_keyword=None):
    """
    parsed: salida de rpp_articles.parse_article
    target_keyword: keyword principal por la que queremos posicionar (opcional,
                    ej. la query de un quick-win de GSC).
    Devuelve {"url", "score", "issues": [...]}.
    """
    if not parsed or parsed.get("error"):
        return {"url": parsed.get("url"), "score": None,
                "issues": [_issue("fetch", "high", "No se pudo leer la nota")]}

    issues = []
    kw = (target_keyword or "").lower().strip()

    # --- Title tag ---
    title = parsed.get("title_tag") or ""
    if not title:
        issues.append(_issue("title", "high", "Sin <title>"))
    else:
        if len(title) > ONPAGE["title_max_len"]:
            issues.append(_issue("title", "medium",
                f"Title muy largo ({len(title)}c); se corta en Google (máx {ONPAGE['title_max_len']})"))
        elif len(title) < ONPAGE["title_min_len"]:
            issues.append(_issue("title", "low",
                f"Title corto ({len(title)}c); aprovechar más para keywords"))
        if kw and kw not in title.lower():
            issues.append(_issue("title", "medium", f"La keyword '{target_keyword}' no está en el title"))

    # --- Meta description ---
    md = parsed.get("meta_description")
    if not md:
        issues.append(_issue("meta_description", "high",
            "Sin meta description; Google inventa el snippet"))
    else:
        if len(md) < ONPAGE["meta_desc_min_len"]:
            issues.append(_issue("meta_description", "low",
                f"Meta description corta ({len(md)}c)"))
        elif len(md) > ONPAGE["meta_desc_max_len"]:
            issues.append(_issue("meta_description", "low",
                f"Meta description larga ({len(md)}c); se truncará"))
        if kw and kw not in md.lower():
            issues.append(_issue("meta_description", "low",
                f"La keyword '{target_keyword}' no está en la meta description"))

    # --- H1 ---
    h1s = parsed.get("h1s") or []
    if len(h1s) == 0:
        issues.append(_issue("h1", "high", "Sin H1"))
    elif len(h1s) > 1:
        issues.append(_issue("h1", "medium", f"{len(h1s)} H1 (debe haber uno solo)"))
    elif kw and kw not in h1s[0].lower():
        issues.append(_issue("h1", "medium", f"La keyword '{target_keyword}' no está en el H1"))

    # --- Estructura de subtítulos ---
    h2_count = parsed.get("h2_count", 0)
    if h2_count == 0:
        issues.append(_issue("headings", "medium",
            "Sin subtítulos H2; mala escaneabilidad y peor para featured snippets"))
    elif (parsed.get("word_count", 0) >= ONPAGE["long_article_words"]
          and h2_count < ONPAGE["long_article_min_h2"]):
        issues.append(_issue("headings", "low",
            f"Nota larga ({parsed.get('word_count')}p) con solo {h2_count} H2; "
            "conviene segmentar en más secciones"))

    # --- Profundidad ---
    wc = parsed.get("word_count", 0)
    if wc < ONPAGE["min_word_count"]:
        issues.append(_issue("depth", "medium",
            f"Solo {wc} palabras (mínimo sugerido {ONPAGE['min_word_count']})"))

    # --- Keyword en primer párrafo ---
    if kw and parsed.get("first_paragraph"):
        if kw not in parsed["first_paragraph"].lower():
            issues.append(_issue("keyword_intro", "low",
                f"La keyword '{target_keyword}' no aparece en el primer párrafo"))

    # --- Enlazado interno ---
    if parsed.get("internal_links", 0) < ONPAGE["min_internal_links"]:
        issues.append(_issue("internal_links", "medium",
            f"Solo {parsed.get('internal_links', 0)} enlaces internos (sugerido {ONPAGE['min_internal_links']}+)"))

    # --- Alt de imágenes ---
    if parsed.get("images_without_alt", 0) > 0:
        issues.append(_issue("image_alt", "low",
            f"{parsed['images_without_alt']} imágenes sin atributo alt"))

    # --- Structured data ---
    types = [t.lower() for t in (parsed.get("jsonld_types") or [])]
    if not any(t in types for t in ["newsarticle", "article"]):
        issues.append(_issue("structured_data", "medium",
            "Falta schema NewsArticle/Article (JSON-LD)"))

    # --- Indexabilidad ---
    robots = (parsed.get("robots") or "").lower()
    if "noindex" in robots:
        issues.append(_issue("indexability", "high", "La nota tiene noindex"))
    canonical = parsed.get("canonical")
    if not canonical:
        issues.append(_issue("canonical", "low", "Sin etiqueta canonical"))
    elif _norm_url(canonical) != _norm_url(parsed["url"]):
        issues.append(_issue("canonical", "medium",
            f"El canonical apunta a otra URL ({canonical}); revisar canibalización/indexación"))

    # --- Discover readiness ---
    if not parsed.get("og_image"):
        issues.append(_issue("discover", "medium", "Sin og:image; no califica para Discover"))
    elif parsed.get("og_image_width") and parsed["og_image_width"] < ONPAGE["discover_min_img_width"]:
        issues.append(_issue("discover", "low",
            f"Imagen <{ONPAGE['discover_min_img_width']}px; Discover exige imágenes grandes"))

    # --- Social / Open Graph ---
    if not parsed.get("og_title") or not parsed.get("og_description"):
        issues.append(_issue("social", "low",
            "Falta og:title u og:description; se comparte peor en redes"))
    if not parsed.get("twitter_card"):
        issues.append(_issue("social", "low", "Sin twitter:card; peor preview en X/Twitter"))

    # --- Frescura (refresh de contenido que aún trae tráfico) ---
    age = _days_since(parsed.get("date_modified") or parsed.get("date_published"))
    if age is not None and age >= ONPAGE["stale_days"]:
        issues.append(_issue("freshness", "low",
            f"Sin actualizarse hace {age} días; un refresh puede recuperar posiciones"))

    # --- Score de salud ---
    # Solo penaliza lo EDITORIAL (lo que el redactor puede arreglar). Los issues
    # de plataforma se muestran aparte y no distorsionan la priorización por nota.
    score = 100
    for it in issues:
        if it.get("class") == "editorial":
            score -= _PENALTY.get(it["severity"], 5)
    score = max(score, 0)

    return {"url": parsed["url"], "score": score, "issues": issues}


def audit_many(parsed_list, keyword_by_url=None):
    keyword_by_url = keyword_by_url or {}
    results = []
    for parsed in parsed_list:
        url = parsed.get("url")
        results.append(audit_article(parsed, target_keyword=keyword_by_url.get(url)))
    return sorted(results, key=lambda r: (r["score"] if r["score"] is not None else 999))
