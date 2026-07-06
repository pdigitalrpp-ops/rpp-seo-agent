"""
Capa LLM — cliente de Google Gemini (API REST, sin SDK).

Filosofía rules-first: TODA función devuelve None (o el fallback pedido) si no
hay GEMINI_API_KEY o si la llamada falla. El orquestador entonces sigue con el
comportamiento por reglas. Gemini solo AUMENTA la calidad, nunca es un bloqueo.

Dos usos de alto nivel:
  - categorize_topics(...)  → categoría real de cada tema del radar (batch, 1 call).
  - rewrite_onpage(...)     → título / meta description / H2 optimizados por nota.
"""

import json
import logging
import time

import requests

from config import (
    GEMINI_API_KEY, GEMINI_MODEL, GEMINI_BASE_URL, GEMINI_TIMEOUT_SECONDS,
)

logger = logging.getLogger(__name__)


def is_enabled():
    return bool(GEMINI_API_KEY)


def _generate(prompt, system=None, want_json=True, retries=2):
    """
    Llama a Gemini generateContent. Devuelve el texto (str) o None si falla.
    Con want_json fuerza responseMimeType application/json.
    En 429 (rate limit del free tier) hace backoff creciente. Para minimizar
    requests, los callers BATCHEAN (1 llamada para muchos ítems).
    """
    if not GEMINI_API_KEY:
        return None

    url = f"{GEMINI_BASE_URL}/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.4},
    }
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    if want_json:
        body["generationConfig"]["responseMimeType"] = "application/json"

    last_err = None
    for attempt in range(retries + 1):
        try:
            resp = requests.post(url, json=body, timeout=GEMINI_TIMEOUT_SECONDS)
            if resp.status_code == 429:   # rate limit → backoff creciente y reintenta
                last_err = "429 rate limit"
                if attempt < retries:
                    time.sleep(12 * (attempt + 1))   # 12s, 24s
                continue
            resp.raise_for_status()
            data = resp.json()
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(2)
    logger.warning(f"Gemini no respondió ({last_err}); se usa el fallback por reglas")
    return None


def _generate_json(prompt, system=None):
    """Como _generate pero parsea el JSON. Devuelve el objeto o None."""
    raw = _generate(prompt, system=system, want_json=True)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError) as e:
        logger.warning(f"Gemini devolvió JSON inválido: {e}")
        return None


# ---------------------------------------------------------------------------
# A) Categorización de temas del radar
# ---------------------------------------------------------------------------

def categorize_topics(keywords, categories):
    """
    Clasifica una lista de keywords en una de las `categories`, en UNA sola
    llamada. Devuelve dict {keyword: categoria} o None si Gemini no está.
    Las reglas por keyword fallaban con nombres propios (jugadores, países en
    un partido); Gemini razona sobre el tema real.
    """
    if not is_enabled() or not keywords:
        return None

    cats = ", ".join(categories)
    numbered = "\n".join(f"{i}. {k}" for i, k in enumerate(keywords))
    system = (
        "Eres un editor SEO de RPP Noticias (Perú). Clasificas temas de "
        "actualidad en la sección editorial correcta de un medio de noticias."
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

def rewrite_onpage(title, meta_description, keyword, issues, first_paragraph=None,
                   title_max=60, meta_min=120, meta_max=160):
    """
    Propone versiones optimizadas de título y meta description (y hasta 3 H2)
    para una nota publicada, respetando la keyword objetivo y los límites de
    caracteres. Devuelve dict {title, meta_description, h2[]} o None.
    """
    if not is_enabled():
        return None

    issue_lines = "\n".join(f"- {i.get('message')}" for i in (issues or []))
    kw_line = f"Keyword objetivo: {keyword}\n" if keyword else ""
    system = (
        "Eres un editor SEO de RPP Noticias (Perú). Reescribes títulos y meta "
        "descriptions de notas ya publicadas para mejorar posicionamiento y CTR, "
        "en español neutro peruano, sin clickbait ni inventar datos que no estén "
        "en la nota."
    )
    prompt = (
        f"{kw_line}"
        f"Título actual: {title or '(vacío)'}\n"
        f"Meta description actual: {meta_description or '(vacía)'}\n"
        + (f"Primer párrafo: {first_paragraph}\n" if first_paragraph else "")
        + f"\nProblemas detectados:\n{issue_lines or '- (ninguno)'}\n\n"
        f"Reescribe respetando: título ≤ {title_max} caracteres e incluyendo la "
        f"keyword de forma natural; meta description entre {meta_min} y {meta_max} "
        "caracteres con la keyword; y sugiere hasta 3 subtítulos H2 útiles.\n"
        'Responde SOLO un JSON: '
        '{"title": "...", "meta_description": "...", "h2": ["...", "..."]}'
    )
    data = _generate_json(prompt, system=system)
    if not isinstance(data, dict):
        return None
    out = {
        "title":            (data.get("title") or "").strip() or None,
        "meta_description": (data.get("meta_description") or "").strip() or None,
        "h2":               [h for h in (data.get("h2") or []) if isinstance(h, str)][:3],
    }
    if not out["title"] and not out["meta_description"]:
        return None
    return out


def rewrite_onpage_batch(items, title_max=60, meta_min=120, meta_max=160):
    """
    Reescribe VARIAS notas en UNA sola llamada (clave para no saturar el free
    tier: 8 notas = 1 request, no 8). `items` = lista de dicts con keys
    {title, meta_description, keyword, issues, first_paragraph}.
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
        "en español neutro peruano, sin clickbait ni inventar datos."
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
