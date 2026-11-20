"""
Sales money numbers straight from Shopify Analytics (ShopifyQL `sales`), so
the dashboard's Total sales matches Shopify's own reports to the cent.

Why not our synced orders: Shopify books a refund / return (and the tax
given back with it) on the day the refund happens, not on the day of the
original order. Summing orders by their order date can't do that, so on a
day with refunds our "Total sales" was too high (19 Nov: $8,272 vs Shopify
$7,957.93, the gap being $307.06 of sales reversals plus their tax).

Everything here is read-only and cached. If ShopifyQL fails, callers fall
back to the old order-based numbers and say so.
"""

import logging
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import models

logger = logging.getLogger("shopify_sales")

SHOW = "orders, gross_sales, discounts, returns, net_sales, shipping_charges, taxes, total_sales"
KEYS = ("gross", "discounts", "returns", "net", "shipping", "tax", "total", "orders")

_cache: dict = {}


def _num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _row(r: dict) -> dict:
    # Shopify gives discounts / returns as negative amounts; we keep them
    # positive (the UI shows them with a minus sign).
    return {
        "gross": _num(r.get("gross_sales")),
        "discounts": abs(_num(r.get("discounts"))),
        "returns": abs(_num(r.get("returns"))),
        "net": _num(r.get("net_sales")),
        "shipping": _num(r.get("shipping_charges")),
        "tax": _num(r.get("taxes")),
        "total": _num(r.get("total_sales")),
        "orders": int(_num(r.get("orders"))),
    }


def _empty() -> dict:
    return {k: 0.0 for k in KEYS} | {"orders": 0}


def add(rows: list[dict]) -> dict:
    out = _empty()
    for r in rows:
        for k in KEYS:
            out[k] += r[k]
    return {k: (round(v, 2) if k != "orders" else int(v)) for k, v in out.items()}


def daily_sales(store: models.Store, first: date, last: date) -> dict[str, dict]:
    """{"YYYY-MM-DD": {gross, discounts, returns, net, shipping, tax, total, orders}}
    for each store-time day first..last (days with no sales are zeros).
    Raises if ShopifyQL fails - callers decide the fallback."""
    from landing import _run  # lazy: landing imports overview

    today = datetime.now(ZoneInfo(store.timezone or "UTC")).date()
    key = ("day", store.store_url, first.isoformat(), last.isoformat())
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    rows = _run(store, f"FROM sales SHOW {SHOW} TIMESERIES day SINCE {first.isoformat()} UNTIL {last.isoformat()}")
    out = {}
    n = (last - first).days + 1
    for i in range(n):
        out[(first + timedelta(days=i)).isoformat()] = _empty()
    for r in rows:
        d = str(r.get("day") or "")[:10]
        if d in out:
            out[d] = _row(r)
    _cache[key] = (time.time() + (120 if last >= today else 600), out)
    return out


def sales_until(store: models.Store, day: date, cutoff_local: datetime, tz: ZoneInfo) -> dict:
    """Sales on `day` (store time) from midnight up to `cutoff_local` - for the
    "same time last week" comparison of Today. Hour buckets come back as UTC
    timestamps, so each is converted to store time first."""
    from funnel import _local_hour
    from landing import _run

    key = ("hour", store.store_url, day.isoformat(), cutoff_local.strftime("%Y%m%d%H"))
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    rows = _run(
        store,
        f"FROM sales SHOW {SHOW} TIMESERIES hour "
        f"SINCE {(day - timedelta(days=1)).isoformat()} UNTIL {(day + timedelta(days=1)).isoformat()}",
    )
    picked = []
    for r in rows:
        h = _local_hour(r.get("hour"), tz)
        if h is None or h.date() != day:
            continue
        if h.replace(tzinfo=None) <= cutoff_local.replace(tzinfo=None):
            picked.append(_row(r))
    out = add(picked)
    _cache[key] = (time.time() + 120, out)
    return out


def window_money(store: models.Store, period: str, compare: str, target_date: date, now_local: datetime) -> tuple[dict, dict]:
    """
    (current, baseline) sales money for the same windows /dashboard/overview
    and the breakdown use:
      today     - today so far vs the same weekday last week up to the same time
      last7     - the 7 days ending target_date vs the 7 days before
      yesterday - target_date vs the same weekday last week (compare="last_week")
                  or the average of the 4 previous same weekdays (default)
    One daily query covers every window. Raises on ShopifyQL errors.
    """
    tz = ZoneInfo(store.timezone or "UTC")
    if period == "today":
        cur = daily_sales(store, target_date, target_date)[target_date.isoformat()]
        lw = target_date - timedelta(days=7)
        cutoff = now_local - timedelta(days=7)
        return cur, sales_until(store, lw, cutoff, tz)
    first = target_date - timedelta(days=28)
    days = daily_sales(store, first, target_date)

    def span(a: date, b: date) -> dict:
        return add([days[(a + timedelta(days=i)).isoformat()] for i in range((b - a).days + 1)])

    if period == "last7":
        return (span(target_date - timedelta(days=6), target_date),
                span(target_date - timedelta(days=13), target_date - timedelta(days=7)))
    cur = days[target_date.isoformat()]
    if compare == "last_week":
        return cur, days[(target_date - timedelta(days=7)).isoformat()]
    weeks = [days[(target_date - timedelta(days=7 * w)).isoformat()] for w in range(1, 5)]
    total = add(weeks)
    return cur, {k: (round(v / 4, 2) if k != "orders" else round(v / 4, 1)) for k, v in total.items()}
