"""
Overview extras (manager checklist, section 9 / Shopify Overview widgets):
  - Average order value over time  (ShopifyQL sales: average_order_value)
  - Sessions over time             (ShopifyQL sessions, bots excluded)
  - Total sales by sales channel   (ShopifyQL sales GROUP BY sales_channel)

Each daily series covers the last `days` complete days in store time, plus
the `days` before for the dashed "previous period" line - same as the sales
chart. Straight from Shopify Analytics, so the numbers match Shopify's own
Overview cards. Read-only, cached.
"""

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import models
from landing import _f, _i, _run, _since
from overview import _tz
from shopify_client import HUMAN_SESSIONS_FILTER

logger = logging.getLogger("overview_trends")

CACHE_SECONDS = 600
_cache: dict = {}


def fetch_overview_trends(store: models.Store, days: int = 14) -> dict:
    yesterday = datetime.now(_tz(store)).date() - timedelta(days=1)
    first = yesterday - timedelta(days=days - 1)
    p_first = first - timedelta(days=days)
    key = (store.store_url, days, yesterday.isoformat())
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]

    H = HUMAN_SESSIONS_FILTER
    queries = {
        "aov": f"FROM sales SHOW average_order_value, orders TIMESERIES day {_since(p_first, yesterday)}",
        "sessions": f"FROM sessions SHOW sessions {H}TIMESERIES day {_since(p_first, yesterday)}",
        "channels": f"FROM sales SHOW total_sales, orders GROUP BY sales_channel {_since(first, yesterday)} ORDER BY total_sales DESC",
    }
    res, errors = {}, {}

    def run(item):
        name, q = item
        try:
            return name, _run(store, q), None
        except Exception as exc:
            return name, None, str(exc)[:300]

    with ThreadPoolExecutor(max_workers=3) as pool:
        for name, rows, err in pool.map(run, queries.items()):
            res[name] = rows
            if err:
                logger.warning("Overview trends %s failed: %s", name, err)
                errors[name] = err

    by_day: dict[str, dict] = {}
    for i in range(2 * days):
        d = (p_first + timedelta(days=i)).isoformat()
        by_day[d] = {"date": d, "aov": None, "orders": 0, "sessions": None}
    for r in res.get("aov") or []:
        d = str(r.get("day") or "")[:10]
        if d in by_day:
            by_day[d]["orders"] = _i(r.get("orders"))
            by_day[d]["aov"] = round(_f(r.get("average_order_value")), 2) if by_day[d]["orders"] else None
    if res.get("sessions") is not None:
        for v in by_day.values():
            v["sessions"] = 0
        for r in res["sessions"]:
            d = str(r.get("day") or "")[:10]
            if d in by_day:
                by_day[d]["sessions"] = _i(r.get("sessions"))
    ordered = [by_day[k] for k in sorted(by_day)]
    previous, current = ordered[:days], ordered[days:]

    def total_aov(rows):
        o = sum(r["orders"] for r in rows if r["aov"] is not None)
        return round(sum(r["aov"] * r["orders"] for r in rows if r["aov"] is not None) / o, 2) if o else None

    def total_sessions(rows):
        vals = [r["sessions"] for r in rows if r["sessions"] is not None]
        return sum(vals) if vals else None

    channels = []
    rows = [r for r in (res.get("channels") or []) if r.get("sales_channel") is not None]
    total = sum(_f(r.get("total_sales")) or 0 for r in rows)
    for r in rows:
        s = _f(r.get("total_sales")) or 0
        channels.append({
            "channel": str(r["sales_channel"]).strip() or "Other",
            "total_sales": round(s, 2),
            "orders": _i(r.get("orders")),
            "share": round(s / total * 100, 1) if total else None,
        })

    out = {
        "days": days,
        "window_label": f"{first.strftime('%d %b')} - {yesterday.strftime('%d %b')} (last {days} complete days)",
        "previous_label": f"{p_first.strftime('%d %b')} - {(first - timedelta(days=1)).strftime('%d %b')}",
        "current": current,
        "previous": previous,
        "aov": {"current": total_aov(current), "previous": total_aov(previous)},
        "sessions": {"current": total_sessions(current), "previous": total_sessions(previous)},
        "channels": channels,
        "channels_total": round(total, 2),
        "errors": errors,
    }
    if not errors:
        _cache[key] = (time.time() + CACHE_SECONDS, out)
    return out
