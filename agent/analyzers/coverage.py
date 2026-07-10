"""
Cobertura: ¿RPP ya publicó una nota sobre lo que publicó la competencia?

Compara los titulares de competencia contra los titulares recientes de rpp.pe
(collectors/rpp_own_feed) y marca, por artículo de competencia:
  rpp_has_coverage    bool
  rpp_matched_title   str | None
  rpp_matched_url     str | None

Rules-first: un matcher por solapamiento de tokens (ponderado por IDF sobre los
titulares de RPP, para que los nombres propios/temas raros pesen más que
"vivo", "hoy", "mundial") da la base sin costo ni red. Si hay proveedor LLM
activo, una pasada de IA lo REFINA (autoritativa) sobre lo que las reglas
marcaron dudoso. El dashboard muestra "✓ Publicado en RPP" / "⚠ Pendiente".
"""

import logging
import math
import re
import unicodedata

from config import RPP_COVERAGE_LLM_MAX
from llm import provider as llm

logger = logging.getLogger(__name__)

# Sufijos de marca que varios feeds añaden al título ("... - La República").
_MEDIA_SUFFIX = re.compile(r"\s*[-–|]\s*(la rep[uú]blica|infobae|per[uú]\s*21|gesti[oó]n|el comercio)\b.*$", re.I)

_STOPWORDS = {
    "para","por","con","los","las","del","que","una","uno","unos","unas","este",
    "esta","esto","como","mas","muy","sus","sobre","entre","hasta","desde","tras",
    "the","and","vivo","hoy","vivo:","directo","online","gratis","aqui","aca",
    "ver","donde","cuando","cual","segun","asi","ante","cada","todo","toda",
}


def _norm(text):
    """Minúsculas sin acentos, sin el sufijo de marca."""
    text = _MEDIA_SUFFIX.sub("", text or "")
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return text.lower()


def _tokens(text):
    """Tokens significativos: alfanuméricos de largo >= 4, sin stopwords."""
    return {t for t in re.findall(r"[a-z0-9]+", _norm(text))
            if len(t) >= 4 and t not in _STOPWORDS}


def _idf(own_token_sets):
    """Peso IDF por token sobre el corpus de titulares de RPP."""
    n = len(own_token_sets) or 1
    df = {}
    for toks in own_token_sets:
        for t in toks:
            df[t] = df.get(t, 0) + 1
    return {t: math.log((n + 1) / (c + 1)) + 1.0 for t, c in df.items()}


# Umbrales del matcher por reglas (calibrados con datos reales de 2026-07-10).
# score = suma de IDF de los tokens compartidos; se exige además >=2 tokens en
# común para evitar falsos positivos por un solo término genérico.
_MATCH_MIN_SHARED = 2
_MATCH_MIN_SCORE  = 2.5


def _rules_match(competitor_articles, own_articles):
    """
    Para cada artículo de competencia, mejor nota de RPP por solapamiento
    ponderado. Devuelve lista alineada: [(own_idx|None, score), ...].
    """
    own_tok = [_tokens(a["title"]) for a in own_articles]
    idf = _idf(own_tok)

    results = []
    for c in competitor_articles:
        ctok = _tokens(c.get("title", ""))
        best_idx, best_score, best_shared = None, 0.0, 0
        for i, otok in enumerate(own_tok):
            shared = ctok & otok
            if len(shared) < _MATCH_MIN_SHARED:
                continue
            score = sum(idf.get(t, 1.0) for t in shared)
            if score > best_score:
                best_idx, best_score, best_shared = i, score, len(shared)
        if best_idx is not None and best_score >= _MATCH_MIN_SCORE:
            results.append((best_idx, best_score))
        else:
            results.append((None, best_score))
    return results


def compute_coverage(competitor_articles, own_articles, use_llm=True):
    """
    MUTA cada artículo de competencia in-place agregando rpp_has_coverage /
    rpp_matched_title / rpp_matched_url. Devuelve cuántos quedaron marcados
    como cubiertos. Si no hay notas propias, marca todo como no-cubierto
    (no puede afirmar cobertura sin evidencia).
    """
    if not competitor_articles:
        return 0

    if not own_articles:
        for c in competitor_articles:
            c["rpp_has_coverage"] = False
            c["rpp_matched_title"] = None
            c["rpp_matched_url"] = None
        logger.info("Cobertura: sin feed propio de RPP; todo marcado como pendiente")
        return 0

    # 1) Base por reglas
    rules = _rules_match(competitor_articles, own_articles)
    for c, (idx, _score) in zip(competitor_articles, rules):
        if idx is not None:
            c["rpp_has_coverage"] = True
            c["rpp_matched_title"] = own_articles[idx]["title"]
            c["rpp_matched_url"] = own_articles[idx]["url"]
        else:
            c["rpp_has_coverage"] = False
            c["rpp_matched_title"] = None
            c["rpp_matched_url"] = None

    # 2) Refinamiento LLM (autoritativo) — el LLM entiende sinónimos/paráfrasis
    #    que las reglas no (p.ej. "precio del euro" != "precio del dólar"). Para
    #    no agotar la cuota free, solo se refinan los RPP_COVERAGE_LLM_MAX
    #    titulares MÁS RECIENTES; el resto conserva el match por reglas. Se
    #    mantiene el mapeo índice-local-LLM → índice-global para aplicar bien.
    if use_llm and competitor_articles:
        order = sorted(
            range(len(competitor_articles)),
            key=lambda i: competitor_articles[i].get("published_at") or "",
            reverse=True,
        )[:RPP_COVERAGE_LLM_MAX]
        own_titles = [a["title"] for a in own_articles]
        comp_titles = [competitor_articles[i].get("title", "") for i in order]
        llm_map = llm.match_coverage(comp_titles, own_titles)
        if llm_map is not None:
            for local_i, oi in llm_map.items():
                c = competitor_articles[order[local_i]]
                if 0 <= oi < len(own_articles):
                    c["rpp_has_coverage"] = True
                    c["rpp_matched_title"] = own_articles[oi]["title"]
                    c["rpp_matched_url"] = own_articles[oi]["url"]
                else:  # -1 = el LLM dice que RPP NO lo cubre
                    c["rpp_has_coverage"] = False
                    c["rpp_matched_title"] = None
                    c["rpp_matched_url"] = None

    return sum(1 for c in competitor_articles if c.get("rpp_has_coverage"))
