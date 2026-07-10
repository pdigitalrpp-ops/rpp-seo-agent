"""
Selector de proveedor LLM. Los orquestadores (run_morning.py, run_radar.py)
importan este módulo en vez de un proveedor específico — cambiar de proveedor
(o añadir uno nuevo) no toca el resto del código, solo este archivo.

Orden de preferencia: OpenRouter (si hay OPENROUTER_API_KEY) > Bedrock (si hay
credenciales AWS) > Gemini (si hay GEMINI_API_KEY) > ninguno (el orquestador
cae al comportamiento por reglas).

OpenRouter va primero desde 2026-07-10: reemplaza a Bedrock como proveedor
preferido porque la cuenta AWS del usuario tiene los modelos Claude de
generación 3 marcados como Legacy (ResourceNotFoundException en los 3 IDs
probados) — Bedrock nunca llegó a responder en producción. Bedrock y Gemini
se dejan como fallback en cadena por si algún día se destraban (no cuesta
nada mantenerlos: rules-first, cada uno cae al siguiente si no está
habilitado o falla).
"""

from llm import bedrock, gemini, openrouter


def _active_provider():
    if openrouter.is_enabled():
        return openrouter
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
