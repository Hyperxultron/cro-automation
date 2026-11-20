"""
Landing pages, page types and bounce rate (manager checklist, section 5).

All numbers come from Shopify Analytics (ShopifyQL), human sessions only - the
same filter as the rest of the app, so they match Shopify's own reports.

Bounce definition (checklist P1: "pick one and label it"): Shopify's - a
bounce is a session that viewed only one page. Bounce rate = bounces /
sessions. (GA4's "100% - engagement rate" is a different number.)

What's here:
  - Landing page table: sessions, bounce rate, conversion rate, add-to-cart
    rate, revenue and revenue per session, top traffic source, and a flag when
    a page's bounce rate is clearly above its own previous period.
  - Page types (home, collection, product, ...): sessions, bounce, add-to-cart
    and conversion rate.
  - Bounce split by traffic source and by device (never a site-wide number
    alone).

Revenue per landing page: ShopifyQL `sales` has `order_landing_page_path`
(the landing page of the visit that placed the order), so revenue per
session = that revenue / the page's sessions.
"""

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from urllib.parse import urlparse

import models
from overview import _tz
from shopify_client import HUMAN_SESSIONS_FILTER, graphql

logger = logging.getLogger("landing")

QUERY = """
query Landing($q: String!) {
  shopifyqlQuery(query: $q) {
    tableData { columns { name dataType } rows }
    parseErrors
  }
}
"""

CACHE_SECONDS = 600
_cache: dict = {}

MIN_SESSIONS = 100
_MIN_DEFAULT = MIN_SESSIONS          # below this a page's rates swing too much to judge
BOUNCE_FLAG_PTS = 5.0       # "above its own bounce history" = 5+ points worse
SESSION_METRICS = "sessions, bounce_rate, added_to_cart_rate, conversion_rate"


def _f(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _i(v) -> int:
    f = _f(v)
    return int(f) if f is not None else 0


def _pct(v):
    """ShopifyQL PERCENT values are decimals (0.25 = 25%)."""
    f = _f(v)
    return None if f is None else round(f * 100, 2)


def norm_path(p) -> str:
    """'/products/x?variant=1' / 'https://shop.com/products/x/' -> '/products/x'."""
    s = str(p or "").strip()
    if "://" in s:
        s = urlparse(s).path
    s = s.split("?")[0].split("#")[0].rstrip("/").lower()
    return s or "/"


def _run(store: models.Store, q: str) -> list[dict]:
    data = graphql(store.store_url, QUERY, {"q": q})["shopifyqlQuery"]
    if not data:
        raise ValueError("empty ShopifyQL response")
    if data.get("parseErrors"):
        raise ValueError(f"ShopifyQL error: {data['parseErrors']}")
    return (data.get("tableData") or {}).get("rows") or []


def _rate_rows(rows: list[dict], key: str) -> dict[str, dict]:
    """Rows grouped by `key` -> {label: {sessions, bounce_rate, added_to_cart_rate, conversion_rate}}.
    Labels that collapse to the same value are merged session-weighted."""
    out: dict[str, dict] = {}
    for r in rows:
        raw = r.get(key)
        if raw is None:
            continue  # WITH TOTALS row
        label = norm_path(raw) if key == "landing_page_path" else (str(raw).strip() or "Unknown")
        s = _i(r.get("sessions"))
        cur = out.setdefault(label, {"sessions": 0, "_b": 0.0, "_a": 0.0, "_c": 0.0})
        cur["sessions"] += s
        cur["_b"] += (_f(r.get("bounce_rate")) or 0.0) * s
        cur["_a"] += (_f(r.get("added_to_cart_rate")) or 0.0) * s
        cur["_c"] += (_f(r.get("conversion_rate")) or 0.0) * s
    for v in out.values():
        s = v["sessions"]
        v["bounce_rate"] = round(v.pop("_b") / s * 100, 2) if s else None
        v["added_to_cart_rate"] = round(v.pop("_a") / s * 100, 2) if s else None
        v["conversion_rate"] = round(v.pop("_c") / s * 100, 2) if s else None
    return out


def _windows(store: models.Store, days: int):
    yesterday = datetime.now(_tz(store)).date() - timedelta(days=1)
    first = yesterday - timedelta(days=days - 1)
    p_last = first - timedelta(days=1)
    p_first = p_last - timedelta(days=days - 1)
    return first, yesterday, p_first, p_last


def _since(a, b) -> str:
    return f"SINCE {a.isoformat()} UNTIL {b.isoformat()}"


def _split(cur: dict[str, dict], prev: dict[str, dict], min_sessions: int | None = None) -> list[dict]:
    MIN_SESSIONS = min_sessions or _MIN_DEFAULT
    rows = []
    for label, v in sorted(cur.items(), key=lambda kv: -kv[1]["sessions"]):
        p = prev.get(label)
        enough = v["sessions"] >= MIN_SESSIONS and p is not None and p["sessions"] >= MIN_SESSIONS
        rows.append({
            "label": label,
            **v,
            "previous_sessions": p["sessions"] if p else None,
            "previous_bounce_rate": p["bounce_rate"] if p else None,
            "bounce_change_pts": (
                round(v["bounce_rate"] - p["bounce_rate"], 2)
                if enough and v["bounce_rate"] is not None and p["bounce_rate"] is not None else None
            ),
            "previous_conversion_rate": p["conversion_rate"] if p else None,
            "conversion_change_pts": (
                round(v["conversion_rate"] - p["conversion_rate"], 2)
                if enough and v["conversion_rate"] is not None and p["conversion_rate"] is not None else None
            ),
            "too_few_sessions": v["sessions"] < MIN_SESSIONS,
        })
    return rows


MIN_SESSIONS_ONE_DAY = 30  # a single day has far fewer visits per page


def fetch_landing_pages(store: models.Store, days: int = 28, period: str | None = None) -> dict:
    """
    period None: last `days` complete days vs the `days` before.
    period "yesterday": yesterday vs the same weekday last week.
    period "today": today so far (live) vs the same weekday last week, full day
                    (rates like bounce % compare fine; session counts won't).
    """
    now = datetime.now(_tz(store))
    key = (store.store_url, days, period, now.date().isoformat())
    cached = _cache.get(key)
    if cached and cached[0] > time.time():
        return cached[1]

    if period == "today":
        first = last = now.date()
        p_first = p_last = first - timedelta(days=7)
        window_label = f"Today so far ({first.strftime('%a %d %b')}, as of {now.strftime('%H:%M')} store time)"
        compare_label = f"{p_first.strftime('%a %d %b')} (full day)"
    elif period == "yesterday":
        first = last = now.date() - timedelta(days=1)
        p_first = p_last = first - timedelta(days=7)
        window_label = f"Yesterday ({first.strftime('%a %d %b')}, complete day)"
        compare_label = f"{p_first.strftime('%a %d %b')} (same weekday last week)"
    else:
        period = None
        first, last, p_first, p_last = _windows(store, days)
        window_label = f"{first.strftime('%d %b')} - {last.strftime('%d %b')} (last {days} complete days)"
        compare_label = f"{p_first.strftime('%d %b')} - {p_last.strftime('%d %b')}"
    min_s = MIN_SESSIONS_ONE_DAY if period else MIN_SESSIONS
    cur_w, prev_w = _since(first, last), _since(p_first, p_last)
    H = HUMAN_SESSIONS_FILTER

    queries = {
        "pages": f"FROM sessions SHOW {SESSION_METRICS} {H}GROUP BY landing_page_path, landing_page_type {cur_w} ORDER BY sessions DESC LIMIT 200",
        "pages_prev": f"FROM sessions SHOW {SESSION_METRICS} {H}GROUP BY landing_page_path {prev_w} ORDER BY sessions DESC LIMIT 1000",
        "page_sources": f"FROM sessions SHOW sessions {H}GROUP BY landing_page_path, referrer_source {cur_w} ORDER BY sessions DESC LIMIT 1000",
        "page_sales": f"FROM sales SHOW total_sales, orders GROUP BY order_landing_page_path {cur_w} ORDER BY total_sales DESC LIMIT 1000",
        "types": f"FROM sessions SHOW {SESSION_METRICS} {H}GROUP BY landing_page_type {cur_w} ORDER BY sessions DESC",
        "types_prev": f"FROM sessions SHOW {SESSION_METRICS} {H}GROUP BY landing_page_type {prev_w} ORDER BY sessions DESC",
        "sources": f"FROM sessions SHOW {SESSION_METRICS} {H}GROUP BY referrer_source {cur_w} ORDER BY sessions DESC",
        "sources_prev": f"FROM sessions SHOW {SESSION_METRICS} {H}GROUP BY referrer_source {prev_w} ORDER BY sessions DESC",
        "devices": f"FROM sessions SHOW {SESSION_METRICS} {H}GROUP BY session_device_type {cur_w} ORDER BY sessions DESC",
        "devices_prev": f"FROM sessions SHOW {SESSION_METRICS} {H}GROUP BY session_device_type {prev_w} ORDER BY sessions DESC",
    }

    results: dict[str, list[dict] | None] = {}
    errors: dict[str, str] = {}

    def run(item):
        name, q = item
        try:
            return name, _run(store, q), None
        except Exception as exc:  # one failing query mustn't blank the page
            logger.warning("Landing query %s failed: %s", name, exc)
            return name, None, str(exc)[:300]

    with ThreadPoolExecutor(max_workers=4) as pool:
        for name, rows, err in pool.map(run, queries.items()):
            results[name] = rows
            if err:
                errors[name] = err

    if results.get("pages") is None:
        raise RuntimeError(errors.get("pages") or "Shopify landing page query failed")

    # --- landing page table -------------------------------------------------
    page_type: dict[str, str] = {}
    for r in results["pages"]:
        if r.get("landing_page_path") is not None:
            page_type.setdefault(norm_path(r["landing_page_path"]), str(r.get("landing_page_type") or "Other").strip() or "Other")
    pages = _rate_rows(results["pages"], "landing_page_path")
    prev_pages = _rate_rows(results.get("pages_prev") or [], "landing_page_path")

    top_source: dict[str, tuple[str, int]] = {}
    for r in results.get("page_sources") or []:
        if r.get("landing_page_path") is None or r.get("referrer_source") is None:
            continue
        path, s = norm_path(r["landing_page_path"]), _i(r.get("sessions"))
        if s > top_source.get(path, ("", -1))[1]:
            top_source[path] = (str(r["referrer_source"]).strip() or "Unknown", s)

    sales_ok = results.get("page_sales") is not None
    sales: dict[str, dict] = {}
    for r in results.get("page_sales") or []:
        if r.get("order_landing_page_path") is None:
            continue
        s = sales.setdefault(norm_path(r["order_landing_page_path"]), {"revenue": 0.0, "orders": 0})
        s["revenue"] += _f(r.get("total_sales")) or 0.0
        s["orders"] += _i(r.get("orders"))

    page_rows = []
    for row in _split(pages, prev_pages, min_s):
        path = row["label"]
        sale = sales.get(path)
        revenue = round(sale["revenue"], 2) if sale else (0.0 if sales_ok else None)
        src = top_source.get(path)
        flagged = row["bounce_change_pts"] is not None and row["bounce_change_pts"] >= BOUNCE_FLAG_PTS
        page_rows.append({
            "path": path,
            "page_type": page_type.get(path, "Other"),
            **{k: v for k, v in row.items() if k != "label"},
            "revenue": revenue,
            "orders": sale["orders"] if sale else (0 if sales_ok else None),
            "revenue_per_session": round(revenue / row["sessions"], 2) if revenue is not None and row["sessions"] else None,
            "top_source": src[0] if src else None,
            "top_source_share": round(src[1] / row["sessions"] * 100, 1) if src and row["sessions"] else None,
            "bounce_flag": flagged,
        })

    total_sessions = sum(p["sessions"] for p in pages.values())
    types = _split(_rate_rows(results.get("types") or [], "landing_page_type"),
                   _rate_rows(results.get("types_prev") or [], "landing_page_type"), min_s)
    for t in types:
        t["share_of_sessions"] = round(t["sessions"] / total_sessions * 100, 1) if total_sessions else None

    result = {
        "days": days,
        "period": period or f"last{days}",
        "window_label": window_label,
        "compare_label": compare_label,
        "bounce_definition": "Shopify definition: a bounce is a visit that saw only one page. Bounce rate = bounces ÷ sessions. Bots excluded.",
        "min_sessions": min_s,
        "bounce_flag_pts": BOUNCE_FLAG_PTS,
        "revenue_available": sales_ok,
        "revenue_note": (
            "Revenue = total sales of orders whose visit started on this page (Shopify's order landing page)."
            if sales_ok else "Revenue by landing page couldn't be loaded from Shopify, so it's left blank."
        ),
        "pages": page_rows,
        "page_types": types,
        "by_source": _split(_rate_rows(results.get("sources") or [], "referrer_source"),
                            _rate_rows(results.get("sources_prev") or [], "referrer_source"), min_s),
        "by_device": _split(_rate_rows(results.get("devices") or [], "session_device_type"),
                            _rate_rows(results.get("devices_prev") or [], "session_device_type"), min_s),
        "errors": errors,
    }
    _cache[key] = (time.time() + (120 if period == "today" else CACHE_SECONDS), result)
    return result
