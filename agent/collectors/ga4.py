import os
import json
import tempfile
import logging
from datetime import datetime, timedelta
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    RunReportRequest, DateRange, Dimension, Metric, OrderBy,
)
from config import GA4_PROPERTY_ID

logger = logging.getLogger(__name__)


def _get_client():
    creds_json = os.environ.get("GA4_CREDENTIALS_JSON")
    if not creds_json:
        raise ValueError("GA4_CREDENTIALS_JSON no está configurado")
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        f.write(creds_json)
        tmp_path = f.name
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = tmp_path
    return BetaAnalyticsDataClient()


def fetch_top_articles(days=1, limit=50):
    client = _get_client()
    end_date = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    request = RunReportRequest(
        property=f"properties/{GA4_PROPERTY_ID}",
        dimensions=[
            Dimension(name="pagePath"),
            Dimension(name="sessionDefaultChannelGroup"),
        ],
        metrics=[
            Metric(name="sessions"),
            Metric(name="bounceRate"),
            Metric(name="averageSessionDuration"),
        ],
        date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
        order_bys=[OrderBy(metric=OrderBy.MetricOrderBy(metric_name="sessions"), desc=True)],
        limit=limit,
    )

    response = client.run_report(request)
    results = []
    for row in response.rows:
        results.append({
            "page_path":            row.dimension_values[0].value,
            "source":               row.dimension_values[1].value,
            "sessions":             int(row.metric_values[0].value),
            "bounce_rate":          float(row.metric_values[1].value),
            "avg_session_duration": float(row.metric_values[2].value),
            "date":                 end_date,
        })
    return results


def fetch_recent_articles_performance(hours=48):
    client = _get_client()
    start_date = (datetime.now() - timedelta(hours=hours)).strftime("%Y-%m-%d")
    end_date = datetime.now().strftime("%Y-%m-%d")

    request = RunReportRequest(
        property=f"properties/{GA4_PROPERTY_ID}",
        dimensions=[Dimension(name="pagePath")],
        metrics=[
            Metric(name="sessions"),
            Metric(name="newUsers"),
            Metric(name="screenPageViews"),
        ],
        date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
        order_bys=[OrderBy(metric=OrderBy.MetricOrderBy(metric_name="sessions"), desc=True)],
        limit=100,
    )

    response = client.run_report(request)
    results = []
    for row in response.rows:
        results.append({
            "page_path":  row.dimension_values[0].value,
            "sessions":   int(row.metric_values[0].value),
            "new_users":  int(row.metric_values[1].value),
            "pageviews":  int(row.metric_values[2].value),
        })
    return results


def fetch_traffic_by_section(days=7):
    client = _get_client()
    end_date = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    request = RunReportRequest(
        property=f"properties/{GA4_PROPERTY_ID}",
        dimensions=[Dimension(name="pagePathPlusQueryString")],
        metrics=[Metric(name="sessions")],
        date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
        limit=500,
    )

    response = client.run_report(request)
    section_totals = {}
    for row in response.rows:
        path = row.dimension_values[0].value
        sessions = int(row.metric_values[0].value)
        parts = path.strip("/").split("/")
        section = parts[0] if parts else "home"
        section_totals[section] = section_totals.get(section, 0) + sessions

    return [{"section": k, "sessions": v} for k, v in
            sorted(section_totals.items(), key=lambda x: x[1], reverse=True)]


def fetch_hourly_traffic_pattern(days=30):
    client = _get_client()
    end_date = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    request = RunReportRequest(
        property=f"properties/{GA4_PROPERTY_ID}",
        dimensions=[Dimension(name="hour")],
        metrics=[Metric(name="sessions")],
        date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
    )

    response = client.run_report(request)
    pattern = {}
    for row in response.rows:
        hour = int(row.dimension_values[0].value)
        sessions = int(row.metric_values[0].value)
        pattern[hour] = round(sessions / days, 1)

    return pattern


def fetch_bounce_rate_by_section(days=7):
    client = _get_client()
    end_date = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    request = RunReportRequest(
        property=f"properties/{GA4_PROPERTY_ID}",
        dimensions=[Dimension(name="firstUserDefaultChannelGroup")],
        metrics=[Metric(name="bounceRate"), Metric(name="sessions")],
        date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
    )

    response = client.run_report(request)
    return [
        {
            "channel":     row.dimension_values[0].value,
            "bounce_rate": round(float(row.metric_values[0].value) * 100, 2),
            "sessions":    int(row.metric_values[1].value),
        }
        for row in response.rows
    ]
