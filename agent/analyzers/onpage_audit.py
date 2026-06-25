"""
Auditoría SEO on-page de notas ya publicadas en rpp.pe.
Toma el dict que devuelve collectors.rpp_articles.parse_article y emite una
lista priorizada de puntos críticos de mejora, más un score de salud 0-100.

Pensado como las tareas que hace un SEO de contenidos al revisar una nota:
title, meta description, H1, estructura, profundidad, enlazado interno,
alt de imágenes, structured data, indexabilidad y readiness para Discover.
"""

import logging
from config import ONPAGE

logger = logging.getLogger(__name__)

# Penalización en el score 0-100 por severidad
_PENALTY = {"high": 20, "medium": 10, "low": 5}


def _issue(check, severity, message):
    return {"check": check, "severity": severity, "message": message}


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

    # --- H1 ---
    h1s = parsed.get("h1s") or []
    if len(h1s) == 0:
        issues.append(_issue("h1", "high", "Sin H1"))
    elif len(h1s) > 1:
        issues.append(_issue("h1", "medium", f"{len(h1s)} H1 (debe haber uno solo)"))

    # --- Estructura de subtítulos ---
    if parsed.get("h2_count", 0) == 0:
        issues.append(_issue("headings", "medium",
            "Sin subtítulos H2; mala escaneabilidad y peor para featured snippets"))

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
    if not parsed.get("canonical"):
        issues.append(_issue("canonical", "low", "Sin etiqueta canonical"))

    # --- Discover readiness ---
    if not parsed.get("og_image"):
        issues.append(_issue("discover", "medium", "Sin og:image; no califica para Discover"))
    elif parsed.get("og_image_width") and parsed["og_image_width"] < ONPAGE["discover_min_img_width"]:
        issues.append(_issue("discover", "low",
            f"Imagen <{ONPAGE['discover_min_img_width']}px; Discover exige imágenes grandes"))

    # --- Score de salud ---
    score = 100
    for it in issues:
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
