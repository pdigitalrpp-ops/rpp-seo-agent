import re
import logging
from config import DECAY_THRESHOLD

logger = logging.getLogger(__name__)


def detect_content_decay(current_traffic, historical_traffic=None, threshold=None):
    if threshold is None:
        threshold = DECAY_THRESHOLD

    if not current_traffic:
        return []

    if not historical_traffic:
        logger.warning("No hay datos históricos para detectar decay.")
        return []

    current_index = {}
    for item in current_traffic:
        page = item.get("page_path", "")
        current_index[page] = current_index.get(page, 0) + item.get("sessions", 0)

    historical_by_page = {}
    for item in historical_traffic:
        page = item.get("page_path", "")
        if page not in historical_by_page:
            historical_by_page[page] = []
        historical_by_page[page].append(item.get("sessions", 0))

    decay_list = []
    for page, sessions_list in historical_by_page.items():
        if not sessions_list:
            continue

        top_sessions = sorted(sessions_list, reverse=True)[:30]
        peak_avg     = sum(top_sessions) / len(top_sessions)

        current_sessions = current_index.get(page, 0)

        if peak_avg > 0:
            drop = (peak_avg - current_sessions) / peak_avg
            if drop >= threshold and peak_avg >= 100:
                decay_list.append({
                    "page_path":        page,
                    "current_traffic":  int(current_sessions),
                    "peak_traffic":     int(peak_avg),
                    "drop_percentage":  round(drop * 100, 1),
                    "suggested_action": suggest_decay_action(page, drop),
                })

    return sorted(decay_list, key=lambda x: x["peak_traffic"], reverse=True)[:20]


def suggest_decay_action(page_path, drop_pct):
    page_lower = page_path.lower()

    if any(w in page_lower for w in ["que-es", "como", "guia", "tutorial", "todo-sobre"]):
        return "Actualizar datos y ejemplos. Verificar si la información sigue vigente."

    if re.search(r'\d{4}', page_path):
        return "Actualizar con información reciente. Cambiar el año en el título si aplica."

    if drop_pct >= 0.60:
        return "Revisión completa: actualizar contenido, mejorar título/meta y añadir multimedia."

    if drop_pct >= 0.40:
        return "Optimizar title y meta description. Añadir secciones de preguntas frecuentes."

    return "Mejorar title y meta description para aumentar CTR desde Search."


def prioritize_decay_articles(decay_list, gsc_data=None):
    if not decay_list:
        return []

    gsc_impressions = {}
    if gsc_data:
        for row in gsc_data:
            page = row.get("page", "")
            gsc_impressions[page] = gsc_impressions.get(page, 0) + row.get("impressions", 0)

    for item in decay_list:
        page = item["page_path"]
        item["gsc_impressions"]    = gsc_impressions.get(page, 0)
        item["recovery_potential"] = round(
            (item["peak_traffic"] * 0.4) + (item["gsc_impressions"] * 0.01), 0
        )

    return sorted(decay_list, key=lambda x: x["recovery_potential"], reverse=True)
