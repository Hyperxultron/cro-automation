"""
Site health and behaviour (manager checklist, section 7) - the parts Shopify
Analytics already has. Clarity signals (rage clicks etc.) are on hold.

1. Core Web Vitals (P1) from ShopifyQL `web_performance` (real visitors'
   page loads, measured by Shopify): p75 LCP, INP and CLS per device, judged
   against Google's limits:
       LCP  good <= 2.5 s,  poor > 4 s
       INP  good <= 200 ms, poor > 500 ms
       CLS  good <= 0.1,    poor > 0.25
   p75 = 75% of page loads were at least this fast (Google's own rule).
   Also per page type and the most-loaded mobile pages, and a daily mobile trend.

2. Site search (P2) from `search_conversions` + `searches`:
   share of sessions that search, conversion of searchers vs non-searchers,
   top search terms and top zero-result terms.

Not available from Shopify (so not shown): JavaScript errors, 404 hits.
"""

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import models
from landing import _f, _i, _run, _since, period_windows
from overview import _tz
from shopify_client import HUMAN_SESSIONS_FILTER

logger = logging.getLogger("site_health")

CACHE_SECONDS = 600
_cache: dict = {}

# metric -> (good limit, poor limit, unit)
LIMITS = {
    "lcp": (2500.0, 4000.0, "ms"),
    "inp": (200.0, 500.0, "ms"),
    "cls": (0.1, 0.25, ""),
}
CWV_SHOW = (
    "page_loads, lcp_p75_ms, inp_p75_ms, p75_cls, "
    "lcp_good_view_count, lcp_okay_view_count, lcp_poor_view_count, "
    "inp_good_view_count, inp_okay_view_count, inp_poor_view_count, "
    "cls_good_view_count, cls_okay_view_count, cls_poor_view_count"
)


def rating(metric: str, value) -> str | None:
    if value is None:
        return None
    good, poor, _ = LIMITS[metric]
    return "good" if value <= good else ("poor" if value > poor else "needs_improvement")


def _vitals(row: dict) -> dict:
    loads = _i(row.get("page_loads"))
    out = {"page_loads": loads}
    for m, key in (("lcp", "lcp_p75_ms"), ("inp", "inp_p75_ms"), ("cls", "p75_cls")):
        v = _f(row.get(key))
        if v is not None:
            v = round(v, 3) if m == "cls" else round(v)
        good = _i(row.get(f"{m}_good_view_count"))
        okay = _i(row.get(f"{m}_okay_view_count"))
        poor = _i(row.get(f"{m}_poor_view_count"))
        measured = good + okay + poor
        out[m] = {
            "p75": v,
            "rating": rating(m, v),
            # share of measured page loads in Google's "good" / "poor" band
            "good_share": round(good / measured * 100, 1) if measured else None,
            "poor_share": round(poor / measured * 100, 1) if measured else None,
        }
    return out


def _by(rows: list[dict], key: str) -> dict[str, dict]:
    return {
        (str(r.get(key)).strip() or "Unknown"): _vitals(r)
        for r in rows
        if r.get(key) is not None
    }


def _add_change(cur: dict, prev: dict | None) -> dict:
    for m in LIMITS:
        p = (prev or {}).get(m, {}).get("p75")
        c = cur[m]["p75"]
        cur[m]["previous_p75"] = p
        cur[m]["change"] = (round(c - p, 3) if m == "cls" else round(c - p)) if c is not None and p is not None else None
    return cur


def _latest_day_with_data(store: models.Store, dataset: str, metric: str, upto, look_back: int = 10):
    """
    Latest store-time day (<= upto) on which Shopify has published `dataset`.
    Page speed (web_performance) and site search arrive about 1-2 days late,
    so for Today / Yesterday the asked-for day is often still empty.
    Returns (date or None, error or None).
    """
    since = (upto - timedelta(days=look_back)).isoformat()
    until = (upto + timedelta(days=1)).isoformat()
    try:
        rows = _run(store, f"FROM {dataset} SHOW {metric} TIMESERIES day SINCE {since} UNTIL {until}")
    except Exception as exc:
        logger.warning("Latest-day probe for %s failed: %s", dataset, exc)
        return None, str(exc)[:200]
    days = sorted(
        str(r.get("day") or "")[:10] for r in rows or []
        if r.get("day") and _i(r.get(metric)) > 0 and str(r.get("day"))[:10] <= upto.isoformat()
    )
    return (datetime.fromisoformat(days[-1]).date() if days else None), None


def _day_label(d) -> str:
    return d.strftime("%a %d %b")


def fetch_site_health(store: models.Store, days: int = 28, period: str | None = None) -> dict:
    period = period if period in ("today", "yesterday") else None
    key = (store.store_url, days, period, datetime.now(_tz(store)).date().isoformat())
    cached = _cache.get(key)
    if cached and cached[0] > time.time():
        return cached[1]

    first, last, p_first, p_last, window_label, compare_label = period_windows(store, days, period)
    cur_w, prev_w = _since(first, last), _since(p_first, p_last)
    mobile = "WHERE device_type = 'Mobile' "

    # Today / Yesterday: Shopify publishes page speed and search data ~1-2
    # days late. If the asked-for day isn't out yet, show the latest day that
    # is (and say so) instead of an empty card.
    speed_w, speed_prev_w, speed_label, speed_note = cur_w, prev_w, window_label, None
    search_w, search_label, search_note = cur_w, window_label, None
    if period in ("today", "yesterday"):
        with ThreadPoolExecutor(max_workers=2) as pool:
            f_speed = pool.submit(_latest_day_with_data, store, "web_performance", "page_loads", first)
            f_search = pool.submit(_latest_day_with_data, store, "search_conversions", "sessions_with_searches", first)
            (speed_day, _), (search_day, _) = f_speed.result(), f_search.result()
        asked = "today" if period == "today" else f"yesterday ({_day_label(first)})"
        if speed_day and speed_day < first:
            speed_w, speed_prev_w = _since(speed_day, speed_day), _since(speed_day - timedelta(days=7), speed_day - timedelta(days=7))
            speed_label = f"{_day_label(speed_day)} (latest day Shopify has published) · compared with {_day_label(speed_day - timedelta(days=7))}"
            speed_note = (f"Shopify publishes page speed data about 1-2 days late, so {asked} isn't out yet. "
                          f"Showing the latest available day: {_day_label(speed_day)}.")
        if search_day and search_day < first:
            search_w = _since(search_day, search_day)
            search_label = f"{_day_label(search_day)} (latest day Shopify has published)"
            search_note = (f"Shopify publishes site search data about 1-2 days late, so {asked} isn't out yet. "
                           f"Showing the latest available day: {_day_label(search_day)}.")

    queries = {
        "device": f"FROM web_performance SHOW {CWV_SHOW} GROUP BY device_type {speed_w} ORDER BY page_loads DESC",
        "device_prev": f"FROM web_performance SHOW {CWV_SHOW} GROUP BY device_type {speed_prev_w} ORDER BY page_loads DESC",
        "page_type": f"FROM web_performance SHOW {CWV_SHOW} {mobile}GROUP BY page_type {speed_w} ORDER BY page_loads DESC",
        "pages": f"FROM web_performance SHOW {CWV_SHOW} {mobile}GROUP BY page_path {speed_w} ORDER BY page_loads DESC LIMIT 25",
        "trend": f"FROM web_performance SHOW page_loads, lcp_p75_ms, inp_p75_ms, p75_cls {mobile}TIMESERIES day {cur_w if period is None else speed_w}",
        "search_conv": (
            "FROM search_conversions SHOW sessions_with_searches, search_sessions_that_completed_checkout, "
            f"search_conversion_rate, search_added_to_cart_rate, search_click_rate {search_w}"
        ),
        "sessions": f"FROM sessions SHOW sessions, sessions_that_completed_checkout {HUMAN_SESSIONS_FILTER}{search_w}",
        "search_results": f"FROM searches SHOW searches GROUP BY search_results_were_returned {search_w}",
        "top_terms": f"FROM searches SHOW searches GROUP BY search_query {search_w} ORDER BY searches DESC LIMIT 20",
        "zero_terms": (
            "FROM searches SHOW searches WHERE search_results_were_returned = false "
            f"GROUP BY search_query {search_w} ORDER BY searches DESC LIMIT 20"
        ),
        "term_clicks": (
            "FROM search_queries SHOW search_queries, search_queries_with_clicks "
            f"GROUP BY search_query {search_w} ORDER BY search_queries DESC LIMIT 200"
        ),
    }

    results: dict[str, list[dict] | None] = {}
    errors: dict[str, str] = {}

    def run(item):
        name, q = item
        try:
            return name, _run(store, q), None
        except Exception as exc:
            logger.warning("Site health query %s failed: %s", name, exc)
            return name, None, str(exc)[:300]

    with ThreadPoolExecutor(max_workers=4) as pool:
        for name, rows, err in pool.map(run, queries.items()):
            results[name] = rows
            if err:
                errors[name] = err

    # --- Core Web Vitals ----------------------------------------------------
    cwv_ok = results.get("device") is not None
    prev_dev = _by(results.get("device_prev") or [], "device_type")
    devices = {k: _add_change(v, prev_dev.get(k)) for k, v in _by(results.get("device") or [], "device_type").items()}
    page_types = [{"label": k, **v} for k, v in _by(results.get("page_type") or [], "page_type").items()]
    pages = [{"path": k, **v} for k, v in _by(results.get("pages") or [], "page_path").items()]
    trend = []
    for r in results.get("trend") or []:
        d = str(r.get("day") or "")[:10]
        if not d:
            continue
        lcp, inp, cls = _f(r.get("lcp_p75_ms")), _f(r.get("inp_p75_ms")), _f(r.get("p75_cls"))
        if not _i(r.get("page_loads")) or not lcp or lcp <= 0:
            continue  # day with no measured loads yet (Shopify fills it in later) - not "0 s"
        trend.append({
            "date": d,
            "page_loads": _i(r.get("page_loads")),
            "lcp_s": round(lcp / 1000, 2) if lcp is not None else None,
            "inp_ms": round(inp) if inp is not None else None,
            "cls": round(cls, 3) if cls is not None else None,
        })
    trend.sort(key=lambda t: t["date"])

    # --- Site search --------------------------------------------------------
    search = None
    sc = (results.get("search_conv") or [None])[0] if results.get("search_conv") else None
    ss = (results.get("sessions") or [None])[0] if results.get("sessions") else None
    if sc:
        s_sessions = _i(sc.get("sessions_with_searches"))
        s_orders = _i(sc.get("search_sessions_that_completed_checkout"))
        all_sessions = _i(ss.get("sessions")) if ss else 0
        all_orders = _i(ss.get("sessions_that_completed_checkout")) if ss else 0
        non_sessions = all_sessions - s_sessions
        non_orders = all_orders - s_orders
        searches_total = 0
        zero_total = 0
        for r in results.get("search_results") or []:
            n = _i(r.get("searches"))
            flag = r.get("search_results_were_returned")
            if flag is None:
                continue
            searches_total += n
            if str(flag).lower() in ("false", "0", "no"):
                zero_total += n
        clicks = {}
        for r in results.get("term_clicks") or []:
            t = str(r.get("search_query") or "").strip().lower()
            if t:
                q, c = _i(r.get("search_queries")), _i(r.get("search_queries_with_clicks"))
                clicks[t] = round(c / q * 100, 1) if q else None
        search = {
            "sessions_with_searches": s_sessions,
            "share_of_sessions": round(s_sessions / all_sessions * 100, 2) if all_sessions else None,
            "searcher_conversion_rate": round(s_orders / s_sessions * 100, 2) if s_sessions else None,
            "non_searcher_conversion_rate": (
                round(non_orders / non_sessions * 100, 2) if ss and non_sessions > 0 and non_orders >= 0 else None
            ),
            "search_added_to_cart_rate": round((_f(sc.get("search_added_to_cart_rate")) or 0) * 100, 2),
            "search_click_rate": round((_f(sc.get("search_click_rate")) or 0) * 100, 2),
            "searches": searches_total or None,
            "zero_result_searches": zero_total if searches_total else None,
            "zero_result_share": round(zero_total / searches_total * 100, 1) if searches_total else None,
            "top_terms": [
                {
                    "term": str(r.get("search_query")),
                    "searches": _i(r.get("searches")),
                    "click_rate": clicks.get(str(r.get("search_query") or "").strip().lower()),
                }
                for r in results.get("top_terms") or [] if r.get("search_query")
            ],
            "zero_result_terms": [
                {"term": str(r.get("search_query")), "searches": _i(r.get("searches"))}
                for r in results.get("zero_terms") or [] if r.get("search_query")
            ],
        }

    result = {
        "days": days,
        "period": period or f"last{days}",
        "window_label": window_label,
        "compare_label": compare_label,
        "speed_window_label": speed_label,
        "speed_note": speed_note,
        "search_window_label": search_label,
        "search_note": search_note,
        "limits": {m: {"good": g, "poor": p, "unit": u} for m, (g, p, u) in LIMITS.items()},
        "cwv_available": cwv_ok,
        "devices": devices,
        "page_types": page_types,
        "pages": pages,
        "trend": trend,
        "search": search,
        "not_available": [
            "JavaScript errors and 404 pages: Shopify Analytics doesn't record these.",
            "Rage clicks, dead clicks and scroll depth: these need Microsoft Clarity (on hold).",
        ],
        "errors": errors,
    }
    _cache[key] = (time.time() + (120 if period == "today" else CACHE_SECONDS), result)
    return result


_speed_cache: dict = {}


def mobile_speed_snapshot(store: models.Store, upto) -> dict | None:
    """
    Overview health strip: mobile Core Web Vitals (p75) for the latest day
    Shopify has published (<= upto). None if Shopify has no page speed data.
    Cached for an hour - it changes once a day.
    """
    key = (store.store_url, upto.isoformat())
    hit = _speed_cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    day, err = _latest_day_with_data(store, "web_performance", "page_loads", upto)
    if err:
        raise RuntimeError(err)
    out = None
    if day:
        rows = _run(store, f"FROM web_performance SHOW {CWV_SHOW} WHERE device_type = 'Mobile' {_since(day, day)}")
        if rows:
            v = _vitals(rows[0])
            if v["lcp"]["p75"] is not None:
                ratings = [v[m]["rating"] for m in ("lcp", "inp", "cls") if v[m]["rating"]]
                overall = "poor" if "poor" in ratings else ("needs_improvement" if "needs_improvement" in ratings else "good")
                out = {
                    "day": day.isoformat(),
                    "day_label": _day_label(day),
                    "lcp_ms": v["lcp"]["p75"], "lcp_rating": v["lcp"]["rating"],
                    "inp_ms": v["inp"]["p75"], "inp_rating": v["inp"]["rating"],
                    "cls": v["cls"]["p75"], "cls_rating": v["cls"]["rating"],
                    "rating": overall,
                    "page_loads": v["page_loads"],
                }
    _speed_cache[key] = (time.time() + 3600, out)
    return out
