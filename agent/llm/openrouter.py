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


def _generate(prompt, system=None, max_tokens=4000, retries=1):
    """
    Llama a /chat/completions (formato OpenAI). Devuelve el texto (str) o None
    si falla — nunca lanza, para no bloquear al orquestador.

    Tencent Hy3 es un modelo razonador (chain-of-thought): antes de responder
    "piensa" y esos tokens de razonamiento salen del mismo `max_tokens`. Con
    poco presupuesto, el modelo se queda pensando y corta ANTES de escribir
    la respuesta (`finish_reason: "length"`, `content` vacío, solo el
    razonamiento a medias en `reasoning`) — visto en producción con
    max_tokens=2000/4000 en lotes de ~80-100 ítems. Por eso: (a) se limita el
    razonamiento con `reasoning.effort: "low"` (deja el grueso del
    presupuesto para la respuesta) vía el parámetro unificado de OpenRouter
    (openrouter.ai/docs/guides/best-practices/reasoning-tokens), y (b) el
    default de `max_tokens` sube a 4000. El campo `reasoning` NUNCA se usa
    como respuesta si `content` viene vacío — es el pensamiento truncado del
    modelo, no la salida estructurada que se pidió.
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
        "reasoning":   {"effort": "low", "exclude": True},
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
            choice = data["choices"][0]
            content = (choice["message"].get("content") or "").strip()
            if not content:
                finish = choice.get("finish_reason")
                hint = (
                    " — se agotó max_tokens pensando, sin llegar a responder "
                    "(subir max_tokens o bajar el tamaño del lote)"
                    if finish == "length" else ""
                )
                logger.warning(
                    f"OpenRouter respondió 200 pero sin content (finish_reason={finish}){hint}; "
                    "se usa el fallback por reglas"
                )
                return None
            return content
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(2)
    logger.warning(f"OpenRouter no respondió ({last_err}); se usa el fallback por reglas")
    return None


def _generate_json(prompt, system=None, max_tokens=2000):
    """Como _generate pero parsea el JSON. Devuelve el objeto o None."""
    raw = _generate(prompt, system=system, max_tokens=max_tokens)
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
    except (json.JSONDecodeError, TypeError):
        pass
    # Último recurso: extraer el primer objeto JSON embebido en texto (modelos
    # razonadores a veces anteponen/agregan prosa pese a la instrucción).
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(raw[start:end + 1])
        except (json.JSONDecodeError, TypeError):
            pass
    logger.warning(f"OpenRouter devolvió JSON inválido; primeros 200 chars: {raw[:200]!r}")
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
    data = _generate_json(prompt, system=system, max_tokens=6000)
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        if data is not None:
            logger.warning(f"OpenRouter: JSON de categorización con forma inesperada: {str(data)[:200]!r}")
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
    data = _generate_json(prompt, system=system, max_tokens=4000)
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        if data is not None:
            logger.warning(f"OpenRouter: JSON de reescritura con forma inesperada: {str(data)[:200]!r}")
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


# ---------------------------------------------------------------------------
# D) Explicación de tendencias: por qué cada tema es tendencia hoy
# ---------------------------------------------------------------------------

def explain_trends(items):
    """
    Explica en 1-2 frases por qué cada tema es tendencia hoy en Perú, usando
    como evidencia los titulares recientes de Google News de cada uno.
    `items` = lista de dicts {keyword, headlines: [str, ...]}.
    Devuelve dict {keyword: explicacion} o None (rules-first).
    """
    if not is_enabled() or not items:
        return None

    payload = [{
        "i":         i,
        "tema":      it.get("keyword") or "",
        "titulares": [h for h in (it.get("headlines") or []) if h][:5],
    } for i, it in enumerate(items)]

    system = (
        "Eres un editor de actualidad de RPP Noticias (Perú). Explicas por qué "
        "un tema está entre lo más buscado en Google Perú HOY. La causa de una "
        "tendencia es casi siempre un HECHO NOTICIOSO reciente: tu explicación "
        "debe anclarse en la noticia MÁS RECIENTE y repetida entre los titulares "
        "dados como evidencia, no en contexto general ni en artículos viejos o "
        "de otro país que mencionen el término de pasada. Nunca inventes hechos "
        "que no estén en los titulares. Respondes exclusivamente en JSON, sin "
        "texto adicional ni markdown."
    )
    prompt = (
        "Para CADA tema escribe una explicación de 1 a 2 frases (máx ~220 "
        "caracteres) de POR QUÉ es tendencia de búsqueda hoy: el hecho concreto "
        "que la disparó (qué pasó, quién es, qué evento). Reglas:\n"
        "- Prioriza los titulares marcados [asociada por Google Trends] (son "
        "las noticias que Google vincula directamente a la tendencia) y los de "
        "fecha más reciente.\n"
        "- Si el tema es ambiguo (siglas, nombres cortos), acláralo primero "
        "(\"SGD es...\").\n"
        "- Si el término está en inglés y NO es un nombre propio (p.ej. "
        "'weather'), en Perú suele buscarse por un hecho local (friaje, "
        "lluvias, sismo, oleajes…): explica el hecho reciente en Perú que lo "
        "dispara según los titulares.\n"
        "- Si ningún titular muestra un hecho noticioso que explique la "
        "búsqueda, responde exactamente null en ese ítem — nunca rellenes con "
        "una definición del término ni con noticias sin relación.\n\n"
        f"Temas con sus titulares recientes (JSON):\n{json.dumps(payload, ensure_ascii=False)}\n\n"
        'Responde SOLO un JSON: {"items": [{"i": <indice>, "why": "<explicacion o null>"}]}'
    )
    data = _generate_json(prompt, system=system, max_tokens=4000)
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        if data is not None:
            logger.warning(f"OpenRouter: JSON de explicación de tendencias con forma inesperada: {str(data)[:200]!r}")
        return None

    out = {}
    for entry in data["items"]:
        try:
            idx = int(entry["i"])
        except (KeyError, ValueError, TypeError):
            continue
        if not (0 <= idx < len(items)):
            continue
        why = entry.get("why")
        if isinstance(why, str) and why.strip() and why.strip().lower() != "null":
            out[items[idx]["keyword"]] = why.strip()
    return out or None


# ---------------------------------------------------------------------------
# C) Cobertura: ¿RPP ya publicó lo que publicó la competencia?
# ---------------------------------------------------------------------------

def match_coverage(competitor_titles, own_titles):
    """
    Para cada titular de competencia, decide si alguno de los `own_titles`
    (notas recientes de RPP) cubre el MISMO hecho/tema, y cuál. Devuelve dict
    {indice_competencia: indice_rpp | -1} o None. -1 = RPP no lo cubre.
    """
    if not is_enabled() or not competitor_titles or not own_titles:
        return None

    comp_num = "\n".join(f"{i}. {t}" for i, t in enumerate(competitor_titles))
    own_num = "\n".join(f"{i}. {t}" for i, t in enumerate(own_titles))
    system = (
        "Eres un editor de RPP Noticias (Perú). Comparas titulares de otros "
        "medios contra los titulares ya publicados por RPP y determinas si RPP "
        "cubre el MISMO HECHO NOTICIOSO. Regla estricta: que compartan una "
        "persona, equipo o tema NO basta — debe ser el mismo evento concreto. "
        "Ejemplos de lo que NO es el mismo hecho: 'bebés llamados Haaland' vs "
        "'el pronóstico de Haaland'; 'precio del euro' vs 'precio del dólar'; "
        "'vacaciones escolares de julio' vs 'gratificación de julio'. En la duda, "
        "responde -1. Respondes exclusivamente en JSON, sin texto ni markdown."
    )
    prompt = (
        "TITULARES DE RPP (ya publicados):\n" + own_num + "\n\n"
        "TITULARES DE LA COMPETENCIA (¿RPP cubre el mismo hecho?):\n" + comp_num + "\n\n"
        "Para CADA titular de competencia indica el índice del titular de RPP "
        "que cubre EXACTAMENTE el mismo hecho, o -1 si RPP no lo ha cubierto.\n"
        'Responde SOLO un JSON: {"items": [{"i": <indice_competencia>, "rpp": <indice_rpp_o_-1>}]}'
    )
    data = _generate_json(prompt, system=system, max_tokens=4000)
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        if data is not None:
            logger.warning(f"OpenRouter: JSON de cobertura con forma inesperada: {str(data)[:200]!r}")
        return None

    out = {}
    for entry in data["items"]:
        try:
            ci = int(entry["i"])
            oi = int(entry["rpp"])
        except (KeyError, ValueError, TypeError):
            continue
        if 0 <= ci < len(competitor_titles):
            out[ci] = oi if (0 <= oi < len(own_titles)) else -1
    return out or None
