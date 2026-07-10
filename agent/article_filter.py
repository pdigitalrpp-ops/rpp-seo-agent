"""
Filtro de contenido editorial de rpp.pe — fuente única en Python.

Contenido real = notas (…-noticia-<id>) y coberturas en vivo (…-live-<id>).
Todo lo demás (home, homes de sección /deportes, landings/herramientas,
buscador, /ultimas-noticias, /tv-vivo, /audio/en-vivo, listados /noticias/...,
widget mrf.io) NO es contenido editorial y se descarta.

Vivía en run_morning.py; se extrajo aquí para que otros collectors
(rpp_own_feed) lo reusen sin importar run_morning (import circular). El
dashboard mantiene su propia copia en TS (`isRealArticle` en TraficoClient):
si cambia el regex, actualizar AMBOS.
"""

import re
from urllib.parse import urlparse

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
