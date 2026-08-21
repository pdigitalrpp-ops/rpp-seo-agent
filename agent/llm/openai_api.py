"""
Capa LLM — cliente de OpenAI (API oficial, Chat Completions).

Proveedor PREFERIDO desde 2026-08-21: el usuario tiene key propia de OpenAI.
Reemplaza a OpenRouter, que quedó como fallback.

Por qué es un archivo de 40 líneas: OpenRouter ya hablaba el protocolo de
OpenAI, así que todo lo real —transporte, parseo de JSON y los 5 prompts—
vive en `llm/openai_compat.py`. Acá solo se declara el `Client` con la URL,
la key y el modelo, y se exponen las tareas con el contrato que espera
`llm/provider.py`.

Se llama `openai_api.py` y no `openai.py` a propósito: aunque en Python 3 los
imports absolutos evitarían el choque, un módulo llamado igual que el paquete
oficial de OpenAI es una trampa para el siguiente que lea esto (o para el día
en que alguien instale el SDK). Este cliente NO usa el SDK — habla REST con
`requests`, igual que el resto de proveedores del proyecto.

MODELO: la familia GPT-5.6 (sol/terra/luna), default `gpt-5.6-luna` — el
porqué de elegir el barato está razonado en config.py junto a OPENAI_MODEL.
Los tres son modelos de RAZONAMIENTO, y eso cambia el contrato de Chat
Completions: `max_completion_tokens` en vez de `max_tokens`, sin `temperature`
propia, y `reasoning_effort` disponible. Se configura de entrada según el
nombre del modelo (`_is_reasoning`); si aparece uno cuyo prefijo no conocemos,
`openai_compat._adapt_to_400` lo corrige solo al primer 400.

DIFERENCIAS REALES CON OPENROUTER (por eso el Client se declara distinto):
- **`reasoning_effort` (plano) y no `reasoning: {...}`.** El objeto anidado es
  la extensión de OpenRouter; la API de OpenAI usa el campo plano y devuelve
  400 ante uno desconocido. Los dos existen por el mismo motivo —evitar que el
  modelo agote el presupuesto pensando— pero no se escriben igual.
- **`response_format: json_object` activado** (`json_mode=True`): las 5 tareas
  piden JSON y OpenAI lo garantiza a nivel de API, así que desaparece el caso
  "el modelo contestó prosa" que sí se veía con el router de OpenRouter.
  Requiere que el prompt mencione JSON — todos lo hacen ("Responde SOLO un
  JSON").
- **Sin headers HTTP-Referer / X-Title**, que solo sirven para el ranking de
  apps de OpenRouter.
"""

from config import (
    OPENAI_API_KEY, OPENAI_MODEL, OPENAI_BASE_URL, OPENAI_TIMEOUT_SECONDS,
    OPENAI_REASONING_EFFORT,
)
from llm import openai_compat
from llm.openai_compat import Client

# Familias de razonamiento de OpenAI. Con ellas el contrato de Chat Completions
# CAMBIA: exigen `max_completion_tokens` en vez de `max_tokens`, rechazan
# `temperature` distinta de la de fábrica, y aceptan `reasoning_effort`.
# Toda la familia GPT-5.x lo es (sol/terra/luna), igual que las o-series.
_REASONING_PREFIXES = ("gpt-5", "o1", "o3", "o4")


def _is_reasoning(model):
    return (model or "").lower().startswith(_REASONING_PREFIXES)


_REASONING = _is_reasoning(OPENAI_MODEL)

_client = Client(
    label="OpenAI",
    base_url=OPENAI_BASE_URL,
    api_key=OPENAI_API_KEY,
    model=OPENAI_MODEL,
    timeout=OPENAI_TIMEOUT_SECONDS,
    json_mode=True,
    # Se configura de entrada en vez de esperar el 400 y dejar que
    # _adapt_to_400 lo corrija: la auto-corrección es la red de seguridad para
    # modelos que no conocemos, no la vía normal — desperdiciaría una llamada
    # fallida en cada corrida.
    extra_body={"reasoning_effort": OPENAI_REASONING_EFFORT} if _REASONING else None,
    max_tokens_field="max_completion_tokens" if _REASONING else "max_tokens",
    send_temperature=not _REASONING,
    # Los tokens de razonamiento salen del MISMO presupuesto que la respuesta,
    # y los topes de las 5 tareas (4000-6000) están calibrados para un modelo
    # que no piensa. Sin holgura, el modelo se queda pensando y devuelve
    # content vacío con finish_reason="length" — el fallo exacto de Tencent Hy3
    # el 2026-07-10. Se factura lo GENERADO, no lo reservado: la holgura no
    # cuesta nada salvo cuando de verdad hace falta.
    max_tokens_scale=4.0 if _REASONING else 1.0,
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


def suggest_headlines(items, title_max=70):
    return openai_compat.suggest_headlines(_client, items, title_max=title_max)
