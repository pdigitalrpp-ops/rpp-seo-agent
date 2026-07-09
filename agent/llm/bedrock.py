"""
Capa LLM — cliente de Amazon Bedrock (Anthropic Claude), vía boto3.

Mismo contrato que llm/gemini.py: categorize_topics(...) y
rewrite_onpage_batch(...), ambas devuelven None si no hay credenciales o la
llamada falla (rules-first: el orquestador cae al comportamiento por reglas).

A diferencia de Gemini (limit: 0 en el free tier), Bedrock cobra por uso real
desde el primer token — no hay bloqueo de cuota, solo costo por token.
"""

import json
import logging

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from config import AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, BEDROCK_MODEL_ID

logger = logging.getLogger(__name__)

_client = None


def is_enabled():
    return bool(AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY)


def _get_client():
    global _client
    if _client is None:
        _client = boto3.client(
            "bedrock-runtime",
            region_name=AWS_REGION,
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
        )
    return _client


def _generate(prompt, system=None, max_tokens=2000):
    """
    Invoca el modelo vía Anthropic Messages API sobre Bedrock. Devuelve el
    texto (str) o None si falla — nunca lanza, para no bloquear al orquestador.
    """
    if not is_enabled():
        return None

    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens":        max_tokens,
        "temperature":       0.4,
        "messages":          [{"role": "user", "content": prompt}],
    }
    if system:
        body["system"] = system

    try:
        resp = _get_client().invoke_model(
            modelId=BEDROCK_MODEL_ID,
            body=json.dumps(body),
            contentType="application/json",
            accept="application/json",
        )
        data = json.loads(resp["body"].read())
        return data["content"][0]["text"]
    except (BotoCoreError, ClientError, KeyError, IndexError, TypeError) as e:
        logger.warning(f"Bedrock no respondió ({e}); se usa el fallback por reglas")
        return None


def _generate_json(prompt, system=None):
    """Como _generate pero parsea el JSON. Devuelve el objeto o None."""
    raw = _generate(prompt, system=system)
    if not raw:
        return None
    raw = raw.strip()
    # Claude a veces envuelve el JSON en ```json ... ``` pese a la instrucción
    # de responder SOLO JSON; se limpia antes de parsear.
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError) as e:
        logger.warning(f"Bedrock devolvió JSON inválido: {e}")
        return None


# ---------------------------------------------------------------------------
# A) Categorización de temas del radar
# ---------------------------------------------------------------------------

def categorize_topics(keywords, categories):
    """
    Clasifica una lista de keywords en una de las `categories`, en UNA sola
    llamada. Devuelve dict {keyword: categoria} o None si el LLM no está.
    """
    if not is_enabled() or not keywords:
        return None

    cats = ", ".join(categories)
    numbered = "\n".join(f"{i}. {k}" for i, k in enumerate(keywords))
    system = (
        "Eres un editor SEO de RPP Noticias (Perú). Clasificas temas de "
        "actualidad en la sección editorial correcta de un medio de noticias. "
        "Respondes exclusivamente en JSON, sin texto adicional ni markdown."
    )
    prompt = (
        f"Clasifica cada tema en EXACTAMENTE una de estas categorías: {cats}.\n"
        "Ejemplos de criterio: nombres de futbolistas, clubes o partidos → deportes; "
        "artistas, farándula, TV, cine → entretenimiento; sismos, clima, sucesos → "
        "según corresponda (mundo/actualidad); si de verdad no encaja → otros.\n\n"
        f"Temas:\n{numbered}\n\n"
        'Responde SOLO un JSON: {"items": [{"i": <indice>, "categoria": "<categoria>"}]}'
    )
    data = _generate_json(prompt, system=system)
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        return None

    valid = set(categories)
    out = {}
    for it in data["items"]:
        try:
            idx = int(it["i"])
            cat = str(it["categoria"]).lower().strip()
        except (KeyError, ValueError, TypeError):
            continue
        if 0 <= idx < len(keywords) and cat in valid:
            out[keywords[idx]] = cat
    return out or None


# ---------------------------------------------------------------------------
# B) Reescritura on-page (título / meta / H2) para la auditoría
# ---------------------------------------------------------------------------

def rewrite_onpage_batch(items, title_max=60, meta_min=120, meta_max=160):
    """
    Reescribe VARIAS notas en UNA sola llamada. `items` = lista de dicts con
    keys {title, meta_description, keyword, issues, first_paragraph}.
    Devuelve una lista alineada por índice: [suggestion|None, ...] o None global.
    """
    if not is_enabled() or not items:
        return None

    notes = []
    for i, it in enumerate(items):
        notes.append({
            "i":         i,
            "keyword":   it.get("keyword") or "",
            "title":     it.get("title") or "",
            "meta":      it.get("meta_description") or "",
            "parrafo":   (it.get("first_paragraph") or "")[:300],
            "problemas": [p.get("message") for p in (it.get("issues") or [])],
        })
    system = (
        "Eres un editor SEO de RPP Noticias (Perú). Reescribes títulos y meta "
        "descriptions de notas ya publicadas para mejorar posicionamiento y CTR, "
        "en español neutro peruano, sin clickbait ni inventar datos. Respondes "
        "exclusivamente en JSON, sin texto adicional ni markdown."
    )
    prompt = (
        f"Para CADA nota reescribe: un título ≤ {title_max} caracteres con la "
        f"keyword de forma natural; una meta description entre {meta_min} y "
        f"{meta_max} caracteres con la keyword; y hasta 3 subtítulos H2 útiles.\n"
        "Si una nota no trae keyword, optimiza igual por su tema.\n\n"
        f"Notas (JSON):\n{json.dumps(notes, ensure_ascii=False)}\n\n"
        'Responde SOLO un JSON: {"items": [{"i": <indice>, "title": "...", '
        '"meta_description": "...", "h2": ["...","..."]}]}'
    )
    data = _generate_json(prompt, system=system)
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        return None

    out = [None] * len(items)
    for entry in data["items"]:
        try:
            idx = int(entry["i"])
        except (KeyError, ValueError, TypeError):
            continue
        if not (0 <= idx < len(items)):
            continue
        sug = {
            "title":            (entry.get("title") or "").strip() or None,
            "meta_description": (entry.get("meta_description") or "").strip() or None,
            "h2":               [h for h in (entry.get("h2") or []) if isinstance(h, str)][:3],
        }
        if sug["title"] or sug["meta_description"]:
            out[idx] = sug
    return out
