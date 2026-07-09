"""
Selector de proveedor LLM. Los orquestadores (run_morning.py, run_radar.py)
importan este módulo en vez de un proveedor específico — cambiar de proveedor
(o añadir uno nuevo) no toca el resto del código, solo este archivo.

Orden de preferencia: Bedrock (si hay credenciales AWS) > Gemini (si hay
GEMINI_API_KEY) > ninguno (el orquestador cae al comportamiento por reglas).
Bedrock va primero porque no tiene el bloqueo de cuota (limit: 0) que sí
tiene hoy el free tier de Gemini.
"""

from llm import bedrock, gemini


def _active_provider():
    if bedrock.is_enabled():
        return bedrock
    if gemini.is_enabled():
        return gemini
    return None


def is_enabled():
    return _active_provider() is not None


def categorize_topics(keywords, categories):
    provider = _active_provider()
    if not provider:
        return None
    return provider.categorize_topics(keywords, categories)


def rewrite_onpage_batch(items, **kwargs):
    provider = _active_provider()
    if not provider:
        return None
    return provider.rewrite_onpage_batch(items, **kwargs)
