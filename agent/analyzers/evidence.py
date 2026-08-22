# -*- coding: utf-8 -*-
"""
Ordena la EVIDENCIA de una tendencia y determina su ORIGEN.

EL PROBLEMA (reportado el 2026-08-22 sobre la tendencia "kick"):
el panel mostraba como "principales noticias" tres articulos en ingles de
medios locales de EE.UU. sobre un "kick off" del Buddy Walk, y el LLM explicaba
la tendencia a partir de ESAS noticias. La tendencia era legitima —- en Peru se
buscaba Kick.com, la plataforma de streaming, por la streamer peruana Zully—-
pero la evidencia adjunta no tenia nada que ver.

LA CAUSA no es el geo de Trends (validado en su momento: geo=PE es correcto).
Son DOS fuentes de noticias distintas que se estaban concatenando en el orden
equivocado:

  1. `ht:news_item` del RSS de Google Trends: las noticias que Google asocia a
     la tendencia. NO estan localizadas — para una palabra corta y ambigua en
     ingles ("kick") devuelven cualquier cosa que la contenga. Medido el
     2026-08-22 sobre el feed en vivo de geo=PE:
       kick        -> Ligue 1 en ingles (Sofascore, OneFootball, Reuters)
       coco gauff  -> Bleacher Nation, Sports Betting Dime (ingles)
     Incluso colaba https://www.reutersconnect.com/... "Licensable picture",
     que es una pagina de licencia de foto de stock, no una noticia.

  2. La busqueda de Google News con hl=es-419&gl=PE&ceid=PE:es-419
     (collectors/trend_news.py). ESTA si esta localizada, y para las MISMAS
     keywords devolvia lo correcto:
       kick        -> ATV Peru (Zully), America TV, Infobae, Ecuavisa
       coco gauff  -> Infobae, ESPN Deportes, Europa Press
       demon hunter-> CNN en Espanol, Exitosa, Infobae (demanda a Netflix)

run_radar concatenaba `trends_news + google_news` y cortaba en 5, asi que las
3 de Google siempre ocupaban los primeros puestos y empujaban fuera a las
peruanas. De ahi salia el titular del panel, el resumen del LLM y —desde el
cambio de score del 2026-08-21— la cuenta de medios peruanos.

LA CORRECCION es dejar de concatenar y pasar a ORDENAR por cercania a la
audiencia peruana, y ademas ETIQUETAR el origen para poder decir en el panel
"esto no tiene cobertura en espanol" en vez de fingir que es noticia local.
"""

import re
from urllib.parse import urlparse

from config import (
    PERUVIAN_TLDS, PERUVIAN_DOMAINS, NON_EDITORIAL_DOMAINS, OWN_SOURCE_MARKERS,
)

# Marcadores de idioma. Heuristica deliberadamente simple: son titulares, no
# parrafos, y solo hay que separar espanol de ingles.
_ES = {
    "de", "la", "el", "en", "con", "por", "para", "que", "del", "los", "las",
    "un", "una", "su", "sus", "se", "al", "mas", "sobre", "tras", "ante",
    "desde", "hasta", "como", "este", "esta", "estos", "estas", "y", "o",
    "tiene", "sera", "fue", "son", "asi", "ya", "no", "pero", "entre",
}
_EN = {
    "the", "of", "to", "in", "for", "and", "with", "on", "at", "vs", "over",
    "from", "by", "his", "her", "its", "after", "before", "is", "are", "was",
    "were", "how", "why", "what", "who", "new", "says", "said", "off",
}

_TITULO_NO_NOTICIA = ("licensable picture",)

ORIGEN_PERU  = "pe"   # lo cubre al menos un medio peruano
ORIGEN_ES    = "es"   # hay cobertura en espanol, pero no peruana
ORIGEN_FUERA = "xx"   # solo cobertura extranjera: rebote global


def looks_spanish(title):
    """
    ¿El titular esta en espanol? Heuristica por palabras funcionales + tildes.

    Se exige es >= 2 a proposito: un solo "de" no basta, porque aparece en
    nombres propios extranjeros ("Olympique de Marseille") y clasificaria como
    espanol un titular ingles.
    """
    texto = (title or "").lower()
    palabras = set(re.findall(r"[a-záéíóúñü]+", texto))
    es = len(palabras & _ES)
    en = len(palabras & _EN)
    if re.search(r"[áéíóúñ¿¡]", texto):
        es += 2
    return es >= 2 and es > en


def domain_of(item):
    """
    Dominio del medio, sin www. Se prefiere `source_url` (la URL propia del
    medio) sobre `url`, que en las noticias de Google News es un redirector
    de news.google.com y no dice nada del medio.
    """
    for campo in ("source_url", "url"):
        raw = (item.get(campo) or "").strip()
        if not raw:
            continue
        host = urlparse(raw if "//" in raw else "//" + raw).netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        if host and "news.google.com" not in host:
            return host
    return ""


def is_peruvian_source(item):
    """
    ¿Medio peruano? Por DOMINIO: TLD .pe, o allowlist para los peruanos que no
    lo usan (depor.com, trome.com). Ver el bloque de config.py para por que no
    se compara el nombre.
    """
    dom = domain_of(item)
    if not dom or is_non_editorial(item):
        return False
    if dom.endswith(PERUVIAN_TLDS):
        return True
    return any(dom == d or dom.endswith("." + d) for d in PERUVIAN_DOMAINS)


def is_own_source(item):
    """RPP mismo, que no cuenta como evidencia de si mismo."""
    dom = domain_of(item)
    nombre = (item.get("source") or "").lower()
    return any(m in dom or m in nombre for m in OWN_SOURCE_MARKERS)


def is_non_editorial(item):
    """Marcador en vivo, casa de pronosticos o plataforma: no es cobertura."""
    dom = domain_of(item)
    return bool(dom) and any(d in dom for d in NON_EDITORIAL_DOMAINS)


def is_junk(item):
    """Pagina de stock/licencia colada como noticia."""
    titulo = (item.get("title") or "").lower()
    if any(t in titulo for t in _TITULO_NO_NOTICIA):
        return True
    dom = domain_of(item)
    return any(d in dom for d in ("reutersconnect.", "gettyimages.", "shutterstock."))


def tag_origin(item):
    """Etiqueta el item con su origen y devuelve el mismo dict (mutado)."""
    if is_peruvian_source(item):
        item["origin"] = ORIGEN_PERU
    elif looks_spanish(item.get("title")):
        item["origin"] = ORIGEN_ES
    else:
        item["origin"] = ORIGEN_FUERA
    return item


def _relevancia(item):
    """
    Mayor = mas cerca de la audiencia peruana. El orden importa mas que los
    numeros exactos: medio peruano > cobertura en espanol > extranjero, y a
    igualdad gana la busqueda localizada sobre lo que adjunta Google Trends.
    """
    origen = item.get("origin")
    base = {ORIGEN_PERU: 4, ORIGEN_ES: 2}.get(origen, 0)
    # `from_trends` marca los ht:news_item, que no estan localizados.
    return base + (0 if item.get("from_trends") else 1)


def rank_news(items, limit=5):
    """
    Ordena la evidencia por cercania a Peru, quita basura y deduplica por
    titular. Estable: a igual relevancia respeta el orden de entrada.
    """
    limpios, vistos = [], set()
    for n in items or []:
        if is_junk(n):
            continue
        clave = (n.get("title") or "").lower().strip()
        if not clave or clave in vistos:
            continue
        vistos.add(clave)
        limpios.append(tag_origin(dict(n)))
    limpios.sort(key=_relevancia, reverse=True)
    return limpios[:limit]


def trend_origin(news):
    """
    Origen de la TENDENCIA a partir de su evidencia ya etiquetada.

    ORIGEN_FUERA es la senal que faltaba: la tendencia puede ser real en Peru
    (geo=PE no miente) pero no tener ni una sola nota en espanol detras. Eso es
    un rebote global, y el panel debe decirlo en vez de mostrar titulares en
    ingles como si fueran la noticia local.
    """
    origenes = {n.get("origin") for n in (news or [])}
    if ORIGEN_PERU in origenes:
        return ORIGEN_PERU
    if ORIGEN_ES in origenes:
        return ORIGEN_ES
    return ORIGEN_FUERA
