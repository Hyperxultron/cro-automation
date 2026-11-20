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
from datetime import datetime

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


def fetch_site_health(store: models.Store, days: int = 28, period: str | None = None) -> dict:
    period = period if period in ("today", "yesterday") else None
    key = (store.store_url, days, period, datetime.now(_tz(store)).date().isoformat())
    cached = _cache.get(key)
    if cached and cached[0] > time.time():
        return cached[1]

    first, last, p_first, p_last, window_label, compare_label = period_windows(store, days, period)
    cur_w, prev_w = _since(first, last), _since(p_first, p_last)
    mobile = "WHERE device_type = 'Mobile' "

    queries = {
        "device": f"FROM web_performance SHOW {CWV_SHOW} GROUP BY device_type {cur_w} ORDER BY page_loads DESC",
        "device_prev": f"FROM web_performance SHOW {CWV_SHOW} GROUP BY device_type {prev_w} ORDER BY page_loads DESC",
        "page_type": f"FROM web_performance SHOW {CWV_SHOW} {mobile}GROUP BY page_type {cur_w} ORDER BY page_loads DESC",
        "pages": f"FROM web_performance SHOW {CWV_SHOW} {mobile}GROUP BY page_path {cur_w} ORDER BY page_loads DESC LIMIT 25",
        "trend": f"FROM web_performance SHOW page_loads, lcp_p75_ms, inp_p75_ms, p75_cls {mobile}TIMESERIES day {cur_w}",
        "search_conv": (
            "FROM search_conversions SHOW sessions_with_searches, search_sessions_that_completed_checkout, "
            f"search_conversion_rate, search_added_to_cart_rate, search_click_rate {cur_w}"
        ),
        "sessions": f"FROM sessions SHOW sessions, sessions_that_completed_checkout {HUMAN_SESSIONS_FILTER}{cur_w}",
        "search_results": f"FROM searches SHOW searches GROUP BY search_results_were_returned {cur_w}",
        "top_terms": f"FROM searches SHOW searches GROUP BY search_query {cur_w} ORDER BY searches DESC LIMIT 20",
        "zero_terms": (
            "FROM searches SHOW searches WHERE search_results_were_returned = false "
            f"GROUP BY search_query {cur_w} ORDER BY searches DESC LIMIT 20"
        ),
        "term_clicks": (
            "FROM search_queries SHOW search_queries, search_queries_with_clicks "
            f"GROUP BY search_query {cur_w} ORDER BY search_queries DESC LIMIT 200"
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
