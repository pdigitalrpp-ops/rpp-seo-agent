import os
import tempfile
import logging
from datetime import datetime, timedelta
from google.oauth2 import service_account
from googleapiclient.discovery import build
from config import GSC_SITE_URL, GSC_DROP_ALERT_THRESHOLD, SITE_DOMAIN

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]

# Propiedad resuelta (auto-detectada o forzada por env), cacheada por proceso
_resolved_site_url = None


def _get_service():
    """
    Inicializa GSC. La service account debe estar añadida como usuario en GSC:
    Search Console → rpp.pe → Configuración → Usuarios y permisos → Añadir usuario
    (el email es el client_email del JSON, termina en .iam.gserviceaccount.com).
    """
    creds_json = os.environ.get("GSC_CREDENTIALS_JSON")
    if not creds_json:
        raise ValueError("GSC_CREDENTIALS_JSON no está configurado")
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        f.write(creds_json)
        tmp_path = f.name
    creds = service_account.Credentials.from_service_account_file(
        tmp_path, scopes=SCOPES
    )
    return build("searchconsole", "v1", credentials=creds)


def _resolve_site_url(service):
    """
    Devuelve el siteUrl a usar. Si GSC_SITE_URL está seteado por env, se usa tal
    cual. Si no, pregunta a Google qué propiedades ve la service account
    (sites().list) y elige la de rpp.pe — dominio primero, prefijo después.
    El listado completo queda en el log: es el diagnóstico definitivo de
    permisos (lista vacía = la service account no fue añadida / email errado).
    """
    global _resolved_site_url
    if GSC_SITE_URL:
        return GSC_SITE_URL
    if _resolved_site_url:
        return _resolved_site_url

    entries = service.sites().list().execute().get("siteEntry", [])
    visible = [
        (e.get("siteUrl", ""), e.get("permissionLevel", ""))
        for e in entries
    ]
    logger.info(f"GSC: propiedades visibles para la service account: {visible or 'NINGUNA'}")

    candidates = [
        url for url, perm in visible
        if SITE_DOMAIN in url and perm != "siteUnverifiedUser"
    ]
    if not candidates:
        raise ValueError(
            f"La service account no tiene acceso a ninguna propiedad de {SITE_DOMAIN}. "
            "Verificar que en Search Console se añadió el client_email del JSON "
            "(termina en .iam.gserviceaccount.com) como usuario de la propiedad."
        )
    # Preferir la propiedad de dominio (cubre todo el sitio)
    candidates.sort(key=lambda u: (not u.startswith("sc-domain:"), u))
    _resolved_site_url = candidates[0]
    logger.info(f"GSC: usando propiedad {_resolved_site_url}")
    return _resolved_site_url


def fetch_search_performance(days_back=3, row_limit=500):
    """
    GSC tiene latencia de ~2 días. days_back=3 garantiza datos confiables.
    """
    service = _get_service()
    end_date   = (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days_back + 1)).strftime("%Y-%m-%d")

    request = {
        "startDate":  start_date,
        "endDate":    end_date,
        "dimensions": ["page", "query"],
        "rowLimit":   row_limit,
        "dataState":  "all",
    }

    response = service.searchanalytics().query(
        siteUrl=_resolve_site_url(service), body=request
    ).execute()

    rows = []
    for row in response.get("rows", []):
        rows.append({
            "page":        row["keys"][0],
            "query":       row["keys"][1],
            "clicks":      row.get("clicks", 0),
            "impressions": row.get("impressions", 0),
            "ctr":         round(row.get("ctr", 0) * 100, 2),
            "position":    round(row.get("position", 0), 1),
            "date":        end_date,
        })
    return rows


def fetch_discover_performance(days_back=7):
    service = _get_service()
    end_date   = (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days_back + 1)).strftime("%Y-%m-%d")

    request = {
        "startDate":  start_date,
        "endDate":    end_date,
        "dimensions": ["page"],
        "type":       "Discover",
        "rowLimit":   200,
    }

    response = service.searchanalytics().query(
        siteUrl=_resolve_site_url(service), body=request
    ).execute()

    return [
        {
            "page":        row["keys"][0],
            "clicks":      row.get("clicks", 0),
            "impressions": row.get("impressions", 0),
            "ctr":         round(row.get("ctr", 0) * 100, 2),
            "date":        end_date,
            "search_type": "Discover",
        }
        for row in response.get("rows", [])
    ]


def find_quick_win_queries(min_impressions=200, pos_min=4.0, pos_max=10.0):
    rows = fetch_search_performance(days_back=7, row_limit=1000)
    quick_wins = []
    for row in rows:
        pos = row["position"]
        if pos_min <= pos <= pos_max and row["impressions"] >= min_impressions:
            quick_wins.append({
                "page":        row["page"],
                "query":       row["query"],
                "position":    pos,
                "impressions": row["impressions"],
                "clicks":      row["clicks"],
                "ctr":         row["ctr"],
                "potential":   round(row["impressions"] * 0.10 - row["clicks"], 0),
            })
    return sorted(quick_wins, key=lambda x: x["impressions"], reverse=True)


def find_low_ctr_urls(min_impressions=500, max_ctr=2.0):
    rows = fetch_search_performance(days_back=7, row_limit=1000)
    aggregated = {}
    for row in rows:
        page = row["page"]
        if page not in aggregated:
            aggregated[page] = {"impressions": 0, "clicks": 0}
        aggregated[page]["impressions"] += row["impressions"]
        aggregated[page]["clicks"]      += row["clicks"]

    low_ctr = []
    for page, data in aggregated.items():
        if data["impressions"] >= min_impressions:
            ctr = round(data["clicks"] / data["impressions"] * 100, 2) if data["impressions"] > 0 else 0
            if ctr <= max_ctr:
                low_ctr.append({
                    "page":        page,
                    "impressions": data["impressions"],
                    "clicks":      data["clicks"],
                    "ctr":         ctr,
                })
    return sorted(low_ctr, key=lambda x: x["impressions"], reverse=True)


def find_position_drops(threshold=None):
    if threshold is None:
        threshold = GSC_DROP_ALERT_THRESHOLD

    recent   = fetch_search_performance(days_back=3,  row_limit=500)
    previous = fetch_search_performance(days_back=10, row_limit=500)

    def aggregate(rows):
        agg = {}
        for row in rows:
            p = row["page"]
            if p not in agg:
                agg[p] = {"clicks": 0, "impressions": 0}
            agg[p]["clicks"]      += row["clicks"]
            agg[p]["impressions"] += row["impressions"]
        return agg

    recent_agg   = aggregate(recent)
    previous_agg = aggregate(previous)

    drops = []
    for page, rec_data in recent_agg.items():
        prev_data = previous_agg.get(page)
        if prev_data and prev_data["clicks"] > 0:
            drop = (prev_data["clicks"] - rec_data["clicks"]) / prev_data["clicks"]
            if drop >= threshold:
                drops.append({
                    "page":           page,
                    "clicks_recent":  rec_data["clicks"],
                    "clicks_prev":    prev_data["clicks"],
                    "drop_pct":       round(drop * 100, 1),
                })
    return sorted(drops, key=lambda x: x["drop_pct"], reverse=True)
