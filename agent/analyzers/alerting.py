"""
analyzers/alerting.py — decide qué temas del radar ameritan una ALERTA.

Separado a propósito del score de recomendación (analyzers/scoring.py): una
recomendación responde "¿vale la pena escribir sobre esto?"; una alerta
responde "¿hay una noticia rompiendo AHORA que la sección debería cubrir ya?".
Son preguntas distintas y antes compartían el mismo score 0-100 con umbral 75,
lo que hacía que la alerta SOLO disparara para eventos deportivos grandes
(única forma de cruzar 75 en el score de recomendación, dominado por el
tráfico de Google Trends) y nunca para sismos, muertes o renuncias de alto
interés — el score de recomendación de esos temas se ahogaba porque el
`approx_traffic` de Trends casi siempre viene en 1.5/10.

Usa la evidencia que el radar ya recolecta por cada tendencia:

- **Términos de urgencia** (uno de los dos drivers): muerte, sismo, renuncia,
  captura… Es lo que distingue "está rompiendo" de "hay mucha demanda".
- **Volumen relativo al día** (el otro driver): cuántas veces la mediana del
  día se busca el tema. Deja entrar el evento programado que de verdad es
  grande, y deja fuera el partido de trámite.
- **Evidencia de noticias** (necesaria, no suficiente): nº de fuentes distintas
  y su frescura. Sin cobertura no hay alerta, pero tenerla no basta: el radar
  garantiza noticias para todas las tendencias, así que no discrimina.
- **why_trending**: si el LLM no pudo anclar el tema a un hecho noticioso
  (null), casi nunca es un evento alertable ("te", "23 de julio feriado",
  queries genéricas) → penalización fuerte.
- **Prominencia en Trends**: el RANK del feed de Perú (1 = lo más buscado).

Además CONSOLIDA tendencias del mismo evento que comparten URLs de noticias:
"temblor hoy" + "ultimo sismo en peru" + "igp ultimo sismo" + "indeci" son un
SOLO sismo. Antes se puntuaban por separado y ninguna cruzaba el umbral; ahora
se funden en una alerta con la evidencia sumada.

Rules-first: no hace llamadas LLM propias — reutiliza el why_trending y las
noticias que run_radar ya generó. Si esa evidencia falta, el tema simplemente
no alerta.
"""

import logging
import math
import re
from datetime import datetime, timezone
from urllib.parse import urlparse

from analyzers import scoring, evidence
from text_keys import normalize_text
from config import (
    ALERT_WORTHINESS_THRESHOLD, ALERT_SEVERITY_HIGH,
    PERU_SPORT_KEYWORD_ONLY, PERU_SPORT_ENTITIES,
)

logger = logging.getLogger(__name__)

# Pesos de la "alertabilidad" 0-100 (suman 100 antes del multiplicador de
# why_trending). Dos señales deciden —el hecho rompiendo y el volumen relativo
# al día—; la evidencia de noticias y el rank son condición NECESARIA pero ya
# no alcanzan solas para cruzar el umbral.
#
# RECALIBRADO 2026-08-22 (antes: 40/15/30/15, con la evidencia como driver). Medido sobre 30 tendencias reales, la versión
# anterior alertaba el 50% de todo lo que veía, y 23 de las 31 alertas de un
# día eran deportes. Causa: `noticias` (40) y `rank` (15) están saturadas por
# construcción — el radar garantiza 5 noticias por tendencia y solo trae el
# top 10 —, así que repartían ~45 puntos a TODOS con el umbral en 55. Con solo
# 10 puntos de margen real, la alerta la decidía un binario de 30.
# Ahora la evidencia baja de peso (es NECESARIA, no suficiente) y los 65 puntos
# que deciden son los dos que de verdad varían: el hecho rompiendo y el volumen
# relativo al día.
W_NEWS     = 25   # nº de fuentes distintas × frescura — evidencia, no urgencia
W_RANK     = 10   # posición en el feed de Google Trends Perú
W_URGENCY  = 35   # términos de "hecho rompiendo" en keyword/noticias/why
W_VOLUME   = 30   # cuánto SOBRESALE su volumen respecto a la mediana del día

# Términos que marcan un hecho noticioso rompiendo (no una demanda evergreen).
# Se buscan sobre keyword + why_trending + titulares de noticias, en minúsculas
# sin distinguir tilde parcial (se incluyen variantes sin tilde).
URGENCY_TERMS = [
    "muere", "muerte", "fallece", "falleci", "murio", "murió", "luto",
    "sismo", "temblor", "terremoto", "huaico", "aluvion", "aluvión", "incendio",
    "emergencia", "tragedia", "accidente", "explosion", "explosión",
    "renuncia", "destituy", "vacancia", "captura", "detien", "allanamiento",
    "campeon", "campeón", "eliminado", "paro", "huelga", "golpe de estado",
]
# "golpe" a secas se cambió por "golpe de estado" (2026-08-22): estaba puesto
# para el golpe de Estado, pero como palabra suelta es vocabulario futbolístico
# corriente ("golpe de cabeza", "duro golpe para el equipo").

# RETIRADAS de URGENCY_TERMS el 2026-08-22, y por qué. Eran vocabulario RUTINARIO
# de la cobertura futbolística, no señal de que algo esté rompiendo: cualquier
# partido genera notas de "resultados EN VIVO" y "tabla de posiciones". Medido
# sobre 30 tendencias reales, disparaban 10 de los 14 aciertos de urgencia
# ('resultado' 5 veces, 'en vivo' 3, 'en directo' 2, 'confirma' 2), y por eso
# 23 de las 31 alertas de un día eran deportes. La lista existe para que
# disparen sismos, muertes y renuncias — estaba haciendo lo contrario.
# Se dejan anotadas para que nadie las reponga sin medirlo antes.
URGENCY_TERMS_RETIRADOS = [
    "gana", "ganó", "gano", "clasific", "resultado", "en vivo", "en directo",
    "minuto a minuto", "oficial", "confirma", "anuncia", "declara", "alerta",
]


def _normaliza(texto):
    """Minusculas, sin tildes, sin puntuacion. Reusa la del dedup de titulares."""
    return normalize_text(texto)


def _terms_re(terms):
    """
    Regex que busca los términos como PALABRAS completas. `\b` no sirve con
    tildes en los limites, asi que la comparacion se hace sobre texto YA
    normalizado (sin tildes ni puntuacion) — quien busca debe normalizar antes.
    """
    return re.compile(
        r"(?:^|\s)(?:" + "|".join(
            re.escape(normalize_text(t)).replace(r"\ ", r"\s+") for t in terms
        ) + r")(?:\s|$)")


_URGENCY_RE = _terms_re(URGENCY_TERMS)
_PE_KEYWORD_RE = _terms_re(PERU_SPORT_KEYWORD_ONLY)
_PE_ENTITY_RE = _terms_re(PERU_SPORT_ENTITIES)


def _domain(url):
    try:
        host = urlparse(url or "").netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except (ValueError, AttributeError):
        return ""


def _news_strength(news, now):
    """
    0-1 según cuántas FUENTES PERUANAS distintas cubren el tema y qué tan
    frescas están. Satura en 2 fuentes frescas.

    PONDERADO POR ORIGEN desde el 2026-08-22, tras medir un día completo: el
    panel seguía sacando ~40 alertas diarias y **31 de 40 eran deportes**, casi
    todas fútbol europeo (Hull City-Manchester United, Wehen Wiesbaden-
    Leverkusen, Everton-Crystal Palace...). Son tendencias reales con volumen
    real, pero NO son "eventos grandes" para una audiencia peruana — y contar
    cualquier fuente las hacía indistinguibles de un Alianza Atlético-Sporting
    Cristal. La señal que sí los separa ya existía en el proyecto
    (`analyzers/evidence.is_peruvian_source`, por dominio) y alerting no la
    usaba.

    Saturaba en 3 cuando era el driver principal (peso 40). Bajado a 2 el
    2026-08-22 junto con el peso (25) por un caso concreto: una renuncia
    ministerial cubierta por UN medio en los primeros minutos daba 0.33 y no
    alertaba. Para un hecho rompiendo, esperar a que lo publiquen tres medios
    es llegar tarde — que es justo lo contrario de para qué existe esta etapa.
    """
    if not news:
        return 0.0
    peruanas, extranjeras = {}, {}
    for n in news:
        src = (n.get("source") or _domain(n.get("source_url") or n.get("url")) or "").lower().strip()
        if not src:
            continue
        w = evidence.recency_weight(n.get("published_at"), now)
        destino = peruanas if evidence.is_peruvian_source(n) else extranjeras
        destino[src] = max(destino.get(src, 0.0), w)

    fuerza_pe = min(sum(peruanas.values()) / 2.0, 1.0)
    if fuerza_pe > 0:
        return fuerza_pe
    # Sin NINGUN medio peruano la evidencia vale poco, pero no cero: un hecho
    # global que acaba de romper puede tener solo teletipos extranjeros en sus
    # primeros minutos, y esa es justo la alerta que no se quiere perder. Con
    # 0.3 de techo, un tema sin cobertura peruana solo alerta si ADEMAS trae
    # termino de urgencia — nunca por volumen solo.
    return min(min(sum(extranjeras.values()) / 2.0, 1.0), 0.3)


def _rank_strength(rank):
    """
    Prominencia por posición en el feed de Trends (1 = lo más buscado).

    REESCALADO 2026-08-22 al rango que de verdad llega: el radar pide el top 10,
    así que los tramos viejos (<=5 -> 1.0, <=10 -> 0.7, <=15 -> 0.4) dejaban a
    TODOS los candidatos entre 0.7 y 1.0 — media 0.85 sobre 30 tendencias. Una
    dimensión que le da casi lo mismo a todos no ordena nada.
    """
    if not rank or rank <= 0:
        return 0.3
    if rank <= 2:
        return 1.0
    if rank <= 5:
        return 0.6
    if rank <= 10:
        return 0.3
    return 0.1


def volume_reference(trends):
    """
    Mediana de `approx_traffic` del día, para medir cuánto sobresale un tema.
    None si ninguna tendencia trae volumen (filas anteriores a la migración del
    2026-08-21) — en ese caso se cae al comportamiento anterior.
    """
    vols = sorted(v for v in ((t.get("approx_traffic") or 0) for t in (trends or [])) if v > 0)
    return vols[len(vols) // 2] if vols else None


def _volume_strength(approx_traffic, mediana):
    """
    0-1 según cuántas VECES la mediana del día se busca este tema.

    Reemplaza al viejo `momentum`, que era `growth_score` — el 0-10 comprimido
    donde 100 y 900 búsquedas caen ambas en 1.5. Medido: media 0.20 y CERO
    tendencias en el máximo, o sea 15 puntos que le daban ~3 a todos.
    El volumen real sí varía (100 a 5.000 en un mismo día, factor 50).

    Escala logarítmica porque Google publica el volumen en escalones que
    también lo son (100, 200, 500, 1.000, 2.000, 5.000…): x1 la mediana = 0,
    x2 = 0.5, x4 o más = 1.0. Saturar en x4 y no en x8 sale de calibrar: x4 son
    DOS escalones completos por encima de lo normal del día (500 -> 2.000), que
    ya es un pico de verdad; exigir x8 dejaba el techo tan bajo que ni el tema
    más buscado del día llegaba al umbral.
    """
    if not mediana or not approx_traffic:
        return 0.0
    veces = approx_traffic / float(mediana)
    if veces <= 1.0:
        return 0.0
    return min(math.log(veces, 2) / 2.0, 1.0)


def _urgency_strength(text):
    """
    ¿Hay un hecho rompiendo? Se busca por PALABRA, no por subcadena.

    Con `term in text` los terminos cortos entraban donde no debian y en
    cobertura futbolistica eso es constante: "paro" esta dentro de *disparo*,
    *reparo* y *amparo*; "golpe" dentro de *golpeo*. Medido el 2026-08-22, por
    ahi se colaba un Ipswich-Sunderland como severidad ALTA. Es el mismo error
    de subcadena que ya habia aparecido con los medios peruanos ("depor" dentro
    de "Deportes") y con las keywords de la auditoria.
    """
    if not text:
        return 0.0
    # Normalizar AQUI y no confiar en quien llama: hasta el 2026-09-23 se le
    # pasaba el texto solo en minusculas, y el regex (armado con los terminos
    # normalizados) no veia "murió", "campeón" ni "explosión" con tilde, ni un
    # termino pegado a un signo ("temblor," / "sismo:"). La lista traia las dos
    # variantes de tilde justamente para esto, y solo funcionaba la mitad.
    return 1.0 if _URGENCY_RE.search(normalize_text(text)) else 0.0


def _urgency_text(event):
    """Texto donde se busca el hecho rompiendo: keyword + why + titulares."""
    return " ".join([
        event.get("keyword") or "",
        event.get("why_trending") or "",
        " ".join(n.get("title") or "" for n in (event.get("news") or [])),
    ])


def peruvian_sport_link(event):
    """
    ¿Una tendencia DEPORTIVA involucra a Perú (selección, Liga 1, un club o
    jugador peruano)? Decisión editorial del 2026-09-23: el deporte extranjero
    sin vínculo peruano no alerta salvo que traiga un hecho rompiendo — un
    Alianza-Universitario sí, un Inter-Udinese no. El volumen no bastaba para
    separarlos (ver PERU_SPORT_ENTITIES en config.py).

    Los términos de SOLO KEYWORD no se buscan en los titulares: "perú" aparece
    en todo "horario en Perú y dónde ver", y "clausura"/"apertura" también son
    los torneos de Argentina y México.
    """
    keywords = normalize_text(" ".join(event.get("keywords") or [event.get("keyword") or ""]))
    titulares = normalize_text(" ".join(n.get("title") or "" for n in (event.get("news") or [])))
    return bool(_PE_KEYWORD_RE.search(keywords)
                or _PE_ENTITY_RE.search(keywords + " " + titulares))


def _news_key_urls(item):
    """
    URLs de ARTÍCULO del tema, para detectar eventos compartidos. Solo se usa
    n["url"] (URL única por artículo), NO source_url: en los ítems que llegan
    vía Google News, source_url es el DOMINIO pelado (p.ej. "https://
    www.infobae.com", "https://elcomercio.pe") y lo comparten temas sin
    relación — agrupar por él fusionaba "renuncia" + "ignacio buse" + "feriado"
    en un solo cluster (bug real detectado en calibración 2026-07-22).
    """
    return {(n.get("url") or "").strip() for n in (item.get("news") or []) if n.get("url")}


def cluster_events(items):
    """
    Agrupa tendencias que son el MISMO evento porque comparten ≥1 URL de
    noticia (p.ej. el sismo aparece como 'temblor hoy', 'igp ultimo sismo',
    'indeci'…). Devuelve una lista de clusters (cada uno = lista de items).
    Greedy: suficiente para ~10-20 tendencias por corrida.
    """
    clusters = []          # lista de {"items": [...], "urls": set()}
    for item in items:
        urls = _news_key_urls(item)
        placed = None
        if urls:
            for c in clusters:
                if urls & c["urls"]:
                    placed = c
                    break
        if placed:
            placed["items"].append(item)
            placed["urls"] |= urls
        else:
            clusters.append({"items": [item], "urls": set(urls)})
    return [c["items"] for c in clusters]


def _merge_cluster(cluster_items):
    """Funde un cluster en un solo 'evento' con la evidencia combinada."""
    # Representante: mejor rank (menor), desempata por mayor growth_score.
    rep = min(cluster_items, key=lambda it: (it.get("rank", 99), -(it.get("growth_score") or 0)))
    merged_news, seen = [], set()
    for it in cluster_items:
        for n in it.get("news") or []:
            key = (n.get("title") or "").lower().strip()
            if key and key not in seen:
                seen.add(key)
                merged_news.append(n)
    return {
        "keyword":      rep["keyword"],
        "category":     rep.get("category", "otros"),
        "rank":         min((it.get("rank", 99) for it in cluster_items), default=99),
        "growth_score": max((it.get("growth_score") or 0 for it in cluster_items), default=0),
        # El volumen del evento es el del tema MAS buscado del cluster: si un
        # sismo aparece como 'temblor hoy' y 'igp', el evento vale lo que la
        # suma de atencion que despierta, no lo que valga su fragmento menor.
        "approx_traffic": max((it.get("approx_traffic") or 0 for it in cluster_items), default=0),
        "own_momentum": max((it.get("own_momentum") or 0.0 for it in cluster_items), default=0.0),
        "why_trending": next((it.get("why_trending") for it in cluster_items if it.get("why_trending")), None),
        "news":         merged_news[:8],
        "keywords":     [it["keyword"] for it in cluster_items],
    }


def alert_worthiness(event, now, volumen_mediana=None):
    """
    Alertabilidad 0-100 de un evento ya consolidado.

    Dos caminos para alertar, que es la decision editorial tomada el
    2026-08-22 ("rompiendo + eventos grandes con volumen real"):
      - un HECHO ROMPIENDO (sismo, muerte, renuncia...) -> W_URGENCY;
      - un evento programado que DESPIERTA MUCHA MAS BUSQUEDA de lo normal
        (un Alianza Atletico-Sporting Cristal, no un Queretaro-Toluca)
        -> W_VOLUME.
    La evidencia de noticias y el rank siguen contando, pero ya no alcanzan
    solos para cruzar el umbral: son condicion necesaria, no suficiente.
    """
    news_n = _news_strength(event.get("news"), now)
    rank_n = _rank_strength(event.get("rank"))
    urgency_n = _urgency_strength(_urgency_text(event))

    if volumen_mediana:
        volume_n = _volume_strength(event.get("approx_traffic"), volumen_mediana)
    else:
        # Sin volumen en la base (filas previas a la migracion) se cae al
        # comportamiento anterior en vez de regalar 0: rules-first.
        volume_n = max(
            scoring._norm_growth(event.get("growth_score", 0)),
            min(max(event.get("own_momentum", 0.0), 0.0), 1.0),
        )

    total = (W_NEWS * news_n + W_RANK * rank_n
             + W_URGENCY * urgency_n + W_VOLUME * volume_n)

    # Sin hecho noticioso claro (why_trending null) casi nunca es alertable:
    # penaliza fuerte para dejar fuera queries genéricas/evergreen.
    if not event.get("why_trending"):
        total *= 0.5

    return round(min(total, 100.0), 1)


# Palabras que no identifican un evento: unen titulares que no tienen relacion.
_TOKENS_VACIOS = {
    "vs", "contra", "hoy", "ayer", "del", "los", "las", "por", "con", "para",
    "posiciones", "tabla", "resultado", "resultados", "partido", "fecha",
    "que", "una", "uno", "sus", "the", "and",
}


def event_tokens(title):
    """Palabras significativas de un titulo, en minusculas y sin tildes."""
    txt = (title or "").lower()
    for a, b in (("á","a"),("é","e"),("í","i"),("ó","o"),("ú","u"),("ñ","n")):
        txt = txt.replace(a, b)
    return {w for w in re.findall(r"[a-z0-9]+", txt)
            if len(w) > 3 and w not in _TOKENS_VACIOS}


def same_event(titulo_a, titulo_b):
    """
    ¿Dos alertas son el MISMO evento aunque el titulo cambie entre corridas?

    `cluster_events` ya funde fragmentos DENTRO de una corrida por URL de
    noticia compartida, pero entre corridas solo se comparaba el titulo exacto
    — y Google Trends renombra el mismo evento cada pocas horas. El 2026-08-21
    eso produjo TRES alertas del mismo partido ("alianza atletico - sporting
    cristal", "posiciones de alianza atletico contra sporting cristal",
    "posiciones de sporting cristal") y DOS de otro ("tigres - atlante",
    "tigres vs").

    Se consideran el mismo evento si comparten >=2 palabras significativas, o
    si las de uno estan contenidas en las del otro y comparten una palabra
    larga (el caso "tigres vs" dentro de "tigres - atlante").
    """
    # Igualdad literal PRIMERO. Sin esto, dos alertas con el MISMO titulo corto
    # no se reconocian: `event_tokens("kick")` = {"kick"}, un solo token de 4
    # letras, y la regla de subconjunto exige uno de >=5. Resultado medido el
    # 2026-08-22: "kick" alerto a las 00:06 y otra vez a las 00:16, y "la liga"
    # dos veces la misma manana. Era una REGRESION respecto al dedup viejo por
    # titulo exacto, que esto justamente venia a mejorar.
    na, nb = _normaliza(titulo_a), _normaliza(titulo_b)
    if na and na == nb:
        return True

    a, b = event_tokens(titulo_a), event_tokens(titulo_b)
    if not a or not b:
        return False
    comunes = a & b
    if len(comunes) >= 2:
        return True
    return (a <= b or b <= a) and any(len(w) >= 5 for w in comunes)


def build_alerts(enriched_trends, sections=None, now=None):
    """
    Etapa 3 — convierte las tendencias enriquecidas (con news + why_trending +
    rank + category, tal como las deja run_radar) en alertas.

    Consolida eventos fragmentados, puntúa la alertabilidad y devuelve los
    eventos que superan ALERT_WORTHINESS_THRESHOLD como dicts de alerta listos
    para save_alerts / notify.dispatch_alert.
    """
    if not enriched_trends:
        return []
    now = now or datetime.now(timezone.utc)
    # Referencia del dia: contra que se compara "mucho volumen". Se calcula
    # sobre las tendencias de ESTA corrida, que son el top del dia.
    mediana = volume_reference(enriched_trends)

    alerts = []
    for cluster in cluster_events(enriched_trends):
        event = _merge_cluster(cluster)
        worth = alert_worthiness(event, now, volumen_mediana=mediana)
        if worth < ALERT_WORTHINESS_THRESHOLD:
            continue
        # Deporte extranjero sin hecho rompiendo: no alerta aunque cruce el
        # umbral (ver peruvian_sport_link). Va DESPUES del score a proposito:
        # el umbral decide si el tema importa, esto decide si importa en Peru.
        if (event.get("category") == "deportes"
                and not _urgency_strength(_urgency_text(event))
                and not peruvian_sport_link(event)):
            logger.info(f"Sin vínculo peruano: '{event['keyword']}' ({worth}) no alerta")
            continue

        news = event.get("news") or []
        n_sources = len({(n.get("source") or _domain(n.get("source_url") or n.get("url")) or "").lower()
                         for n in news if (n.get("source") or n.get("url"))})
        description = event.get("why_trending") or (
            f"Tendencia rompiendo: {n_sources} medio(s) ya lo cubren." if n_sources
            else "Tema en fuerte tendencia de búsqueda ahora."
        )
        alerts.append({
            "type":     "trending_topic",
            "severity": "high" if worth >= ALERT_SEVERITY_HIGH else "medium",
            "section":  scoring.assign_section(event.get("category"), sections),
            "title":    event["keyword"],
            "description": description,
            "url":      (news[0].get("url") if news else None),
            "score":    worth,
            # metadatos para dedup/log (no se guardan en la tabla)
            "_keywords": event.get("keywords"),
            "_n_sources": n_sources,
        })

    return sorted(alerts, key=lambda a: a["score"], reverse=True)
