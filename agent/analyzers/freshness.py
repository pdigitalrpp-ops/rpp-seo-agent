"""
Vigencia de la demanda de una query de GSC — ¿todavía vale la pena accionar?

El problema que resuelve: GSC llega con ~1 día de rezago y agrega una ventana
de ~3 días, así que "quick wins" como «estadísticas de francia vs españa»
aparecen con millones de impresiones DESPUÉS de que el partido ya se jugó.
Optimizar esas notas no devuelve nada: la demanda murió.

Clasificación (rules-first + refinamiento LLM en el morning):
  - "hot":       evento futuro o tendencia activa hoy → accionar YA
  - "evergreen": demanda continua ("partidos de hoy", "precio del dólar") → accionar
  - "past":      el interés ya pasó → NO accionable (el dashboard lo oculta)
  - None:        sin señal suficiente (el dashboard lo trata como neutral)

El dashboard tiene una copia TS de las reglas (fallback client-side en
BusquedaClient.tsx para filas guardadas sin clasificar) — si cambian aquí,
actualizar allá.
"""

import logging
import re
import unicodedata

logger = logging.getLogger(__name__)

# Demanda continua: consultas que se repiten todos los días aunque cambie la
# actualidad. Sobre título/meta de estas notas sí rinde optimizar siempre.
EVERGREEN_PATTERNS = [
    r"\bhoy\b", r"\ben vivo\b", r"\bahora\b", r"\bultimas noticias\b",
    r"\bprecio\b", r"\bdolar\b", r"\beuro\b", r"\bgasolina\b",
    r"\bclima\b", r"\btemperatura\b", r"\bhoroscopo\b", r"\btemblor\b",
    r"\bsismo\b", r"\bresultados\b", r"\btabla de posiciones\b",
    r"\bcalendario\b", r"\bfixture\b", r"\bcuando juega\b",
    r"\bprogramacion\b", r"\brpp\b", r"\btipo de cambio\b", r"\bsorteo\b",
    r"\btinka\b", r"\bfarmacia\b", r"\bfase de grupos\b",
]

# Consulta atada a un evento puntual (partido, gala, sorteo específico): si no
# cruza con una tendencia activa, lo más probable es que el evento ya pasó.
EVENT_PATTERNS = [
    r"\bvs\.?\b", r"\bcontra\b", r"\balineaciones de\b", r"\bestadisticas de\b",
    r"\bcronologia de\b", r"\bdonde mirar\b", r"\ba que hora\b",
]

_evergreen_re = re.compile("|".join(EVERGREEN_PATTERNS))
_event_re = re.compile("|".join(EVENT_PATTERNS))


def _norm(text):
    """minúsculas sin tildes, para comparar contra patrones y tendencias."""
    nfkd = unicodedata.normalize("NFKD", (text or "").lower())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def _trend_tokens(trend_keywords):
    """Set de tokens distintivos (>3 chars) de las tendencias activas."""
    tokens = set()
    for kw in trend_keywords or []:
        for tok in _norm(kw).split():
            if len(tok) > 3:
                tokens.add(tok)
    return tokens


def classify_by_rules(query, trend_tokens):
    """Clasificación por reglas de UNA query. Devuelve 'hot'|'evergreen'|'past'|None."""
    q = _norm(query)
    q_tokens = [t for t in q.split() if len(t) > 3]
    # ≥2 tokens en común con una tendencia activa (o 1 si la query es corta)
    overlap = sum(1 for t in q_tokens if t in trend_tokens)
    if overlap >= 2 or (overlap >= 1 and len(q_tokens) <= 2):
        return "hot"
    if _evergreen_re.search(q):
        return "evergreen"
    if _event_re.search(q):
        return "past"
    return None


def classify_queries(gsc_rows, trend_keywords, llm_provider,
                     min_impressions=200, max_llm=120):
    """
    Clasifica la vigencia de las queries relevantes de un snapshot de GSC.
    Devuelve {query: 'hot'|'evergreen'|'past'} (queries sin señal no aparecen).

    Rules-first: las reglas dan un veredicto base para todas; el LLM (si hay
    proveedor con classify_query_freshness) refina las `max_llm` con más
    impresiones — su respuesta pisa a las reglas.
    """
    seen = {}
    for r in gsc_rows or []:
        q = r.get("query")
        if not q or (r.get("search_type") or "web") != "web":
            continue
        if (r.get("impressions") or 0) < min_impressions:
            continue
        seen[q] = max(seen.get(q, 0), r.get("impressions") or 0)
    if not seen:
        return {}

    tokens = _trend_tokens(trend_keywords)
    result = {}
    for q in seen:
        verdict = classify_by_rules(q, tokens)
        if verdict:
            result[q] = verdict

    top_queries = [q for q, _ in sorted(seen.items(), key=lambda kv: -kv[1])][:max_llm]
    fn = getattr(llm_provider, "classify_query_freshness", None)
    if fn:
        llm_result = fn(top_queries, trend_keywords or [])
        if llm_result:
            result.update(llm_result)
            logger.info(f"✅ LLM clasificó vigencia de {len(llm_result)}/{len(top_queries)} queries")

    counts = {}
    for v in result.values():
        counts[v] = counts.get(v, 0) + 1
    logger.info(f"Vigencia de queries: {counts} de {len(seen)} candidatas")
    return result
