"""
Selector de proveedor LLM. Los orquestadores (run_morning.py, run_radar.py)
importan este módulo en vez de un proveedor específico — cambiar de proveedor
(o añadir uno nuevo) no toca el resto del código, solo este archivo.

Orden de preferencia: OpenAI (si hay OPENAI_API_KEY) > OpenRouter (si hay
OPENROUTER_API_KEY) > Bedrock (si hay credenciales AWS) > Gemini (si hay
GEMINI_API_KEY) > ninguno (el orquestador cae al comportamiento por reglas).

**OpenAI va primero desde 2026-08-21** (key propia del usuario). Desplaza a
OpenRouter, que era el preferido desde 2026-07-10 y ahora es el primer
fallback: con el router `openrouter/free` el modelo real cambiaba en cada
llamada — corridas de ~11 min y algún lote perdido cuando enrutaba a un modelo
que devolvía prosa en vez de JSON. Con key propia el modelo es estable.

Antes de OpenRouter el preferido era Bedrock, que NUNCA llegó a responder en
producción (la cuenta AWS tiene los Claude de gen. 3 marcados Legacy,
ResourceNotFoundException en los 3 IDs probados). Bedrock y Gemini siguen en
la cadena por si algún día se destraban: no cuesta nada mantenerlos, cada uno
cae al siguiente si no está habilitado o falla.

`LLM_PROVIDER` (env) fuerza uno concreto e ignora el orden. Existe para no
tener que BORRAR secretos: con las keys de OpenAI y OpenRouter conviviendo en
GitHub, volver atrás ante un problema es cambiar una variable, no re-pegar una
credencial.
"""

import logging

from config import LLM_PROVIDER
from llm import bedrock, gemini, openai_api, openrouter

logger = logging.getLogger(__name__)

# Orden de preferencia. El primero habilitado gana.
_CHAIN = [
    ("openai",     openai_api),
    ("openrouter", openrouter),
    ("bedrock",    bedrock),
    ("gemini",     gemini),
]

_BY_NAME = dict(_CHAIN)


def _active_provider():
    if LLM_PROVIDER:
        forced = _BY_NAME.get(LLM_PROVIDER)
        if forced is None:
            logger.warning(
                f"LLM_PROVIDER='{LLM_PROVIDER}' no es un proveedor conocido "
                f"({', '.join(_BY_NAME)}); se ignora y se usa el orden por defecto"
            )
        elif forced.is_enabled():
            return forced
        else:
            # Se avisa y se sigue con la cadena: quedarse sin LLM por un
            # secreto mal puesto es peor que usar el siguiente proveedor.
            logger.warning(
                f"LLM_PROVIDER='{LLM_PROVIDER}' está forzado pero no tiene "
                "credenciales; se cae al orden por defecto"
            )
    for _, module in _CHAIN:
        if module.is_enabled():
            return module
    return None


def active_provider_name():
    """Nombre del proveedor que se va a usar, o 'reglas' si no hay ninguno."""
    active = _active_provider()
    for name, module in _CHAIN:
        if module is active:
            return name
    return "reglas"


def describe_providers():
    """
    Línea de diagnóstico para el log de arranque de los orquestadores: qué
    credenciales llegaron al workflow y CUÁL manda. Lo segundo importa desde
    que hay dos proveedores plausibles conviviendo — ver solo la presencia de
    credenciales no dice cuál se está usando de verdad, que es justo el dato
    que hace falta cuando algo sale null en silencio.
    """
    detected = " ".join(f"{name}={module.is_enabled()}" for name, module in _CHAIN)
    forced = f" (forzado por LLM_PROVIDER={LLM_PROVIDER})" if LLM_PROVIDER else ""
    return (
        "🔑 Proveedores LLM detectados (solo presencia de credenciales, no validez): "
        f"{detected} → activo: {active_provider_name()}{forced}"
    )


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
# 2026-07-10) — se baja a 40 para que la respuesta quepa con margen. Se
# mantiene en 40 con OpenAI: el límite ahora no es el razonamiento sino el
# tamaño de la respuesta JSON, y 40 ítems ya estaba calibrado contra
# producción. Subirlo abarata la corrida pero hay que re-verificarlo.
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


# Lote para clasificar vigencia de queries GSC (mismo motivo que _ARTICLE_CHUNK:
# lotes grandes agotan el presupuesto de razonamiento de Hy3).
_FRESHNESS_CHUNK = 40


def classify_query_freshness(queries, trend_keywords):
    """
    Clasifica la vigencia de la demanda de queries de GSC ('hot'|'evergreen'|
    'past') en lotes. Devuelve {query: estado} o None si no hay proveedor o no
    implementa classify_query_freshness (OpenAI y OpenRouter sí; Bedrock y
    Gemini no — sin ella quedan las reglas de analyzers/freshness.py).
    """
    provider = _active_provider()
    fn = getattr(provider, "classify_query_freshness", None) if provider else None
    if not fn or not queries:
        return None
    merged = {}
    for i in range(0, len(queries), _FRESHNESS_CHUNK):
        part = fn(queries[i:i + _FRESHNESS_CHUNK], trend_keywords)
        if part:
            merged.update(part)
    return merged or None


def explain_trends(items):
    """
    Explica por qué cada tendencia lo es (1-2 frases por tema), usando los
    titulares de Google News como evidencia. Devuelve {keyword: explicacion}
    o None si no hay proveedor o no implementa explain_trends (OpenAI y
    OpenRouter sí; Bedrock y Gemini no — sin ella el dashboard muestra solo
    las noticias).
    """
    provider = _active_provider()
    fn = getattr(provider, "explain_trends", None) if provider else None
    if not fn or not items:
        return None
    return fn(items)


def suggest_headlines(items, title_max=70):
    """
    Titular y ángulo para las recomendaciones, anclados en los titulares reales
    del hecho. Devuelve {keyword: {"title", "angle"}} o None si no hay proveedor
    o no implementa suggest_headlines (OpenAI y OpenRouter sí; Bedrock y Gemini
    no — sin ella queda la plantilla de analyzers/opportunities.py).

    Una sola llamada por corrida: son 5 temas, no hace falta trocear.
    """
    provider = _active_provider()
    fn = getattr(provider, "suggest_headlines", None) if provider else None
    if not fn or not items:
        return None
    return fn(items, title_max=title_max)


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
    proveedor activo o el proveedor no implementa match_coverage (Bedrock y
    Gemini hoy no lo tienen — cae al matcher por reglas).
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
