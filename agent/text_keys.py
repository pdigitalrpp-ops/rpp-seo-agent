"""
Claves de deduplicación por CONTENIDO — fuente única en Python.

POR QUÉ EXISTE
--------------
`watch_hits` deduplica por `(keyword_id, url)`, que es correcto pero
insuficiente: **Google News entrega la misma nota bajo URLs de redirector
distintas**. Visto en producción el 2026-08-21 en el panel /radar, con dos
pares reales:

  "…celebra tres décadas de 'La Pipa de la Paz': fecha, lugar y venta…"
  "…celebra tres décadas de La Pipa de la Paz: fecha, lugar y venta…"

Mismo medio (Infobae), misma nota, dos filas. **Y fíjate en la diferencia: solo
las comillas tipográficas.** Por eso comparar titulares "tal cual" no sirve —
hay que normalizar agresivamente antes.

Vive en su propio módulo, y no dentro de `collectors/watchlist.py`, porque lo
necesitan los dos lados del dedup y ningún writer importa de collectors en este
proyecto (misma razón por la que `is_real_article` se extrajo a
`article_filter.py`):
  - el COLLECTOR lo usa para no reportar dos veces en la MISMA corrida;
  - el WRITER lo usa para no insertar algo que ya está en la DB de corridas
    anteriores bajo otra URL.
Si cambia la normalización, cambia para ambos a la vez.
"""

import re
import unicodedata

# Todo lo que no sea letra o número pasa a ser separador: así caen comillas
# rectas y tipográficas, signos de admiración, guiones largos, emojis y demás
# adornos del titular, que es justo por donde se colaban los duplicados.
_NO_ALFANUM = re.compile(r"[^a-z0-9]+")


def normalize_text(text):
    """Minúsculas, sin tildes, sin puntuación y con espacios colapsados."""
    txt = (text or "").lower()
    sin_tildes = "".join(
        c for c in unicodedata.normalize("NFD", txt)
        if unicodedata.category(c) != "Mn"
    )
    return _NO_ALFANUM.sub(" ", sin_tildes).strip()


def title_key(title, source=None):
    """
    Clave de dedup de un hallazgo: titular normalizado + medio normalizado.

    **Se incluye el MEDIO a propósito.** Dos notas con el mismo titular pero de
    medios distintos NO son un duplicado: que El Comercio y Trome titulen igual
    es cobertura real de dos competidores, y ocultarla seria perder información
    (el panel sirve justo para ver quién está cubriendo un tema). El duplicado
    que se quiere matar es el del MISMO medio repetido bajo otra URL.

    Devuelve None si no hay titular con contenido: sin texto no hay nada que
    comparar, y una clave vacía agruparía cosas sin relación.
    """
    t = normalize_text(title)
    if not t:
        return None
    return (t, normalize_text(source))
