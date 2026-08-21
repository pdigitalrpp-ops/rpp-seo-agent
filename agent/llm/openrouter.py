"""
Capa LLM — cliente de OpenRouter (API REST compatible con OpenAI Chat
Completions), vía requests.

Fue el proveedor PREFERIDO del 2026-07-10 al 2026-08-21; desde entonces es el
primer FALLBACK, detrás de OpenAI (llm/openai_api.py), que usa una key propia
del usuario en vez del catálogo gratis rotativo.

Desde 2026-08-21 este archivo es un adaptador: el transporte y los 5 prompts
viven en `llm/openai_compat.py`, compartidos con OpenAI porque ambos hablan el
mismo protocolo. Acá solo queda lo que es específico de OpenRouter (el modelo,
el parámetro `reasoning`, los headers de identificación de la app) y la
historia de por qué está configurado así.

POR QUÉ EL MODELO DEFAULT ES UN ROUTER Y NO UN SLUG
---------------------------------------------------
El default fue "tencent/hy3:free" (promo de Tencent hasta 2026-07-21) y luego,
por un día, "meta-llama/llama-3.3-70b-instruct:free" — ambos slugs fijos
terminaron devolviendo 404 "unavailable for free" a los pocos días/horas de
fijarlos. El catálogo free de OpenRouter rota más rápido de lo que se puede
fijar a mano, por eso el default pasó al router "openrouter/free". Si el
router también falla, OPENROUTER_MODEL se puede apuntar a un modelo de pago
por env, sin tocar este archivo.

POR QUÉ SE ENVÍA `reasoning` (y por qué OpenAI NO lo lleva)
-----------------------------------------------------------
Tencent Hy3 resultó ser un modelo razonador: gastaba TODO el `max_tokens`
pensando y cortaba antes de escribir la respuesta (`finish_reason="length"`,
`content` vacío) — visto en producción el 2026-07-10 con lotes de ~80-100
ítems. El fix no fue subir tokens a lo bruto sino limitar el razonamiento con
`reasoning: {"effort": "low", "exclude": True}`, el parámetro unificado de
OpenRouter. Es una EXTENSIÓN de OpenRouter: mandárselo a la API de OpenAI da
400, por eso viaja en `extra_body` de este cliente y no en el núcleo
compartido.

`json_mode` va APAGADO acá a propósito: `response_format` no está garantizado
para todo el catálogo de OpenRouter (y menos aún para el modelo que el router
elija en cada llamada). El parseo tolerante de `openai_compat.generate_json`
—que limpia ```json y rescata el primer objeto embebido en prosa— es la red
que cubre eso.
"""

from config import (
    OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_BASE_URL,
    OPENROUTER_TIMEOUT_SECONDS,
)
from llm import openai_compat
from llm.openai_compat import Client

_client = Client(
    label="OpenRouter",
    base_url=OPENROUTER_BASE_URL,
    api_key=OPENROUTER_API_KEY,
    model=OPENROUTER_MODEL,
    timeout=OPENROUTER_TIMEOUT_SECONDS,
    extra_body={"reasoning": {"effort": "low", "exclude": True}},
    extra_headers={
        # Recomendados por OpenRouter para identificar la app (no son secretos).
        "HTTP-Referer": "https://rpp-seo-agent.vercel.app",
        "X-Title":      "RPP SEO Agent",
    },
    json_mode=False,
)


def is_enabled():
    return _client.is_enabled()


def categorize_topics(keywords, categories):
    return openai_compat.categorize_topics(_client, keywords, categories)


def rewrite_onpage_batch(items, title_max=60, meta_min=120, meta_max=160):
    return openai_compat.rewrite_onpage_batch(
        _client, items, title_max=title_max, meta_min=meta_min, meta_max=meta_max
    )


def classify_query_freshness(queries, trend_keywords):
    return openai_compat.classify_query_freshness(_client, queries, trend_keywords)


def explain_trends(items):
    return openai_compat.explain_trends(_client, items)


def match_coverage(competitor_titles, own_titles):
    return openai_compat.match_coverage(_client, competitor_titles, own_titles)
