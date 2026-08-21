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
    Normaliza la respuesta AGRUPADA de Marfeel a una lista de dicts.
    Estructura real: cada bloque (por métrica) trae
      actualData.values = [{"key": hash, "total": N,
                            "items": [{"id","value","type"}]}]
    donde `items` contiene el valor de cada dimensión del groupBy
    (type = nombre de la dimensión: "url", "title", "section", "source"...).
    Devuelve filas {label, <dim>: valor, <metric>: total}, fusionando los
    bloques de distintas métricas por el valor de `key_field`.
    """
    out = {}
    for block in (payload or []):
        metric = block.get("metric")
        values = (block.get("actualData") or {}).get("values") or []
        for entry in values:
            dims = {
                it.get("type"): it.get("value")
                for it in (entry.get("items") or []) if it.get("type")
            }
            label = dims.get(key_field) or dims.get("url") or entry.get("key")
            if label is None:
                continue
            row = out.setdefault(label, {"label": label})
            row.update(dims)
            if metric:
                row[metric] = entry.get("total")
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


def _scalar_from_block(block):
    """
    Saca el total de un bloque de respuesta SIN groupBy.

    Marfeel no documenta esta forma y no se pudo probar en local (las
    credenciales viven solo en GitHub Secrets), asi que se intentan las
    variantes plausibles en orden y se devuelve la primera que de un numero:

      1. actualData.total      -> escalar directo
      2. actualData.values[]   -> una sola entrada con su "total" (mismo
                                  formato que la respuesta agrupada)
      3. actualData.data[]     -> serie temporal; se SUMA (con granularity
                                  daily y ventana de 1 dia deberia traer un
                                  unico punto, pero sumar es correcto igual)

    Devuelve (valor, forma_detectada) o (None, None). El nombre de la forma se
    loguea a proposito: si Marfeel cambia el contrato, el log dice exactamente
    cual dejo de funcionar en vez de aparecer un KPI en blanco sin explicacion.
    """
    data = block.get("actualData") or {}

    total = data.get("total")
    if isinstance(total, (int, float)):
        return total, "actualData.total"

    values = data.get("values") or []
    if len(values) == 1 and isinstance(values[0].get("total"), (int, float)):
        return values[0]["total"], "actualData.values[0].total"

    serie = data.get("data") or []
    numeros = [d.get("value") if isinstance(d, dict) else d for d in serie]
    numeros = [n for n in numeros if isinstance(n, (int, float))]
    if numeros:
        return sum(numeros), "suma de actualData.data"

    return None, None


def fetch_yesterday_totals():
    """
    Totales del dia anterior para TODO el sitio, sin agrupar por URL.

    Es el unico numero honesto para el KPI de /trafico. Sumar las filas por
    articulo da "la suma de lo que alcanzamos a traer": con el tope de 200 URLs
    (y de 500 pares url x canal) se perdia ~24% del trafico del dia. Y los
    usuarios unicos NO son sumables por articulo: una persona lee varias notas
    y la suma la cuenta repetida.

    Devuelve {"page_views": int, "unique_users": int} o None (rules-first: el
    dashboard cae entonces a la suma de siempre, avisando que es parcial).
    Cuesta una peticion extra, o sea +65s por el rate-limit de Marfeel.
    """
    payload = query(
        metrics=["pageViewsTotal", "uniqueUsers"],
        dates={"last": {"number": 1, "dimension": "day"}},
        granularity="daily",
    )

    out, formas = {}, set()
    for block in (payload or []):
        metric = block.get("metric")
        valor, forma = _scalar_from_block(block)
        if metric and valor is not None:
            out[metric] = int(valor)
            formas.add(forma)

    if not out:
        # Diagnostico: sin esto, un cambio de contrato deja el KPI en fallback
        # silencioso y nadie sabe por que. Se loguean solo las CLAVES, no los
        # datos.
        claves = [list((b.get("actualData") or {}).keys()) for b in (payload or [])]
        logger.warning(f"Totales de Marfeel: no se reconocio la respuesta; claves de actualData={claves}")
        return None

    logger.info(
        f"Totales de Marfeel (dia cerrado): {out.get('pageViewsTotal')} page views, "
        f"{out.get('uniqueUsers')} usuarios unicos [forma: {', '.join(sorted(formas))}]"
    )
    return {
        "page_views":   out.get("pageViewsTotal"),
        "unique_users": out.get("uniqueUsers"),
    }


def fetch_yesterday_by_channel(limit=MARFEEL_MAX_ROWS):
    """
    Etapa 1 — rendimiento por (artículo × canal de adquisición) del día anterior.
    Agrupa por url + title + source, de modo que cada fila trae qué canal
    (Google, Google Discover, Direct, Internal, Home, Social...) aportó cuántos
    page views a esa nota. Alimenta la tabla own_traffic_channels y el filtro por
    canal/folder del dashboard.

    OJO al tope de 500 filas: al ordenar por pageViewsTotal DESC quedan los pares
    (nota, canal) de mayor tráfico, que es justo lo relevante.
    """
    payload = query(
        metrics=["pageViewsTotal", "uniqueUsers"],
        group_by=["url", "title", "source"],
        dates={"last": {"number": 1, "dimension": "day"}},
        granularity="daily",
        order={"metric": "pageViewsTotal", "sort": "DESC"},
        limit=limit,
    )
    rows = _rows_from_response(payload, key_field="url")
    # _rows_from_response fusiona por key_field (url), colapsando los canales de
    # una misma nota. Aquí necesitamos una fila por (url, source), así que
    # parseamos las entries crudas conservando el canal.
    out = []
    for block in (payload or []):
        metric = block.get("metric")
        for entry in (block.get("actualData") or {}).get("values") or []:
            dims = {it.get("type"): it.get("value")
                    for it in (entry.get("items") or []) if it.get("type")}
            url = dims.get("url")
            if not url:
                continue
            out.append({
                "page_path": url,
                "title":     dims.get("title"),
                "channel":   dims.get("source") or "Otros",
                "metric":    metric,
                "total":     entry.get("total"),
            })
    # Fusiona las métricas (pageViewsTotal, uniqueUsers) por (url, channel).
    merged = {}
    for r in out:
        key = (r["page_path"], r["channel"])
        row = merged.setdefault(key, {
            "page_path": r["page_path"], "title": r["title"], "channel": r["channel"],
            "pageviews": 0, "unique_users": None,
        })
        if r["metric"] == "pageViewsTotal":
            row["pageviews"] = r["total"] or 0
        elif r["metric"] == "uniqueUsers":
            row["unique_users"] = r["total"]
    return list(merged.values())


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
    """
    Etapa 2 — lo que más tracción tiene en rpp.pe en el día en curso.
    Usa la misma forma (con `dates`) que los demás queries; el query sin `dates`
    + granularity 'realtime' devolvía {"msg":"Invalid params"}.
    """
    payload = query(
        metrics=["pageViewsTotal", "uniqueUsers"],
        group_by=["url", "title"],
        dates={"last": {"number": 1, "dimension": "day"}},
        granularity="daily",
        order={"metric": "pageViewsTotal", "sort": "DESC"},
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
