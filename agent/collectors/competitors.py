import logging
import requests
import feedparser
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree as ET
from config import COMPETITOR_SITES, CATEGORY_KEYWORDS

logger = logging.getLogger(__name__)

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; RPP-SEO-Agent/1.0)"}


def _parse_rss(site):
    try:
        feed = feedparser.parse(site["rss"])
        if feed.entries:
            return feed.entries
        raise ValueError("RSS vacío")
    except Exception as e:
        logger.warning(f"RSS falló para {site['name']}: {e}. Intentando sitemap...")
        return _parse_sitemap(site)


def _parse_sitemap(site):
    domain = site["rss"].split("/")[2]
    sitemap_url = f"https://{domain}/sitemap-news.xml"

    try:
        resp = requests.get(sitemap_url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        ns = {
            "sm":   "http://www.sitemaps.org/schemas/sitemap/0.9",
            "news": "http://www.google.com/schemas/sitemap-news/0.9",
        }

        entries = []
        for url_el in root.findall("sm:url", ns):
            loc      = url_el.findtext("sm:loc", namespaces=ns) or ""
            title_el = url_el.find("news:news/news:title", ns)
            pub_el   = url_el.find("news:news/news:publication_date", ns)
            title    = title_el.text if title_el is not None else loc
            pub      = pub_el.text   if pub_el   is not None else ""
            entries.append(type("Entry", (), {
                "title":     title,
                "link":      loc,
                "published": pub,
            })())
        return entries
    except Exception as e:
        logger.error(f"Sitemap también falló para {domain}: {e}")
        return []


def infer_category(title):
    title_lower = title.lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(kw in title_lower for kw in keywords):
            return category
    return "otros"


def _parse_date(entry):
    for attr in ["published_parsed", "updated_parsed"]:
        val = getattr(entry, attr, None)
        if val:
            try:
                return datetime(*val[:6], tzinfo=timezone.utc)
            except Exception:
                pass
    published = getattr(entry, "published", "") or ""
    for fmt in ["%Y-%m-%dT%H:%M:%S%z", "%a, %d %b %Y %H:%M:%S %z"]:
        try:
            return datetime.strptime(published, fmt)
        except Exception:
            pass
    return datetime.now(timezone.utc)


def fetch_all_competitors(hours_back=24):
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours_back)
    all_articles = []

    for site in COMPETITOR_SITES:
        try:
            entries = _parse_rss(site)
            for entry in entries:
                pub_date = _parse_date(entry)
                if pub_date >= cutoff:
                    title = getattr(entry, "title", "") or ""
                    link  = getattr(entry, "link",  "") or ""
                    all_articles.append({
                        "site":         site["name"],
                        "title":        title,
                        "url":          link,
                        "published_at": pub_date.isoformat(),
                        "category":     infer_category(title),
                    })
            count = len([a for a in all_articles if a["site"] == site["name"]])
            logger.info(f"✅ {site['name']}: {count} artículos")
        except Exception as e:
            logger.error(f"❌ {site['name']} completamente falló: {e}")

    return all_articles


def find_coverage_gaps(competitor_articles, own_recent_articles):
    comp_by_category = {}
    for art in competitor_articles:
        cat = art["category"]
        if cat not in comp_by_category:
            comp_by_category[cat] = []
        comp_by_category[cat].append(art)

    own_keywords = set()
    for art in own_recent_articles:
        title = art.get("title", "") or art.get("page_path", "")
        for word in title.lower().split():
            if len(word) > 4:
                own_keywords.add(word)

    gaps = []
    for cat, articles in comp_by_category.items():
        topic_clusters = {}
        for art in articles:
            words = [w for w in art["title"].lower().split() if len(w) > 4]
            for word in words:
                if word not in topic_clusters:
                    topic_clusters[word] = []
                topic_clusters[word].append(art["site"])

        for keyword, sites in topic_clusters.items():
            unique_sites = list(set(sites))
            if len(unique_sites) >= 2 and keyword not in own_keywords:
                gaps.append({
                    "keyword":         keyword,
                    "category":        cat,
                    "covered_by":      unique_sites,
                    "coverage_count":  len(unique_sites),
                    "sample_articles": [a for a in articles if keyword in a["title"].lower()][:3],
                })

    return sorted(gaps, key=lambda x: x["coverage_count"], reverse=True)[:20]


def detect_trending_topics_in_competition(articles):
    keyword_freq = {}
    for art in articles:
        words = [w for w in art["title"].lower().split() if len(w) > 4]
        for word in words:
            if word not in keyword_freq:
                keyword_freq[word] = {"count": 0, "sites": set(), "titles": []}
            keyword_freq[word]["count"] += 1
            keyword_freq[word]["sites"].add(art["site"])
            keyword_freq[word]["titles"].append(art["title"])

    trending = []
    for keyword, data in keyword_freq.items():
        if data["count"] >= 2:
            trending.append({
                "keyword": keyword,
                "count":   data["count"],
                "sites":   list(data["sites"]),
                "sample":  data["titles"][0] if data["titles"] else "",
            })

    return sorted(trending, key=lambda x: (len(x["sites"]), x["count"]), reverse=True)[:20]
