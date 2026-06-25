"""
Notificadores de alertas de la Etapa 3.
Enruta cada alerta al canal del equipo de su sección (Teams o WhatsApp).

El canal definitivo (Teams vs WhatsApp) y el mapa sección->responsable los
define el usuario más adelante en config.SECTION_RESPONSIBLES. Mientras no haya
responsable configurado para una sección, la alerta NO se envía a un canal
externo (queda solo en el dashboard) y se loggea.

- Teams: webhook entrante a un canal (lo más simple, recomendado).
- WhatsApp: requiere la Business Cloud API de Meta (stub por ahora).
"""

import logging
import requests

from config import SECTION_RESPONSIBLES

logger = logging.getLogger(__name__)


def _format_alert_text(alert):
    return (
        f"🔴 [{alert.get('section', 'sin sección').upper()}] "
        f"{alert.get('title', 'Tema en tendencia')}\n"
        f"{alert.get('description', '')}\n"
        f"Score: {alert.get('score', '—')}/100"
        + (f" · {alert['url']}" if alert.get("url") else "")
    )


def _send_teams(webhook_url, text):
    resp = requests.post(webhook_url, json={"text": text}, timeout=15)
    resp.raise_for_status()


def _send_whatsapp(config_section, text):
    # TODO: integrar WhatsApp Business Cloud API (Meta) cuando se decida ese canal.
    logger.warning("Canal WhatsApp aún no implementado; alerta no enviada por WhatsApp")
    raise NotImplementedError("WhatsApp Business API pendiente de configurar")


def dispatch_alert(alert):
    """
    Envía una alerta al canal de su sección. Devuelve True si se envió a un
    canal externo, False si solo quedó en el dashboard (sin responsable).
    """
    section = (alert.get("section") or "").lower()
    target = SECTION_RESPONSIBLES.get(section)
    if not target:
        logger.info(f"Sección '{section}' sin responsable configurado; alerta solo en dashboard")
        return False

    text = _format_alert_text(alert)
    channel = target.get("channel")
    try:
        if channel == "teams" and target.get("webhook"):
            _send_teams(target["webhook"], text)
        elif channel == "whatsapp":
            _send_whatsapp(target, text)
        else:
            logger.warning(f"Canal '{channel}' de la sección '{section}' mal configurado")
            return False
        logger.info(f"✅ Alerta enviada a {channel} de la sección '{section}'")
        return True
    except Exception as e:
        logger.error(f"❌ Falló el envío de alerta de '{section}': {e}")
        return False
