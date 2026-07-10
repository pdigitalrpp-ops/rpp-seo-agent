"""
Capa LLM — cliente de OpenRouter (API REST compatible con OpenAI Chat
Completions), vía requests. Modelo por defecto: Tencent Hy3 (free tier de
OpenRouter, gratis mientras dure la promo).

Mismo contrato que llm/bedrock.py y llm/gemini.py: categorize_topics(...) y
rewrite_onpage_batch(...), ambas devuelven None si no hay API key, si el
modelo no está disponible, o la llamada falla (rules-first: el orquestador
cae al comportamiento por reglas).

Nota sobre el modelo gratis: Tencent liberó "Hy3" (295B MoE) en OpenRouter
gratis del 2026-07-06 al 2026-07-21 (slug "tencent/hy3:free"). Si esa
promoción termina o el modelo deja de estar disponible, OPENROUTER_MODEL se
puede apuntar a otro modelo (gratis o de pago) sin tocar este archivo.
"""

import json
import logging
import time

import requests

from config import (
    OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_BASE_URL,
    OPENROUTER_TIMEOUT_SECONDS,
)

logger = logging.getLogger(__name__)


def is_enabled():
    return bool(OPENROUTER_API_KEY)


def _generate(prompt, system=None, max_tokens=2000, retries=1):
    """
    Llama a /chat/completions (formato OpenAI). Devuelve el texto (str) o None
    si falla — nunca lanza, para no bloquear al orquestador.
    """
    if not is_enabled():
        return None

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    body = {
        "model":       OPENROUTER_MODEL,
        "messages":    messages,
        "temperature": 0.4,
        "max_tokens":  max_tokens,
    }
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type":  "application/json",
        # Recomendados por OpenRouter para identificar la app (no son secretos).
        "HTTP-Referer":  "https://rpp-seo-agent.vercel.app",
        "X-Title":       "RPP SEO Agent",
    }

    last_err = None
    for attempt in range(retries + 1):
        try:
            resp = requests.post(
                f"{OPENROUTER_BASE_URL}/chat/completions",
                headers=headers,
                json=body,
                timeout=OPENROUTER_TIMEOUT_SECONDS,
            )
            if not resp.ok:
                last_err = f"{resp.status_code}: {resp.text[:2000]}"
                if resp.status_code == 429 and attempt < retries:
                    time.sleep(10 * (attempt + 1))
                    continue
                logger.warning(f"OpenRouter {resp.status_code}: {resp.text[:2000]}")
                return None
            data = resp.json()
            return data["choices"][0]["message"]["content"]
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(2)
    logger.warning(f"OpenRouter no respondió ({last_err}); se usa el fallback por reglas")
    return None


def _generate_json(prompt, system=None):
    """Como _generate pero parsea el JSON. Devuelve el objeto o None."""
    raw = _generate(prompt, system=system)
    if not raw:
        return None
    raw = raw.strip()
    # Algunos modelos envuelven el JSON en ```json ... ``` pese a la
    # instrucción de responder SOLO JSON; se limpia antes de parsear.
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError) as e:
        logger.warning(f"OpenRouter devolvió JSON inválido: {e}")
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
