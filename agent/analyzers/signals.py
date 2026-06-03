import logging
from config import CATEGORY_KEYWORDS

logger = logging.getLogger(__name__)


def detect_early_signals(trends_rising_terms, gsc_data=None):
    if not trends_rising_terms:
        return []

    gsc_emerging = set()
    if gsc_data:
        for row in gsc_data:
            if 11 <= row.get("position", 99) <= 30 and row.get("impressions", 0) >= 50:
                query = row.get("query", "").lower()
                gsc_emerging.add(query)

    signals = []
    for item in trends_rising_terms:
        kw         = item.get("keyword", "")
        growth_pct = item.get("growth_pct", 0)

        if 50 <= growth_pct <= 500:
            kw_in_gsc = any(word in gsc_emerging for word in kw.lower().split() if len(word) > 3)
            signals.append({
                "keyword":                kw,
                "growth_pct":             growth_pct,
                "in_gsc":                 kw_in_gsc,
                "signal_strength":        "fuerte" if kw_in_gsc else "moderada",
                "category":               _infer_category(kw),
                "estimated_hours_to_peak": _estimate_hours_to_peak(growth_pct),
            })

    return sorted(signals, key=lambda x: x["growth_pct"], reverse=True)[:10]


def cross_reference_signals(trends_data, competitor_articles, gsc_data):
    if not trends_data:
        return []

    comp_keywords = set()
    if competitor_articles:
        for art in competitor_articles:
            for word in art["title"].lower().split():
                if len(word) > 4:
                    comp_keywords.add(word)

    gsc_keywords = set()
    if gsc_data:
        for row in gsc_data:
            query = row.get("query", "")
            if row.get("impressions", 0) >= 100:
                for word in query.lower().split():
                    if len(word) > 3:
                        gsc_keywords.add(word)

    strong_signals = []
    for item in trends_data:
        kw    = item.get("keyword", "")
        words = [w for w in kw.lower().split() if len(w) > 3]

        in_trends      = item.get("growth_score", 0) >= 5
        in_competition = any(w in comp_keywords for w in words)
        in_gsc         = any(w in gsc_keywords  for w in words)

        signal_count = sum([in_trends, in_competition, in_gsc])

        if signal_count >= 2:
            strong_signals.append({
                "keyword":        kw,
                "growth_score":   item.get("growth_score", 0),
                "in_trends":      in_trends,
                "in_competition": in_competition,
                "in_gsc":         in_gsc,
                "confidence":     "alta" if signal_count == 3 else "media",
                "signal_count":   signal_count,
            })

    return sorted(strong_signals, key=lambda x: x["signal_count"], reverse=True)[:10]


def calculate_window_recommendations(hourly_pattern_data):
    if not hourly_pattern_data:
        return {}

    hourly = [(int(h), float(s)) for h, s in hourly_pattern_data.items()]
    hourly.sort(key=lambda x: x[0])

    top_hours = sorted(hourly, key=lambda x: x[1], reverse=True)[:3]
    top_hours_sorted = sorted(top_hours, key=lambda x: x[0])

    windows = []
    for hour, sessions in top_hours_sorted:
        start = max(0, hour - 1)
        end   = min(23, hour + 1)
        windows.append({
            "window":        f"{start:02d}:00–{end:02d}:59",
            "peak_hour":     hour,
            "avg_sessions":  round(sessions, 1),
            "recommendation": f"Publicar entre {start:02d}:00 y {end:02d}:00 para máximo tráfico",
        })

    return {
        "top_windows":    windows,
        "overall_best":   f"{top_hours_sorted[0][0]:02d}:00" if top_hours_sorted else "07:00",
        "morning_peak":   next((f"{h:02d}:00" for h, _ in top_hours_sorted if 5 <= h <= 11),  "07:00"),
        "afternoon_peak": next((f"{h:02d}:00" for h, _ in top_hours_sorted if 12 <= h <= 17), "12:00"),
        "evening_peak":   next((f"{h:02d}:00" for h, _ in top_hours_sorted if 18 <= h <= 23), "19:00"),
    }


def _infer_category(keyword):
    kw_lower = keyword.lower()
    for cat, keywords in CATEGORY_KEYWORDS.items():
        if any(k in kw_lower for k in keywords):
            return cat
    return "otros"


def _estimate_hours_to_peak(growth_pct):
    if growth_pct >= 300: return "1–2 horas"
    if growth_pct >= 200: return "2–4 horas"
    if growth_pct >= 100: return "4–8 horas"
    return "8–24 horas"
