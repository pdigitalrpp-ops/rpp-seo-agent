import os
import logging
import requests
from config import SERPAPI_DAILY_LIMIT, SITE_URL

logger = logging.getLogger(__name__)

BASE_URL = "https://serpapi.com/search"
_call_count = 0


def _search(params):
    global _call_count
    if _call_count >= SERPAPI_DAILY_LIMIT:
        logger.warning(f"Límite diario SerpAPI alcanzado ({SERPAPI_DAILY_LIMIT} llamadas)")
        return {}

    api_key = os.environ.get("SERPAPI_KEY")
    if not api_key:
        raise ValueError("SERPAPI_KEY no está configurado")

    params["api_key"] = api_key
    params.setdefault("gl", "pe")
    params.setdefault("hl", "es")

    resp = requests.get(BASE_URL, params=params, timeout=15)
    resp.raise_for_status()
    _call_count += 1
    logger.info(f"SerpAPI call #{_call_count}: {params.get('q', '')}")
    return resp.json()


def fetch_keyword_rankings(keywords, gl="pe", hl="es"):
    domain = SITE_URL.replace("https://", "").replace("http://", "").rstrip("/")
    results = []

    for kw in keywords[:10]:
        data = _search({"engine": "google", "q": kw, "num": 20, "gl": gl, "hl": hl})
        organic = data.get("organic_results", [])
        position = None
        for i, result in enumerate(organic):
            link = result.get("link", "")
            if domain in link:
                position = i + 1
                break

        results.append({
            "keyword":  kw,
            "position": position,
            "in_top20": position is not None,
        })

    return results


def fetch_serp_features(keyword, gl="pe"):
    data = _search({"engine": "google", "q": keyword, "gl": gl})

    features = {
        "keyword":          keyword,
        "featured_snippet": None,
        "paa_questions":    [],
        "top_stories":      [],
        "has_image_pack":   "images_results" in data,
        "has_local_pack":   "local_results" in data,
    }

    if "answer_box" in data:
        ab = data["answer_box"]
        features["featured_snippet"] = {
            "type":   ab.get("type"),
            "answer": ab.get("answer") or ab.get("snippet", "")[:200],
            "source": ab.get("link", ""),
        }

    for paa in data.get("related_questions", []):
        features["paa_questions"].append({
            "question": paa.get("question", ""),
            "answer":   (paa.get("answer") or "")[:200],
        })

    for story in data.get("top_stories", []):
        features["top_stories"].append({
            "title":  story.get("title", ""),
            "source": story.get("source", ""),
            "link":   story.get("link", ""),
        })

    return features


def fetch_paa_questions(keyword, gl="pe"):
    data = _search({"engine": "google", "q": keyword, "gl": gl})
    questions = []
    for paa in data.get("related_questions", []):
        q = paa.get("question", "")
        if q:
            questions.append(q)
    return questions


def fetch_top_stories(topic, gl="pe"):
    data = _search({"engine": "google", "q": topic, "tbm": "nws", "gl": gl, "num": 10})
    stories = []
    for result in data.get("news_results", []):
        stories.append({
            "title":   result.get("title", ""),
            "source":  result.get("source", ""),
            "link":    result.get("link", ""),
            "snippet": result.get("snippet", ""),
            "date":    result.get("date", ""),
        })
    return stories
