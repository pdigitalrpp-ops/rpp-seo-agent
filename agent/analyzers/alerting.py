"""
analyzers/alerting.py — decide qué temas del radar ameritan una ALERTA.

Separado a propósito del score de recomendación (analyzers/scoring.py): una
recomendación responde "¿vale la pena escribir sobre esto?"; una alerta
responde "¿hay una noticia rompiendo AHORA que la sección debería cubrir ya?".
Son preguntas distintas y antes compartían el mismo score 0-100 con umbral 75,
lo que hacía que la alerta SOLO disparara para eventos deportivos grandes
(única forma de cruzar 75 en el score de recomendación, dominado por el
tráfico de Google Trends) y nunca para sismos, muertes o renuncias de alto
interés — el score de recomendación de esos temas se ahogaba porque el
`approx_traffic` de Trends casi siempre viene en 1.5/10.

Este módulo NO mira el approx_traffic como driver principal. Usa la evidencia
que el radar ya recolecta por cada tendencia:

- **Evidencia de noticias** (driver principal, item["news"]): nº de fuentes
  distintas y su frescura. Un tema con 3-4 titulares frescos de medios reales
  es, por definición, una noticia que está rompiendo.
- **why_trending**: si el LLM no pudo anclar el tema a un hecho noticioso
  (null), casi nunca es un evento alertable ("te", "23 de julio feriado",
  queries genéricas) → penalización fuerte.
- **Prominencia en Trends**: el RANK del feed de Perú (1 = lo más buscado),
  señal más confiable que el tráfico aproximado.
- **Términos de urgencia**: muerte, sismo, resultado, renuncia, oficial…

Además CONSOLIDA tendencias del mismo evento que comparten URLs de noticias:
"temblor hoy" + "ultimo sismo en peru" + "igp ultimo sismo" + "indeci" son un
SOLO sismo. Antes se puntuaban por separado y ninguna cruzaba el umbral; ahora
se funden en una alerta con la evidencia sumada.

Rules-first: no hace llamadas LLM propias — reutiliza el why_trending y las
noticias que run_radar ya generó. Si esa evidencia falta, el tema simplemente
no alerta.
"""

import logging
from datetime import datetime, timezone
from urllib.parse import urlparse

from analyzers import scoring
from config import (
    ALERT_WORTHINESS_THRESHOLD, ALERT_SEVERITY_HIGH,
)

logger = logging.getLogger(__name__)

# Pesos de la "alertabilidad" 0-100 (suman 100 antes del multiplicador de
# why_trending). La evidencia de noticias domina (reemplaza al approx_traffic
# roto), pero el término de URGENCIA pesa fuerte a propósito: una alerta es
# "noticia rompiendo AHORA", no un explicador de alto tráfico. Calibrado con
# datos reales del 2026-07-22 para que sismos/muertes/renuncias/partidos en
# vivo disparen (alta), y explicadores de servicio (feriado, gratificaciones)
# NO — tienen mucha cobertura pero cero señal de urgencia.
W_NEWS     = 40   # nº de fuentes distintas × frescura
W_RANK     = 15   # posición en el feed de Google Trends Perú
W_URGENCY  = 30   # términos de "hecho rompiendo" en keyword/noticias/why
W_MOMENTUM = 15   # tamaño del evento: max(growth de Trends, tracción en Marfeel)

# Términos que marcan un hecho noticioso rompiendo (no una demanda evergreen).
# Se buscan sobre keyword + why_trending + titulares de noticias, en minúsculas
# sin distinguir tilde parcial (se incluyen variantes sin tilde).
URGENCY_TERMS = [
    "muere", "muerte", "fallece", "falleci", "murio", "murió", "luto",
    "sismo", "temblor", "terremoto", "huaico", "aluvion", "aluvión", "incendio",
    "emergencia", "alerta", "tragedia", "accidente", "explosion", "explosión",
    "renuncia", "destituy", "vacancia", "captura", "detien", "allanamiento",
    "gana", "ganó", "gano", "campeon", "campeón", "clasific", "eliminado",
    "resultado", "en vivo", "en directo", "minuto a minuto",
    "oficial", "confirma", "anuncia", "declara", "paro", "huelga", "golpe",
]


def _domain(url):
    try:
        host = urlparse(url or "").netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except (ValueError, AttributeError):
        return ""


def _parse_dt(s):
    """Parsea un published_at ISO/RFC a datetime UTC aware, o None."""
    if not s:
        return None
    txt = str(s).strip()
    try:
        dt = datetime.fromisoformat(txt.replace("Z", "+00:00"))
        return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)
    except ValueError:
        pass
    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(txt)
        if not dt:
            return None
        return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def _recency_weight(published_at, now):
    """Frescura 0.1-1.0 de una noticia. Desconocida = 0.5: el feed ya es de
    ≤2 días (Google News when:2d), así que 'sin fecha' no es 'viejo'."""
    dt = _parse_dt(published_at)
    if not dt:
        return 0.5
    hours = (now - dt).total_seconds() / 3600.0
    if hours <= 6:
        return 1.0
    if hours <= 12:
        return 0.8
    if hours <= 24:
        return 0.5
    if hours <= 48:
        return 0.3
    return 0.1


def _news_strength(news, now):
    """0-1 según cuántas FUENTES distintas cubren el tema y qué tan frescas
    están. Satura ~3 fuentes frescas = 1.0. Es el driver principal."""
    if not news:
        return 0.0
    by_source = {}
    for n in news:
        src = (n.get("source") or _domain(n.get("source_url") or n.get("url")) or "").lower().strip()
        if not src:
            continue
        w = _recency_weight(n.get("published_at"), now)
        by_source[src] = max(by_source.get(src, 0.0), w)
    if not by_source:
        return 0.0
    return min(sum(by_source.values()) / 3.0, 1.0)


def _rank_strength(rank):
    """Prominencia por posición en el feed de Trends (1 = lo más buscado)."""
    if not rank or rank <= 0:
        return 0.4
    if rank <= 5:
        return 1.0
    if rank <= 10:
        return 0.7
    if rank <= 15:
        return 0.4
    return 0.2


def _urgency_strength(text):
    return 1.0 if any(term in text for term in URGENCY_TERMS) else 0.0


def _news_key_urls(item):
    """
    URLs de ARTÍCULO del tema, para detectar eventos compartidos. Solo se usa
    n["url"] (URL única por artículo), NO source_url: en los ítems que llegan
    vía Google News, source_url es el DOMINIO pelado (p.ej. "https://
    www.infobae.com", "https://elcomercio.pe") y lo comparten temas sin
    relación — agrupar por él fusionaba "renuncia" + "ignacio buse" + "feriado"
    en un solo cluster (bug real detectado en calibración 2026-07-22).
    """
    return {(n.get("url") or "").strip() for n in (item.get("news") or []) if n.get("url")}


def cluster_events(items):
    """
    Agrupa tendencias que son el MISMO evento porque comparten ≥1 URL de
    noticia (p.ej. el sismo aparece como 'temblor hoy', 'igp ultimo sismo',
    'indeci'…). Devuelve una lista de clusters (cada uno = lista de items).
    Greedy: suficiente para ~10-20 tendencias por corrida.
    """
    clusters = []          # lista de {"items": [...], "urls": set()}
    for item in items:
        urls = _news_key_urls(item)
        placed = None
        if urls:
            for c in clusters:
                if urls & c["urls"]:
                    placed = c
                    break
        if placed:
            placed["items"].append(item)
            placed["urls"] |= urls
        else:
            clusters.append({"items": [item], "urls": set(urls)})
    return [c["items"] for c in clusters]


def _merge_cluster(cluster_items):
    """Funde un cluster en un solo 'evento' con la evidencia combinada."""
    # Representante: mejor rank (menor), desempata por mayor growth_score.
    rep = min(cluster_items, key=lambda it: (it.get("rank", 99), -(it.get("growth_score") or 0)))
    merged_news, seen = [], set()
    for it in cluster_items:
        for n in it.get("news") or []:
            key = (n.get("title") or "").lower().strip()
            if key and key not in seen:
                seen.add(key)
                merged_news.append(n)
    return {
        "keyword":      rep["keyword"],
        "category":     rep.get("category", "otros"),
        "rank":         min((it.get("rank", 99) for it in cluster_items), default=99),
        "growth_score": max((it.get("growth_score") or 0 for it in cluster_items), default=0),
        "own_momentum": max((it.get("own_momentum") or 0.0 for it in cluster_items), default=0.0),
        "why_trending": next((it.get("why_trending") for it in cluster_items if it.get("why_trending")), None),
        "news":         merged_news[:8],
        "keywords":     [it["keyword"] for it in cluster_items],
    }


def alert_worthiness(event, now):
    """Alertabilidad 0-100 de un evento ya consolidado."""
    news_n = _news_strength(event.get("news"), now)
    rank_n = _rank_strength(event.get("rank"))
    urgency_text = " ".join([
        event.get("keyword") or "",
        event.get("why_trending") or "",
        " ".join(n.get("title") or "" for n in (event.get("news") or [])),
    ]).lower()
    urgency_n = _urgency_strength(urgency_text)
    momentum_n = max(
        scoring._norm_growth(event.get("growth_score", 0)),
        min(max(event.get("own_momentum", 0.0), 0.0), 1.0),
    )

    total = (W_NEWS * news_n + W_RANK * rank_n
             + W_URGENCY * urgency_n + W_MOMENTUM * momentum_n)

    # Sin hecho noticioso claro (why_trending null) casi nunca es alertable:
    # penaliza fuerte para dejar fuera queries genéricas/evergreen.
    if not event.get("why_trending"):
        total *= 0.5

    return round(min(total, 100.0), 1)


def build_alerts(enriched_trends, sections=None, now=None):
    """
    Etapa 3 — convierte las tendencias enriquecidas (con news + why_trending +
    rank + category, tal como las deja run_radar) en alertas.

    Consolida eventos fragmentados, puntúa la alertabilidad y devuelve los
    eventos que superan ALERT_WORTHINESS_THRESHOLD como dicts de alerta listos
    para save_alerts / notify.dispatch_alert.
    """
    if not enriched_trends:
        return []
    now = now or datetime.now(timezone.utc)

    alerts = []
    for cluster in cluster_events(enriched_trends):
        event = _merge_cluster(cluster)
        worth = alert_worthiness(event, now)
        if worth < ALERT_WORTHINESS_THRESHOLD:
            continue

        news = event.get("news") or []
        n_sources = len({(n.get("source") or _domain(n.get("source_url") or n.get("url")) or "").lower()
                         for n in news if (n.get("source") or n.get("url"))})
        description = event.get("why_trending") or (
            f"Tendencia rompiendo: {n_sources} medio(s) ya lo cubren." if n_sources
            else "Tema en fuerte tendencia de búsqueda ahora."
        )
        alerts.append({
            "type":     "trending_topic",
            "severity": "high" if worth >= ALERT_SEVERITY_HIGH else "medium",
            "section":  scoring.assign_section(event.get("category"), sections),
            "title":    event["keyword"],
            "description": description,
            "url":      (news[0].get("url") if news else None),
            "score":    worth,
            # metadatos para dedup/log (no se guardan en la tabla)
            "_keywords": event.get("keywords"),
            "_n_sources": n_sources,
        })

    return sorted(alerts, key=lambda a: a["score"], reverse=True)
