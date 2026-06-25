"""
Lector de notas publicadas en rpp.pe.
Descarga el HTML de una nota y extrae los elementos SEO on-page relevantes
para que analyzers/onpage_audit.py los evalúe.
"""

import json
import logging
import requests
from bs4 import BeautifulSoup

from config import SITE_DOMAIN, ONPAGE

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; RPP-SEO-Agent/1.0; +https://rpp.pe)"
}


def _word_count(text):
    return len((text or "").split())


def _extract_jsonld_types(soup):
    types = []
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(script.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        blocks = data if isinstance(data, list) else [data]
        for block in blocks:
            if isinstance(block, dict) and block.get("@type"):
                t = block["@type"]
                types.extend(t if isinstance(t, list) else [t])
    return types


def parse_article(url):
    """
    Descarga y parsea una nota de rpp.pe. Devuelve un dict de señales on-page,
    o {"url": url, "error": "..."} si falla la descarga.
    """
    try:
        resp = requests.get(url, headers=_HEADERS, timeout=ONPAGE["fetch_timeout_seconds"])
        resp.raise_for_status()
    except Exception as e:
        logger.warning(f"No se pudo descargar {url}: {e}")
        return {"url": url, "error": str(e)}

    soup = BeautifulSoup(resp.text, "html.parser")

    def meta(attr, value):
        tag = soup.find("meta", attrs={attr: value})
        return tag.get("content").strip() if tag and tag.get("content") else None

    h1s = [h.get_text(strip=True) for h in soup.find_all("h1")]

    # Cuerpo principal: preferir <article>, luego <main>, luego todo el body
    body = soup.find("article") or soup.find("main") or soup.body
    body_text = body.get_text(" ", strip=True) if body else ""

    first_p = ""
    if body:
        for p in body.find_all("p"):
            txt = p.get_text(strip=True)
            if len(txt) > 60:
                first_p = txt
                break

    # Enlaces internos (mismo dominio) e imágenes
    internal_links = 0
    for a in (body.find_all("a", href=True) if body else []):
        href = a["href"]
        if href.startswith("/") or SITE_DOMAIN in href:
            internal_links += 1

    images = body.find_all("img") if body else []
    images_without_alt = sum(1 for img in images if not (img.get("alt") or "").strip())

    canonical_tag = soup.find("link", attrs={"rel": "canonical"})
    title_tag = soup.title.get_text(strip=True) if soup.title else None

    og_width = meta("property", "og:image:width")
    try:
        og_width = int(og_width) if og_width else None
    except (ValueError, TypeError):
        og_width = None

    return {
        "url":                url,
        "title_tag":          title_tag,
        "meta_description":   meta("name", "description"),
        "h1s":                h1s,
        "h2_count":           len(soup.find_all("h2")),
        "h3_count":           len(soup.find_all("h3")),
        "canonical":          canonical_tag.get("href") if canonical_tag else None,
        "robots":             meta("name", "robots"),
        "og_image":           meta("property", "og:image"),
        "og_image_width":     og_width,
        "jsonld_types":       _extract_jsonld_types(soup),
        "word_count":         _word_count(body_text),
        "first_paragraph":    first_p,
        "internal_links":     internal_links,
        "images_total":       len(images),
        "images_without_alt": images_without_alt,
        "lang":               (soup.html.get("lang") if soup.html else None),
    }
