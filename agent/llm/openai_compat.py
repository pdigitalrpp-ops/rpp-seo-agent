"""
Núcleo compartido de los proveedores con API compatible con OpenAI Chat
Completions: OpenAI (llm/openai_api.py) y OpenRouter (llm/openrouter.py).

POR QUÉ ESTE MÓDULO EXISTE
--------------------------
Los dos hablan EL MISMO protocolo (`POST {base}/chat/completions`, cuerpo
`{model, messages, temperature, max_tokens}`) y necesitan EXACTAMENTE los
mismos prompts: lo único que cambia entre ellos es la URL, la key, el modelo
y un par de campos extra del body.

Antes cada proveedor traía su copia de las tareas. Eso ya salió mal una vez:
`bedrock.py` y `gemini.py` se quedaron con 2 de las 5 tareas porque las 3
nuevas (vigencia, explicación de tendencias, cobertura) solo se escribieron en
`openrouter.py`. Con los prompts acá, añadir un proveedor OpenAI-compatible es
declarar un `Client` y ya — no puede volver a haber deriva.

Cada tarea recibe el `Client` como primer argumento y devuelve None si el
proveedor no está habilitado o la llamada falla: rules-first, el orquestador
cae a su comportamiento por reglas y no se rompe nada.
"""

import json
import logging
import time

import requests

logger = logging.getLogger(__name__)


class Client:
    """
    Cliente de una API OpenAI-compatible.

    `extra_body` son los campos propios del proveedor (p.ej. el `reasoning` de
    OpenRouter, que OpenAI NO acepta y devolvería 400). `json_mode` activa
    `response_format: {"type": "json_object"}` en las llamadas que esperan
    JSON — OpenAI lo soporta y ahorra los casos de "el modelo devolvió prosa";
    OpenRouter no lo garantiza para todo su catálogo, así que ahí va apagado.
    """

    def __init__(self, label, base_url, api_key, model, timeout,
                 extra_body=None, extra_headers=None, json_mode=False,
                 max_tokens_field="max_tokens", send_temperature=True,
                 max_tokens_scale=1.0):
        self.label = label
        self.base_url = base_url
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.extra_body = extra_body or {}
        self.extra_headers = extra_headers or {}
        self.json_mode = json_mode
        # Multiplicador del presupuesto de tokens. Existe para los modelos de
        # razonamiento: sus tokens de "pensar" salen del MISMO presupuesto que
        # la respuesta, así que con el tope calibrado para un modelo normal se
        # quedan pensando y devuelven content vacío (finish_reason="length").
        # Subir el tope NO encarece nada por sí solo — se factura lo generado,
        # no lo reservado; lo que evita es perder el lote entero.
        self.max_tokens_scale = max_tokens_scale
        # Arrancan según el modelo declarado y, si aun así el proveedor
        # responde 400, se corrigen solos (ver _adapt_to_400).
        self._max_tokens_field = max_tokens_field
        self._send_temperature = send_temperature

    def is_enabled(self):
        return bool(self.api_key)

    # -- transporte --------------------------------------------------------

    def _post(self, body):
        """POST crudo. Devuelve (resp|None, error_str|None). Nunca lanza."""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type":  "application/json",
        }
        headers.update(self.extra_headers)
        try:
            resp = requests.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=body,
                timeout=self.timeout,
            )
            return resp, None
        except Exception as e:
            return None, str(e)

    def _build_body(self, messages, max_tokens, want_json):
        body = {"model": self.model, "messages": messages}
        body[self._max_tokens_field] = int(max_tokens * self.max_tokens_scale)
        if self._send_temperature:
            body["temperature"] = 0.4
        if want_json and self.json_mode:
            body["response_format"] = {"type": "json_object"}
        body.update(self.extra_body)
        return body

    def _adapt_to_400(self, text):
        """
        Los modelos de razonamiento de OpenAI rechazan `max_tokens` (piden
        `max_completion_tokens`) y `temperature` distinta de 1. En vez de
        fallar en silencio —que en este proyecto significa que TODA la
        categorización queda en null y nadie se entera hasta el día
        siguiente— se detecta el 400, se corrige el body y se reintenta UNA
        vez. El ajuste queda pegado al cliente, así que solo se paga en la
        primera llamada de la corrida.

        Devuelve True si cambió algo y vale la pena reintentar.
        """
        low = (text or "").lower()
        if "max_completion_tokens" in low and self._max_tokens_field == "max_tokens":
            self._max_tokens_field = "max_completion_tokens"
            logger.info(
                f"{self.label}: el modelo '{self.model}' pide max_completion_tokens; "
                "ajustado para el resto de la corrida"
            )
            return True
        if "temperature" in low and self._send_temperature:
            self._send_temperature = False
            logger.info(
                f"{self.label}: el modelo '{self.model}' no acepta temperature "
                "personalizada; se omite el resto de la corrida"
            )
            return True
        return False

    def generate(self, prompt, system=None, max_tokens=4000, retries=1, want_json=False):
        """
        Devuelve el texto de la respuesta (str) o None si falla — nunca lanza,
        para no bloquear al orquestador.

        Un `content` vacío con `finish_reason="length"` significa que el modelo
        agotó el presupuesto ANTES de escribir la respuesta (los razonadores
        gastan `max_tokens` pensando). Nunca se usa el campo `reasoning` como
        respuesta: es el monólogo interno truncado, no la salida pedida.
        """
        if not self.is_enabled():
            return None

        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        last_err = None
        attempt = 0
        adapted = False
        while attempt <= retries:
            resp, err = self._post(self._build_body(messages, max_tokens, want_json))
            if resp is None:
                last_err = err
                attempt += 1
                if attempt <= retries:
                    time.sleep(2)
                continue

            if resp.ok:
                try:
                    data = resp.json()
                    choice = data["choices"][0]
                    content = (choice["message"].get("content") or "").strip()
                except (ValueError, KeyError, IndexError, TypeError) as e:
                    logger.warning(f"{self.label}: respuesta inesperada ({e}); se usa el fallback por reglas")
                    return None
                if not content:
                    finish = choice.get("finish_reason")
                    hint = (
                        " — se agotó el presupuesto de tokens pensando, sin llegar a "
                        "responder (subir max_tokens o bajar el tamaño del lote)"
                        if finish == "length" else ""
                    )
                    logger.warning(
                        f"{self.label} respondió 200 pero sin content "
                        f"(finish_reason={finish}){hint}; se usa el fallback por reglas"
                    )
                    return None
                return content

            last_err = f"{resp.status_code}: {resp.text[:2000]}"
            # 400 por parámetro no soportado: corregir y reintentar sin gastar
            # uno de los reintentos normales (solo una vez).
            if resp.status_code == 400 and not adapted and self._adapt_to_400(resp.text):
                adapted = True
                continue
            if resp.status_code == 429 and attempt < retries:
                time.sleep(10 * (attempt + 1))
                attempt += 1
                continue
            logger.warning(f"{self.label} {resp.status_code}: {resp.text[:2000]}")
            return None

        logger.warning(f"{self.label} no respondió ({last_err}); se usa el fallback por reglas")
        return None

    def generate_json(self, prompt, system=None, max_tokens=2000):
        """Como generate() pero parsea el JSON. Devuelve el objeto o None."""
        raw = self.generate(prompt, system=system, max_tokens=max_tokens, want_json=True)
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
        # Último recurso: extraer el primer objeto JSON embebido en texto
        # (modelos razonadores a veces anteponen/agregan prosa pese a la
        # instrucción).
        start, end = raw.find("{"), raw.rfind("}")
        if start != -1 and end > start:
            try:
                return json.loads(raw[start:end + 1])
            except (json.JSONDecodeError, TypeError):
                pass
        logger.warning(f"{self.label} devolvió JSON inválido; primeros 200 chars: {raw[:200]!r}")
        return None


# ===========================================================================
# TAREAS. Prompts compartidos por todos los proveedores OpenAI-compatibles.
# Movidos VERBATIM desde openrouter.py (donde estaban calibrados contra
# produccion): si se tocan, se tocan para los dos proveedores a la vez.
# ===========================================================================
# ---------------------------------------------------------------------------
# A) Categorización de temas del radar
# ---------------------------------------------------------------------------

def categorize_topics(client, keywords, categories):
    """
    Clasifica una lista de keywords en una de las `categories`, en UNA sola
    llamada. Devuelve dict {keyword: categoria} o None si el LLM no está.
    """
    if not client.is_enabled() or not keywords:
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
    data = client.generate_json(prompt, system=system, max_tokens=6000)
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        if data is not None:
            logger.warning(f"{client.label}: JSON de categorización con forma inesperada: {str(data)[:200]!r}")
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

def rewrite_onpage_batch(client, items, title_max=60, meta_min=120, meta_max=160):
    """
    Reescribe VARIAS notas en UNA sola llamada. `items` = lista de dicts con
    keys {title, meta_description, keyword, issues, first_paragraph}.
    Devuelve una lista alineada por índice: [suggestion|None, ...] o None global.
    """
    if not client.is_enabled() or not items:
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
    data = client.generate_json(prompt, system=system, max_tokens=4000)
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        if data is not None:
            logger.warning(f"{client.label}: JSON de reescritura con forma inesperada: {str(data)[:200]!r}")
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
# E) Vigencia de queries de GSC: ¿la demanda sigue viva?
# ---------------------------------------------------------------------------

def classify_query_freshness(client, queries, trend_keywords):
    """
    Clasifica queries de Search Console según si su demanda sigue viva HOY:
    "hot" (evento futuro/tendencia activa), "evergreen" (demanda continua) o
    "past" (el evento ya ocurrió, el interés murió). Devuelve dict
    {query: clasificacion} o None (rules-first).
    """
    if not client.is_enabled() or not queries:
        return None

    from datetime import date
    numbered = "\n".join(f"{i}. {q}" for i, q in enumerate(queries))
    trends_txt = ", ".join(trend_keywords[:20]) if trend_keywords else "(sin datos)"
    system = (
        "Eres un editor SEO de RPP Noticias (Perú). Decides si la demanda de "
        "una búsqueda de Google sigue viva HOY, para saber si aún vale la pena "
        "optimizar la nota que posiciona por ella. Las búsquedas atadas a un "
        "evento que YA OCURRIÓ (un partido jugado, una gala pasada) están "
        "muertas aunque ayer tuvieran millones de impresiones. Respondes "
        "exclusivamente en JSON, sin texto adicional ni markdown."
    )
    prompt = (
        f"HOY es {date.today().isoformat()}. Tendencias activas en Perú ahora: "
        f"{trends_txt}.\n\n"
        "Clasifica CADA búsqueda en exactamente una de:\n"
        '- "hot": atada a un evento FUTURO o a una tendencia activa hoy '
        "(p.ej. la final que aún no se juega).\n"
        '- "evergreen": demanda continua que no depende de un evento '
        "(\"partidos de hoy\", \"precio del dólar\", \"rpp en vivo\").\n"
        '- "past": atada a un evento que YA ocurrió (un partido ya jugado, '
        "sus alineaciones, estadísticas o dónde verlo).\n"
        "En la duda entre hot y past, usa las tendencias activas y la fecha "
        "de hoy como árbitro.\n\n"
        f"Búsquedas:\n{numbered}\n\n"
        'Responde SOLO un JSON: {"items": [{"i": <indice>, "estado": "hot|evergreen|past"}]}'
    )
    data = client.generate_json(prompt, system=system, max_tokens=5000)
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        if data is not None:
            logger.warning(f"{client.label}: JSON de vigencia con forma inesperada: {str(data)[:200]!r}")
        return None

    valid = {"hot", "evergreen", "past"}
    out = {}
    for entry in data["items"]:
        try:
            idx = int(entry["i"])
            estado = str(entry["estado"]).lower().strip()
        except (KeyError, ValueError, TypeError):
            continue
        if 0 <= idx < len(queries) and estado in valid:
            out[queries[idx]] = estado
    return out or None


# ---------------------------------------------------------------------------
# D) Explicación de tendencias: por qué cada tema es tendencia hoy
# ---------------------------------------------------------------------------

def explain_trends(client, items):
    """
    Explica en 1-2 frases por qué cada tema es tendencia hoy en Perú, usando
    como evidencia los titulares recientes de Google News de cada uno.
    `items` = lista de dicts {keyword, headlines: [str, ...]}.
    Devuelve dict {keyword: explicacion} o None (rules-first).
    """
    if not client.is_enabled() or not items:
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
    data = client.generate_json(prompt, system=system, max_tokens=4000)
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        if data is not None:
            logger.warning(f"{client.label}: JSON de explicación de tendencias con forma inesperada: {str(data)[:200]!r}")
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

def match_coverage(client, competitor_titles, own_titles):
    """
    Para cada titular de competencia, decide si alguno de los `own_titles`
    (notas recientes de RPP) cubre el MISMO hecho/tema, y cuál. Devuelve dict
    {indice_competencia: indice_rpp | -1} o None. -1 = RPP no lo cubre.
    """
    if not client.is_enabled() or not competitor_titles or not own_titles:
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
    data = client.generate_json(prompt, system=system, max_tokens=4000)
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        if data is not None:
            logger.warning(f"{client.label}: JSON de cobertura con forma inesperada: {str(data)[:200]!r}")
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
