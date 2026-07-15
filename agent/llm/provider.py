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


# Tamaño de lote para categorizar titulares de competencia. Con Tencent Hy3
# (razonador, vía OpenRouter) un lote de 100 agotaba max_tokens PENSANDO y
# nunca llegaba a responder (finish_reason=length, visto en producción
# 2026-07-10) — se baja a 40 para que la respuesta quepa con margen.
# ~470 titulares/corrida → ~12 llamadas. Ojo con el límite free de OpenRouter
# (50 req/día con <$10 de crédito): morning (1×) + radar (4-6×/día reales) ≈
# 70-85 req/día — por encima del límite si el radar corre seguido. Si eso pasa
# en la práctica, cachear keyword→categoría en Supabase con TTL (evita
# reclasificar lo ya visto) en vez de subir el chunk de nuevo.
_ARTICLE_CHUNK = 40


def categorize_articles(articles, categories):
    """
    Re-categoriza titulares (p.ej. de competencia) con el LLM, en lotes de
    _ARTICLE_CHUNK. MUTA article["category"] in-place solo donde el LLM
    respondió con una categoría válida; el resto conserva la categoría por
    reglas (rules-first). Devuelve cuántos artículos quedaron con categoría
    del LLM, o None si no hay proveedor activo.
    """
    provider = _active_provider()
    if not provider or not articles:
        return None

    # Títulos únicos (la competencia repite titulares entre feeds/corridas)
    titles = list(dict.fromkeys(a.get("title") for a in articles if a.get("title")))
    mapping = {}
    for i in range(0, len(titles), _ARTICLE_CHUNK):
        result = provider.categorize_topics(titles[i:i + _ARTICLE_CHUNK], categories)
        if result:
            mapping.update(result)
    if not mapping:
        return None

    updated = 0
    for a in articles:
        cat = mapping.get(a.get("title"))
        if cat:
            a["category"] = cat
            updated += 1
    return updated


def explain_trends(items):
    """
    Explica por qué cada tendencia lo es (1-2 frases por tema), usando los
    titulares de Google News como evidencia. Devuelve {keyword: explicacion}
    o None si no hay proveedor o no implementa explain_trends (solo
    OpenRouter lo tiene hoy — sin él, el dashboard muestra solo las noticias).
    """
    provider = _active_provider()
    fn = getattr(provider, "explain_trends", None) if provider else None
    if not fn or not items:
        return None
    return fn(items)


def rewrite_onpage_batch(items, **kwargs):
    provider = _active_provider()
    if not provider:
        return None
    return provider.rewrite_onpage_batch(items, **kwargs)


# Lote para el match de cobertura: por cada llamada se comparan _COVERAGE_CHUNK
# titulares de competencia contra TODA la lista de titulares de RPP (~48 en 5h).
# Chunk chico para no agotar el presupuesto de razonamiento de Hy3 (mismo
# problema de finish_reason=length que en la categorización).
_COVERAGE_CHUNK = 25


def match_coverage(competitor_titles, own_titles):
    """
    Empareja titulares de competencia con titulares de RPP usando el LLM.
    Devuelve dict {indice_competencia: indice_rpp | -1} o None si no hay
    proveedor activo o el proveedor no implementa match_coverage (p.ej.
    Bedrock/Gemini, que hoy no lo tienen — cae al matcher por reglas).
    -1 significa "el LLM afirma que RPP NO lo cubre".
    """
    provider = _active_provider()
    fn = getattr(provider, "match_coverage", None) if provider else None
    if not fn or not competitor_titles or not own_titles:
        return None

    merged = {}
    for i in range(0, len(competitor_titles), _COVERAGE_CHUNK):
        chunk = competitor_titles[i:i + _COVERAGE_CHUNK]
        part = fn(chunk, own_titles)
        if part:
            for local_idx, own_idx in part.items():
                merged[i + local_idx] = own_idx
    return merged or None
