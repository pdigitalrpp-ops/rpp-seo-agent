import time
import logging
import feedparser
from pytrends.request import TrendReq
from tenacity import retry, stop_after_attempt, wait_exponential
from config import GOOGLE_TRENDS_CATEGORIES

logger = logging.getLogger(__name__)

TRENDS_RSS_URL = "https://trends.google.com/trending/rss?geo={geo}"


def _get_pytrends():
    return TrendReq(hl="es-419", tz=-300, timeout=(10, 25))


def _parse_traffic(raw):
    """'20.000+' -> 20000 (en es-PE el punto es separador de miles)."""
    if not raw:
        return 0
    digits = "".join(c for c in raw if c.isdigit())
    return int(digits) if digits else 0


def _traffic_to_score(traffic):
    """Mapea el tráfico aproximado del trending a un growth_score 0-10."""
    if traffic >= 50000: return 9.0
    if traffic >= 20000: return 7.0
    if traffic >= 10000: return 5.0
    if traffic >= 5000:  return 4.0
    if traffic >= 2000:  return 3.0
    if traffic >= 1000:  return 2.0
    return 1.5


def fetch_trends_rss(geo="PE", limit=20):
    """
    Tendencias de hoy desde el feed RSS oficial de Google Trends.
    Más robusto que pytrends desde CI (pytrends se bloquea por IP de datacenter).
    """
    feed = feedparser.parse(TRENDS_RSS_URL.format(geo=geo))
    results = []
    for i, entry in enumerate(feed.entries[:limit]):
        traffic = _parse_traffic(entry.get("ht_approx_traffic", ""))
        kw = (entry.get("title") or "").strip()
        if not kw:
            continue
        results.append({
            "keyword":        kw,
            "rank":           i + 1,
            "geo":            geo,
            "approx_traffic": traffic,
            "growth_score":   _traffic_to_score(traffic),
        })
    logger.info(f"Google Trends RSS: {len(results)} tendencias")
    return results


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=60, max=180))
def fetch_trending_now(geo="PE", limit=20):
    pt = _get_pytrends()
    trending = pt.trending_searches(pn="peru")
    results = []
    for i, term in enumerate(trending.values.flatten()[:limit]):
        results.append({
            "keyword": str(term),
            "rank":    i + 1,
            "geo":     geo,
        })
    return results


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=60, max=180))
def fetch_trending_by_category(category_id, geo="PE", days=1):
    pt = _get_pytrends()
    timeframe = f"now {days}-d" if days <= 7 else f"today {days}-d"
    pt.build_payload([""], cat=category_id, timeframe=timeframe, geo=geo)
    related = pt.related_queries()
    results = []
    for keyword, data in related.items():
        if data and data.get("rising") is not None:
            for _, row in data["rising"].iterrows():
                results.append({
                    "keyword":      row["query"],
                    "growth_value": row["value"],
                    "category_id":  category_id,
                    "type":         "rising",
                })
    return results


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=60, max=180))
def fetch_keyword_interest(keywords, geo="PE", timeframe="now 7-d"):
    pt = _get_pytrends()
    batches = [keywords[i:i+5] for i in range(0, len(keywords), 5)]
    all_results = []
    for batch in batches:
        pt.build_payload(batch, geo=geo, timeframe=timeframe)
        interest = pt.interest_over_time()
        if not interest.empty:
            for kw in batch:
                if kw in interest.columns:
                    series = interest[kw]
                    all_results.append({
                        "keyword":    kw,
                        "avg_7d":     round(series.mean(), 1),
                        "last_value": int(series.iloc[-1]),
                        "peak":       int(series.max()),
                    })
        time.sleep(5)
    return all_results


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=60, max=180))
def fetch_rising_terms(keyword, geo="PE"):
    pt = _get_pytrends()
    pt.build_payload([keyword], geo=geo, timeframe="now 7-d")
    related = pt.related_queries()

    if keyword not in related or related[keyword].get("rising") is None:
        return []

    rising = related[keyword]["rising"]
    return [
        {"keyword": row["query"], "growth_pct": row["value"]}
        for _, row in rising.iterrows()
    ]


def calculate_growth_score(keyword, geo="PE"):
    try:
        recent = fetch_keyword_interest([keyword], geo=geo, timeframe="now 4-H")
        week   = fetch_keyword_interest([keyword], geo=geo, timeframe="now 7-d")

        if not recent or not week:
            return 0.0

        recent_val = recent[0]["last_value"]
        week_avg   = week[0]["avg_7d"]

        if week_avg == 0:
            return 5.0 if recent_val > 0 else 0.0

        growth_pct = ((recent_val - week_avg) / week_avg) * 100

        if growth_pct >= 500: return 10.0
        if growth_pct >= 300: return 8.0
        if growth_pct >= 200: return 7.0
        if growth_pct >= 100: return 6.0
        if growth_pct >= 50:  return 5.0
        if growth_pct >= 20:  return 3.0
        if growth_pct >= 0:   return 2.0
        return 1.0

    except Exception as e:
        logger.warning(f"No se pudo calcular growth score para '{keyword}': {e}")
        return 0.0


def fetch_all_trends(geo="PE"):
    """
    Fuente principal: feed RSS de Google Trends (robusto desde CI).
    El growth_score sale del tráfico aproximado del propio feed, así que no
    necesitamos las llamadas extra a pytrends (que se bloquean en datacenters).
    """
    return fetch_trends_rss(geo=geo, limit=20)
