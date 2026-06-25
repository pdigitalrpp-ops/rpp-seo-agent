"""
Colector de Marfeel — tráfico, audiencia, fuentes y secciones de rpp.pe.
Reemplaza por completo al antiguo colector de GA4.

Restricciones de la API:
  - Auth por bearer token (POST /signin), válido ~14 días → se cachea.
  - LÍMITE DURO: 1 request por minuto. Un rate-limiter global lo respeta.
  - Máximo 500 filas por respuesta.

Por ese límite, cada llamada cuesta ~60s. El orquestador debe presupuestar
cuántas queries hace por corrida (sobre todo en el radar de tiempo real).
"""

import time
import logging
import requests

from config import (
    MARFEEL_SIGNIN_URL, MARFEEL_QUERY_URL,
    MARFEEL_EMAIL, MARFEEL_PASSWORD,
    MARFEEL_MIN_INTERVAL_SECONDS, MARFEEL_MAX_ROWS,
)

logger = logging.getLogger(__name__)

# Caché de token y reloj del rate-limiter (a nivel de módulo, vive por proceso)
_token = None
_token_obtained_at = 0.0
_last_request_at = 0.0

_TOKEN_TTL_SECONDS = 13 * 24 * 3600   # renovar antes de los 14 días reales


def _respect_rate_limit():
    """Bloquea hasta que haya pasado >= 60s desde la última request a Marfeel."""
    global _last_request_at
    elapsed = time.time() - _last_request_at
    if _last_request_at and elapsed < MARFEEL_MIN_INTERVAL_SECONDS:
        wait = MARFEEL_MIN_INTERVAL_SECONDS - elapsed
        logger.info(f"Marfeel rate-limit: esperando {wait:.0f}s")
        time.sleep(wait)
    _last_request_at = time.time()


def _get_token():
    """Devuelve un bearer token válido, reusando el caché mientras no expire."""
    global _token, _token_obtained_at
    if _token and (time.time() - _token_obtained_at) < _TOKEN_TTL_SECONDS:
        return _token

    if not MARFEEL_EMAIL or not MARFEEL_PASSWORD:
        raise ValueError("MARFEEL_EMAIL / MARFEEL_PASSWORD no están configurados")

    resp = requests.post(
        MARFEEL_SIGNIN_URL,
        json={"email": MARFEEL_EMAIL, "password": MARFEEL_PASSWORD},
        headers={"Content-Type": "application/json"},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    token = data.get("token") or data.get("accessToken")
    if not token:
        raise ValueError(f"Respuesta de signin sin token: {list(data.keys())}")
    _token = token
    _token_obtained_at = time.time()
    logger.info("✅ Marfeel: token obtenido")
    return _token


def query(metrics, group_by=None, dates=None, granularity="daily",
          filters=None, order=None, limit=MARFEEL_MAX_ROWS):
    """
    Helper central para /dashboard/query. Respeta el rate-limit (1/min).

    metrics: lista, ej. ["uniqueUsers", "pageViewsTotal"]
    group_by: lista de dimensiones, ej. ["section"] o ["url", "title"]
    dates: dict, ej. {"last": {"number": 1, "dimension": "day"}}
           o {"range": {"start": "2026-06-24", "end": "2026-06-24"}}
    granularity: "realtime" | "hourly" | "daily" | "weekly" | "monthly"
    """
    token = _get_token()
    body = {
        "metrics":     metrics,
        "granularity": granularity,
        "limit":       min(limit, MARFEEL_MAX_ROWS),
        "from":        0,
    }
    if group_by: body["groupBy"] = group_by
    if dates:    body["dates"]   = dates
    if filters:  body["filters"] = filters
    if order:    body["order"]   = order

    _respect_rate_limit()
    resp = requests.post(
        MARFEEL_QUERY_URL,
        json=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        timeout=30,
    )
    if not resp.ok:
        # Captura el reclamo exacto de la API para depurar el formato del query
        logger.error(f"Marfeel {resp.status_code} en query | body={body} | resp={resp.text[:800]}")
    resp.raise_for_status()
    return resp.json()


def _rows_from_response(payload, key_field, value_field=None):
    """
    Normaliza la respuesta de Marfeel a una lista de dicts {label, ...metrics}.
    La respuesta es una lista de bloques por métrica; cada bloque trae
    actualData.data = [{"label": ..., "<dimension>": valor}].
    """
    out = {}
    for block in (payload or []):
        metric = block.get("metric")
        data = (block.get("actualData") or {}).get("data") or []
        for row in data:
            label = row.get("label") or row.get(key_field)
            if label is None:
                continue
            entry = out.setdefault(label, {"label": label})
            # el valor de la métrica es el otro campo del row (no "label")
            for k, v in row.items():
                if k != "label":
                    entry[metric or k] = v
    return list(out.values())


# ---------------------------------------------------------------------------
# Métodos de alto nivel usados por el orquestador
# ---------------------------------------------------------------------------

def fetch_yesterday_performance(limit=200):
    """Etapa 1 — rendimiento por URL del día anterior."""
    payload = query(
        metrics=["pageViewsTotal", "uniqueUsers"],
        group_by=["url", "title"],
        dates={"last": {"number": 1, "dimension": "day"}},
        granularity="daily",
        order={"metric": "pageViewsTotal", "sort": "DESC"},
        limit=limit,
    )
    return _rows_from_response(payload, key_field="url")


def fetch_traffic_sources(period_days=1):
    """Etapa 1 — distribución de fuentes de tráfico (Discover, búsqueda, etc.)."""
    payload = query(
        metrics=["pageViewsTotal", "uniqueUsers"],
        group_by=["source"],
        dates={"last": {"number": period_days, "dimension": "day"}},
        granularity="daily",
        order={"metric": "pageViewsTotal", "sort": "DESC"},
    )
    return _rows_from_response(payload, key_field="source")


def fetch_realtime_top(limit=100):
    """Etapa 2 — qué se está leyendo AHORA en rpp.pe."""
    payload = query(
        metrics=["uniqueUsers", "pageViewsTotal"],
        group_by=["url", "title"],
        granularity="realtime",
        order={"metric": "uniqueUsers", "sort": "DESC"},
        limit=limit,
    )
    return _rows_from_response(payload, key_field="url")


def fetch_sections(period_days=7):
    """
    Construye la taxonomía REAL de secciones de rpp.pe desde Marfeel.
    Reemplaza al antiguo PROGRAM_AFFINITY_MAP inventado.
    """
    payload = query(
        metrics=["pageViewsTotal"],
        group_by=["section"],
        dates={"last": {"number": period_days, "dimension": "day"}},
        granularity="daily",
        order={"metric": "pageViewsTotal", "sort": "DESC"},
    )
    rows = _rows_from_response(payload, key_field="section")
    return [r["label"] for r in rows if r.get("label")]
