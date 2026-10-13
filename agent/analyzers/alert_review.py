"""
analyzers/alert_review.py — el "criterio de analista" antes de emitir una alerta.

POR QUÉ EXISTE
--------------
`alerting.build_alerts` responde "¿este tema de Google Trends pesa lo
suficiente?". Eso no alcanza. El 2026-10-13, primer día con las alertas
llegando por correo, el usuario revisó siete y ninguna la habría mandado un
analista SEO:

- **"latina"**: el nombre de un canal de la competencia, sin hecho detrás.
- **"precio del dólar"**: contenido de servicio diario, y el enlace de la
  alerta era la nota del propio RPP.
- **"simulacro"**: evento programado que RPP ya había cubierto de sobra.
- **"víctima"**: término genérico, y la noticia que lo explicaba era de RPP.
- **"servicio geológico colombiano"**: el nombre de una institución; la nota
  era una página de SEO de "temblor EN VIVO hoy".
- **"elecciones"**: genérico; la alerta salió de una nota de un medio que
  citaba a otro, sin mirar si RPP ya lo tenía.

Las reglas que deja ese día, y que este módulo aplica:

1. **Nunca alertar de algo que RPP ya publicó.** Es la regla dura: avisarle a
   la redacción de su propia nota le quita toda credibilidad al sistema.
2. La alerta es un HECHO, no una búsqueda: se titula con lo que pasó.
3. No alertan: nombres de medios, contenido de servicio recurrente, términos
   genéricos sin un hecho único detrás.
4. Un evento PROGRAMADO solo alerta si RPP no tiene nada publicado: ahí la
   alerta es "nos falta esta cobertura".

CÓMO
----
Dos capas. Las reglas (gratis) vetan lo evidente; lo que sobrevive pasa por el
LLM, que recibe la evidencia Y lo que RPP publicó hace poco sobre el tema. La
decisión final se toma EN CÓDIGO a partir de la clasificación del modelo, no
se le pregunta "¿alerto?": así la regla 1 no depende de su criterio.

Sin LLM no hay alertas nuevas (falla cerrado). Antes el proyecto prefería
"rules-first, que nada se rompa", pero aquí romper es mandar un correo que no
debía salir: saltarse una corrida cuesta 15 minutos, una alerta vergonzosa
cuesta la confianza de la redacción.
"""

import logging
import re

from analyzers import evidence
from collectors import trend_news
from llm import provider as llm
from text_keys import normalize_text
from config import ALERT_MEDIA_BRANDS, ALERT_SERVICE_PATTERNS, SEO_CONTENT_URL_PREFIXES

logger = logging.getLogger(__name__)

_BRANDS = {normalize_text(b) for b in ALERT_MEDIA_BRANDS}
_SERVICE_RE = re.compile("|".join(f"(?:{p})" for p in ALERT_SERVICE_PATTERNS))
# Coletillas que no cambian de qué se habla: "latina en vivo" sigue siendo el canal.
_COLETILLAS_RE = re.compile(r"\s+(en vivo|en directo|hoy|online|gratis|peru|tv|television|noticias)$")

# Qué tipos de tema pueden alertar. El resto se descarta siempre.
TIPOS_ALERTABLES = ("rompiendo", "programado")


def _keyword_base(keyword):
    """Keyword normalizada y sin coletillas, para comparar contra las listas."""
    k = normalize_text(keyword)
    prev = None
    while prev != k:
        prev = k
        k = _COLETILLAS_RE.sub("", k).strip()
    return k


def _sin_protocolo(url):
    u = (url or "").strip().lower()
    for pre in ("https://", "http://"):
        if u.startswith(pre):
            u = u[len(pre):]
    return u[4:] if u.startswith("www.") else u


def seo_title_keys(articles):
    """
    Claves de titular de los artículos de secciones SEO, agrupadas por dominio:
    {"gestion.pe": {"a que hora juega ...", ...}}. `articles` = dicts
    {title, url} (de la corrida en memoria y de la base).
    """
    out = {}
    for a in articles or []:
        u = _sin_protocolo(a.get("url"))
        for pref in SEO_CONTENT_URL_PREFIXES:
            if u.startswith(pref):
                clave = normalize_text(a.get("title"))
                if clave:
                    out.setdefault(pref.split("/")[0], set()).add(clave)
    return out


def is_seo_content(news_item, seo_keys=None):
    """
    ¿Esta noticia es de una sección de contenido SEO de otro medio?

    Dos formas de saberlo, porque la ruta casi nunca viene: (1) la URL propia
    del medio, cuando está (las noticias que asocia Google Trends la traen);
    (2) el titular, cruzado contra los artículos de esa sección que el radar
    ya recolectó del RSS del medio. Para los titulares se acepta que uno
    empiece por el otro: Google News a veces los recorta.
    """
    for campo in ("source_url", "url"):
        u = _sin_protocolo(news_item.get(campo))
        if any(u.startswith(pref) for pref in SEO_CONTENT_URL_PREFIXES):
            return True
    dom = evidence.domain_of(news_item)
    claves = (seo_keys or {}).get(dom)
    if not claves:
        return False
    t = normalize_text(news_item.get("title"))
    if not t:
        return False
    if t in claves:
        return True
    return len(t) >= 30 and any(c.startswith(t) or t.startswith(c) for c in claves if len(c) >= 30)


def rules_veto(alert):
    """
    Motivo por el que la candidata NO puede alertar según las reglas, o None.
    Devuelve (codigo, explicacion, rpp_url).
    """
    keywords = alert.get("_keywords") or [alert.get("title") or ""]

    for kw in keywords:
        if _keyword_base(kw) in _BRANDS or normalize_text(kw) in _BRANDS:
            return ("marca", f"«{kw}» es el nombre de un medio o plataforma, no un hecho", None)
    for kw in keywords:
        if _SERVICE_RE.search(normalize_text(kw)):
            return ("servicio", f"«{kw}» es contenido de servicio recurrente", None)

    # RPP entre las noticias que explican la tendencia: ya lo tiene publicado.
    for n in alert.get("_news") or []:
        if evidence.is_own_source(n):
            return ("rpp_ya_publico",
                    f"RPP ya lo publicó: «{(n.get('title') or '').strip()[:120]}»",
                    n.get("source_url") or n.get("url"))
    return None


def _tokens(texto):
    return {w for w in normalize_text(texto).split() if len(w) >= 5}


def rpp_candidates(alert, own_articles, limit=8):
    """
    Notas recientes de RPP que PODRÍAN ser del mismo tema, para que el modelo
    decida si alguna cubre el hecho. Dos fuentes:

    - Google News restringido a rpp.pe con la keyword (lo indexa en minutos y
      alcanza 2 días, más que el RSS propio);
    - el RSS de rpp.pe, filtrado a las notas que comparten alguna palabra larga
      con la keyword o con los titulares de la evidencia.

    Sobra a propósito: el filtro fino lo hace el modelo. Lo caro sería que una
    nota de RPP existiera y no llegara a esta lista.
    """
    out, vistos = [], set()

    def add(title, url):
        clave = normalize_text(title)
        if clave and clave not in vistos:
            vistos.add(clave)
            out.append({"title": title.strip(), "url": url})

    for kw in (alert.get("_keywords") or [alert.get("title") or ""])[:2]:
        for n in trend_news.fetch_news_for_keyword(f"{kw} site:rpp.pe", limit=5):
            add(n.get("title") or "", n.get("source_url") or n.get("url"))

    ref = _tokens(" ".join(
        [" ".join(alert.get("_keywords") or [])]
        + [n.get("title") or "" for n in (alert.get("_news") or [])]
    ))
    propias = []
    for a in own_articles or []:
        comunes = len(ref & _tokens(a.get("title") or ""))
        if comunes:
            propias.append((comunes, a))
    for _, a in sorted(propias, key=lambda x: x[0], reverse=True)[:limit]:
        add(a.get("title") or "", a.get("url"))

    return out[:limit + 4]


def review(candidates, own_articles, seo_keys=None):
    """
    Aplica el criterio a las candidatas. Devuelve (aprobadas, decisiones):
    `aprobadas` son las alertas listas para emitir (ya tituladas con el hecho);
    `decisiones` es una fila por candidata para la tabla alert_reviews.
    `seo_keys` viene de seo_title_keys(): titulares de secciones SEO de otros
    medios, que no pueden sostener ni enlazarse en una alerta.
    """
    aprobadas, decisiones = [], []

    def descartar(alert, codigo, motivo, rpp_url=None, hecho=None):
        decisiones.append({
            "keyword": alert.get("_keyword") or alert.get("title"),
            "decision": "descartada", "reason_code": codigo, "reason": motivo,
            "title": hecho, "rpp_url": rpp_url, "score": alert.get("score"),
        })
        logger.info(f"Alerta descartada [{codigo}] '{alert.get('title')}': {motivo}")

    pendientes = []
    for alert in candidates:
        alert.setdefault("_keyword", alert.get("title"))
        # Fuera la evidencia de secciones SEO de otros medios ANTES de todo lo
        # demás: ni la ve el modelo ni puede quedar como enlace de la alerta.
        news = alert.get("_news") or []
        limpias = [n for n in news if not is_seo_content(n, seo_keys)]
        if len(limpias) != len(news):
            logger.info(f"'{alert['_keyword']}': {len(news) - len(limpias)} noticia(s) de "
                        f"secciones SEO fuera de la evidencia")
            alert["_news"] = limpias
            alert["url"] = limpias[0].get("url") if limpias else None
            if not limpias:
                descartar(alert, "contenido_seo",
                          "toda la evidencia viene de secciones de contenido SEO de otros medios")
                continue
        veto = rules_veto(alert)
        if veto:
            descartar(alert, *veto)
        else:
            pendientes.append(alert)

    if not pendientes:
        return aprobadas, decisiones

    items = []
    for alert in pendientes:
        alert["_rpp"] = rpp_candidates(alert, own_articles)
        items.append({
            "keyword":   alert["_keyword"],
            "why":       alert.get("_why") or "",
            "evidencia": [
                {"titular": n.get("title") or "", "medio": n.get("source") or evidence.domain_of(n)}
                for n in (alert.get("_news") or [])[:6]
            ],
            "rpp":       [r["title"] for r in alert["_rpp"]],
        })

    veredictos = llm.review_alerts(items)
    if veredictos is None:
        # Falla cerrado, y sin dejar decisión guardada: en la siguiente corrida
        # se vuelve a intentar con el modelo disponible.
        logger.warning(f"Sin veredicto del LLM: {len(pendientes)} candidata(s) a alerta "
                       f"no se emiten en esta corrida")
        return aprobadas, decisiones

    for i, alert in enumerate(pendientes):
        v = veredictos.get(i)
        if not v:
            logger.warning(f"El LLM no devolvió veredicto para '{alert['_keyword']}'; no se emite")
            continue
        tipo, hecho, motivo = v.get("tipo"), v.get("hecho"), v.get("motivo") or ""
        rpp_idx = v.get("rpp", -1)
        if isinstance(rpp_idx, int) and 0 <= rpp_idx < len(alert["_rpp"]):
            nota = alert["_rpp"][rpp_idx]
            descartar(alert, "rpp_ya_publico", f"RPP ya lo publicó: «{nota['title'][:120]}»",
                      nota.get("url"), hecho)
            continue
        if tipo not in TIPOS_ALERTABLES:
            descartar(alert, tipo or "sin_tipo", motivo or "no es un hecho alertable", None, hecho)
            continue
        if not hecho:
            descartar(alert, "sin_hecho", motivo or "el modelo no pudo nombrar un hecho concreto")
            continue

        news = alert.get("_news") or []
        ev = v.get("ev")
        if isinstance(ev, int) and 0 <= ev < len(news) and news[ev].get("url"):
            alert["url"] = news[ev]["url"]
        alert["title"] = hecho
        if tipo == "programado":
            # Evento previsto que RPP no tiene: no es un hecho rompiendo, es una
            # cobertura que falta. Nunca "alta".
            alert["type"] = "coverage_gap"
            alert["severity"] = "medium"
            alert["description"] = (
                "RPP aún no tiene una nota sobre este evento programado. "
                + (alert.get("description") or "")).strip()
        aprobadas.append(alert)
        decisiones.append({
            "keyword": alert["_keyword"], "decision": "alerta", "reason_code": tipo,
            "reason": motivo, "title": hecho, "rpp_url": None, "score": alert.get("score"),
        })

    return aprobadas, decisiones
