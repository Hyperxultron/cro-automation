"""
Session-to-purchase funnel (Shopify Analytics / ShopifyQL).

Sessions -> Added to Cart -> Reached Checkout -> Completed Checkout (purchase).
Result 10 minute cache (sessions.py jaisa pattern).
"""

import time
from zoneinfo import ZoneInfo
from datetime import datetime

import models
from shopify_client import HUMAN_SESSIONS_FILTER, graphql

FUNNEL_QUERY = """
query Funnel($q: String!) {
  shopifyqlQuery(query: $q) {
    tableData { columns { name dataType } rows }
    parseErrors
  }
}
"""

CACHE_SECONDS = 600
_cache: dict[str, tuple[float, dict]] = {}


def _to_int(value) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def fetch_funnel(store: models.Store, days: int = 1) -> dict:
    """
    Pichhle poore din (default: kal) ka session-to-purchase funnel.
    """
    key = f"{store.store_url}:{days}"
    cached = _cache.get(key)
    if cached and cached[0] > time.time():
        return cached[1]

    q = (
        "FROM sessions SHOW sessions, sessions_with_cart_additions, "
        "sessions_that_reached_checkout, sessions_that_completed_checkout "
        f"{HUMAN_SESSIONS_FILTER}"
        f"TIMESERIES day SINCE -{days + 1}d UNTIL today ORDER BY day DESC"
    )
    data = graphql(store.store_url, FUNNEL_QUERY, {"q": q})["shopifyqlQuery"]
    if data.get("parseErrors"):
        raise ValueError(f"ShopifyQL error: {data['parseErrors']}")

    tz = ZoneInfo(store.timezone or "UTC")
    today = datetime.now(tz).date().isoformat()

    rows = (data.get("tableData") or {}).get("rows") or []
    result = None
    for row in rows:
        day = str(row.get("day", ""))[:10]
        if not day or day >= today:
            continue  # aaj ka adhoora din skip
        sessions = _to_int(row.get("sessions"))
        cart = _to_int(row.get("sessions_with_cart_additions"))
        checkout = _to_int(row.get("sessions_that_reached_checkout"))
        purchased = _to_int(row.get("sessions_that_completed_checkout"))
        result = {
            "date": day,
            "sessions": sessions,
            "added_to_cart": cart,
            "reached_checkout": checkout,
            "completed_checkout": purchased,
            "cart_rate": round(cart / sessions * 100, 1) if sessions else None,
            "checkout_rate": round(checkout / sessions * 100, 1) if sessions else None,
            "conversion_rate": round(purchased / sessions * 100, 1) if sessions else None,
        }
        break  # sabse recent poora din mil gaya

    result = result or {
        "date": None, "sessions": 0, "added_to_cart": 0, "reached_checkout": 0,
        "completed_checkout": 0, "cart_rate": None, "checkout_rate": None, "conversion_rate": None,
    }
    _cache[key] = (time.time() + CACHE_SECONDS, result)
    return result


def fetch_funnel_trend(store: models.Store, days: int = 7) -> list[dict]:
    """
    Pichhle `days` poore din (aaj ko chhod kar) ka funnel, day-wise - trend chart ke liye.
    """
    key = f"trend:{store.store_url}:{days}"
    cached = _cache.get(key)
    if cached and cached[0] > time.time():
        return cached[1]

    q = (
        "FROM sessions SHOW sessions, sessions_with_cart_additions, "
        "sessions_that_reached_checkout, sessions_that_completed_checkout "
        f"{HUMAN_SESSIONS_FILTER}"
        f"TIMESERIES day SINCE -{days + 1}d UNTIL today ORDER BY day ASC"
    )
    data = graphql(store.store_url, FUNNEL_QUERY, {"q": q})["shopifyqlQuery"]
    if data.get("parseErrors"):
        raise ValueError(f"ShopifyQL error: {data['parseErrors']}")

    tz = ZoneInfo(store.timezone or "UTC")
    today = datetime.now(tz).date().isoformat()

    rows = (data.get("tableData") or {}).get("rows") or []
    result = []
    for row in rows:
        day = str(row.get("day", ""))[:10]
        if not day or day >= today:
            continue
        sessions = _to_int(row.get("sessions"))
        cart = _to_int(row.get("sessions_with_cart_additions"))
        checkout = _to_int(row.get("sessions_that_reached_checkout"))
        purchased = _to_int(row.get("sessions_that_completed_checkout"))
        result.append(
            {
                "date": day,
                "sessions": sessions,
                "added_to_cart": cart,
                "reached_checkout": checkout,
                "completed_checkout": purchased,
                "cart_rate": round(cart / sessions * 100, 1) if sessions else None,
                "checkout_rate": round(checkout / sessions * 100, 1) if sessions else None,
                "conversion_rate": round(purchased / sessions * 100, 1) if sessions else None,
                "cart_abandonment_rate": round((cart - purchased) / cart * 100, 1) if cart else None,
                "checkout_abandonment_rate": round((checkout - purchased) / checkout * 100, 1) if checkout else None,
            }
        )
    result = result[-days:]
    _cache[key] = (time.time() + CACHE_SECONDS, result)
    return result


# ---------------------------------------------------------------------------
# Full funnel with a product-view step and a comparison window
# (manager checklist: section 2 "Mini funnel: sessions -> product view -> add
# to cart -> reached checkout -> purchased, with step % vs last week" and
# section 3 "Full funnel with step-to-step % and the previous period alongside").
#
# Daily rows are pulled once (TIMESERIES day) and summed in Python, so "which
# days are in the window" is decided here, with today's partial day always
# excluded - no reliance on how SINCE/UNTIL treat the edges.
# ---------------------------------------------------------------------------

from datetime import timedelta

DAILY_DAYS = 16  # enough for "last 7 vs prior 7" plus the edge days


def _is_true(value) -> bool:
    return str(value).strip().lower() in ("true", "1", "yes")


def _daily_funnel(store: models.Store) -> tuple[dict[str, dict], bool]:
    """
    {date: {sessions, product_views, added_to_cart, reached_checkout, completed_checkout}}
    for the last DAILY_DAYS complete days, plus whether product views were available.
    """
    key = f"daily:{store.store_url}"
    cached = _cache.get(key)
    if cached and cached[0] > time.time():
        return cached[1]

    tz = ZoneInfo(store.timezone or "UTC")
    today = datetime.now(tz).date().isoformat()

    q = (
        "FROM sessions SHOW sessions, sessions_with_cart_additions, "
        "sessions_that_reached_checkout, sessions_that_completed_checkout "
        f"{HUMAN_SESSIONS_FILTER}"
        f"TIMESERIES day SINCE -{DAILY_DAYS + 1}d UNTIL today ORDER BY day ASC"
    )
    data = graphql(store.store_url, FUNNEL_QUERY, {"q": q})["shopifyqlQuery"]
    if data.get("parseErrors"):
        raise ValueError(f"ShopifyQL error: {data['parseErrors']}")

    days: dict[str, dict] = {}
    for row in (data.get("tableData") or {}).get("rows") or []:
        day = str(row.get("day", ""))[:10]
        if not day or day >= today:
            continue
        days[day] = {
            "sessions": _to_int(row.get("sessions")),
            "product_views": None,
            "added_to_cart": _to_int(row.get("sessions_with_cart_additions")),
            "reached_checkout": _to_int(row.get("sessions_that_reached_checkout")),
            "completed_checkout": _to_int(row.get("sessions_that_completed_checkout")),
        }

    # Sessions that viewed a product: same sessions schema, split by the
    # session_viewed_product flag. If Shopify rejects it, the funnel still
    # works and the step is shown as unavailable rather than guessed.
    product_views_available = False
    try:
        pv_q = (
            "FROM sessions SHOW sessions "
            f"{HUMAN_SESSIONS_FILTER}"
            "GROUP BY session_viewed_product "
            f"TIMESERIES day SINCE -{DAILY_DAYS + 1}d UNTIL today ORDER BY day ASC"
        )
        pv = graphql(store.store_url, FUNNEL_QUERY, {"q": pv_q})["shopifyqlQuery"]
        if not pv.get("parseErrors"):
            for row in (pv.get("tableData") or {}).get("rows") or []:
                day = str(row.get("day", ""))[:10]
                if day in days and _is_true(row.get("session_viewed_product")):
                    days[day]["product_views"] = _to_int(row.get("sessions"))
                    product_views_available = True
            if product_views_available:
                for d in days.values():
                    if d["product_views"] is None:
                        d["product_views"] = 0
    except Exception:
        product_views_available = False

    result = (days, product_views_available)
    _cache[key] = (time.time() + CACHE_SECONDS, result)
    return result


FUNNEL_STEPS = [
    ("sessions", "Sessions"),
    ("product_views", "Viewed a product"),
    ("added_to_cart", "Added to cart"),
    ("reached_checkout", "Reached checkout"),
    ("completed_checkout", "Purchased"),
]


def _sum_window(days: dict[str, dict], dates: list[str], pv_available: bool) -> dict | None:
    rows = [days[d] for d in dates if d in days]
    if len(rows) != len(dates):
        return None  # incomplete window - don't compare against partial data
    out = {}
    for key, _ in FUNNEL_STEPS:
        if key == "product_views" and not pv_available:
            out[key] = None
        else:
            out[key] = sum(r[key] or 0 for r in rows)
    return out


def _rate(num, den):
    return round(num / den * 100, 2) if num is not None and den else None


def _local_hour(raw, tz: ZoneInfo) -> datetime | None:
    """
    An hourly ShopifyQL timestamp as a store-local datetime.

    Shopify returns hour buckets as UTC timestamps, so "2026-11-20T02:00Z" is
    really 19 Nov 21:00 in New York. Reading the first 10 characters as the
    date (what the first version did) put the last ~5 hours of yesterday into
    "today": 493 sessions at 00:28 instead of 27.
    """
    text_ = str(raw or "").strip()
    if len(text_) < 13:
        return None
    try:
        dt = datetime.fromisoformat(text_.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC"))
    return dt.astimezone(tz)


_FUNNEL_SHOW = (
    "sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout"
)


def _add_row(target: dict, row: dict) -> None:
    target["sessions"] += _to_int(row.get("sessions"))
    target["added_to_cart"] += _to_int(row.get("sessions_with_cart_additions"))
    target["reached_checkout"] += _to_int(row.get("sessions_that_reached_checkout"))
    target["completed_checkout"] += _to_int(row.get("sessions_that_completed_checkout"))


def _q(store: models.Store, q: str) -> list[dict]:
    data = graphql(store.store_url, FUNNEL_QUERY, {"q": q})["shopifyqlQuery"]
    if data.get("parseErrors"):
        raise ValueError(f"ShopifyQL error: {data['parseErrors']}")
    return (data.get("tableData") or {}).get("rows") or []


def _today_funnel(store: models.Store):
    """
    Today so far, in the store's time zone - same numbers as Shopify's
    "Conversion rate breakdown" for Today.

    Today's totals come from a plain day query (SINCE today UNTIL today), which
    Shopify already cuts at store midnight. The comparison (same weekday last
    week, up to the same hour) needs hourly rows; those are converted from UTC
    to store time, and if they don't add up to today's day total the
    comparison is dropped rather than shown wrong.
    Returns (current, previous_or_None, product_views_available, now_local).
    """
    tz = ZoneInfo(store.timezone or "UTC")
    now = datetime.now(tz)
    today = now.date()
    lw = today - timedelta(days=7)
    key = f"today:{store.store_url}:{today.isoformat()}"
    cached = _cache.get(key)
    if cached and cached[0] > time.time():
        return cached[1]

    empty = lambda: {k: 0 for k, _ in FUNNEL_STEPS}  # noqa: E731
    day_w = f"SINCE {today.isoformat()} UNTIL {today.isoformat()}"

    # 1. Today's totals (authoritative).
    cur = empty()
    for row in _q(store, f"FROM sessions SHOW {_FUNNEL_SHOW} {HUMAN_SESSIONS_FILTER}{day_w}"):
        _add_row(cur, row)

    pv_available = False
    try:
        for row in _q(store, f"FROM sessions SHOW sessions {HUMAN_SESSIONS_FILTER}GROUP BY session_viewed_product {day_w}"):
            if _is_true(row.get("session_viewed_product")):
                cur["product_views"] += _to_int(row.get("sessions"))
            pv_available = True
    except Exception:
        pv_available = False

    # 2. Same weekday last week up to the same hour (hourly, UTC -> store time).
    prev = empty()
    check = 0  # today's sessions rebuilt from hourly rows, to verify the conversion
    try:
        window = f"SINCE {(lw - timedelta(days=1)).isoformat()} UNTIL {today.isoformat()}"
        for row in _q(store, f"FROM sessions SHOW {_FUNNEL_SHOW} {HUMAN_SESSIONS_FILTER}TIMESERIES hour {window}"):
            t = _local_hour(row.get("hour"), tz)
            if t is None:
                continue
            if t.date() == today:
                check += _to_int(row.get("sessions"))
            elif t.date() == lw and t.hour <= now.hour:
                _add_row(prev, row)
        if pv_available:
            for row in _q(store, f"FROM sessions SHOW sessions {HUMAN_SESSIONS_FILTER}GROUP BY session_viewed_product TIMESERIES hour {window}"):
                t = _local_hour(row.get("hour"), tz)
                if t and t.date() == lw and t.hour <= now.hour and _is_true(row.get("session_viewed_product")):
                    prev["product_views"] += _to_int(row.get("sessions"))
        # Hourly rows must rebuild today's total (allow a few sessions of lag).
        if abs(check - cur["sessions"]) > max(5, cur["sessions"] * 0.05) or not prev["sessions"]:
            prev = None
    except Exception:
        prev = None

    if not pv_available:
        cur["product_views"] = None
        if prev is not None:
            prev["product_views"] = None

    result = (cur, prev, pv_available, now)
    _cache[key] = (time.time() + 120, result)  # live view: 2 minute cache
    return result


def fetch_funnel_compare(store: models.Store, period: str = "yesterday") -> dict:
    """
    period "yesterday": yesterday vs the same weekday last week.
    period "last7": last 7 complete days vs the 7 days before.
    Each step has its count, % of sessions, step-to-step % (vs the previous
    available step), and the same numbers for the comparison window.
    """
    tz = ZoneInfo(store.timezone or "UTC")
    yesterday = datetime.now(tz).date() - timedelta(days=1)

    if period == "today":
        current, previous, pv_available, now = _today_funnel(store)
        lw = now.date() - timedelta(days=7)
        period_label = f"Today so far ({now.strftime('%a %d %b')}, as of {now.strftime('%H:%M')} store time)"
        compare_label = (
            f"vs {lw.strftime('%a %d %b')} up to the same hour" if previous is not None
            else "no comparison available"
        )
    else:
        days, pv_available = _daily_funnel(store)

    if period == "today":
        pass
    elif period == "last7":
        cur_dates = [(yesterday - timedelta(days=i)).isoformat() for i in range(7)]
        prev_dates = [(yesterday - timedelta(days=i)).isoformat() for i in range(7, 14)]
        period_label = f"Last 7 days ({(yesterday - timedelta(days=6)).strftime('%d %b')} - {yesterday.strftime('%d %b')})"
        compare_label = "vs prior 7 days"
    else:
        period = "yesterday"
        cur_dates = [yesterday.isoformat()]
        last_week = yesterday - timedelta(days=7)
        prev_dates = [last_week.isoformat()]
        period_label = f"Yesterday ({yesterday.strftime('%a %d %b')})"
        compare_label = f"vs {last_week.strftime('%a %d %b')} (same weekday last week)"

    if period != "today":
        current = _sum_window(days, cur_dates, pv_available)
        previous = _sum_window(days, prev_dates, pv_available)

    steps = []
    prev_key = None
    for key, label in FUNNEL_STEPS:
        value = current[key] if current else None
        prev_value = previous[key] if previous else None
        if key == "product_views" and not pv_available:
            steps.append({"key": key, "label": label, "available": False, "value": None,
                          "pct_of_sessions": None, "step_pct": None,
                          "previous_value": None, "previous_step_pct": None, "step_change_pts": None})
            continue
        step_pct = _rate(value, current[prev_key]) if (current and prev_key) else None
        prev_step_pct = _rate(prev_value, previous[prev_key]) if (previous and prev_key) else None
        steps.append({
            "key": key,
            "label": label,
            "available": True,
            "value": value,
            "pct_of_sessions": _rate(value, current["sessions"]) if current else None,
            "step_pct": step_pct,
            "previous_value": prev_value,
            "previous_step_pct": prev_step_pct,
            "step_change_pts": (
                round(step_pct - prev_step_pct, 2)
                if step_pct is not None and prev_step_pct is not None else None
            ),
        })
        prev_key = key

    return {
        "period": period,
        "period_label": period_label,
        "compare_label": compare_label,
        "product_views_available": pv_available,
        # Same threshold as the Overview: below ~500 sessions a step change is noise.
        "too_early": (current or {}).get("sessions", 0) < 500,
        "steps": steps,
    }
