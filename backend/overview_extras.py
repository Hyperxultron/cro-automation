"""
Extra Overview charts for the Ocean Pro design, all from Shopify Analytics
(ShopifyQL `sessions`, bots excluded, read-only):

  fetch_device_funnel(store, period)
      Sessions -> added to cart -> reached checkout -> completed checkout,
      split by device (Mobile / Desktop / Tablet), for Today / Yesterday /
      Last 7 days. Feeds the funnel's All / Mobile / Desktop switch.

  fetch_buy_heatmap(store, days)
      Conversion rate by weekday x hour (store time) over the last `days`
      complete days. Shopify returns hour buckets as UTC timestamps, so each
      one is converted to store time before it is placed in the grid.
"""

import logging
import time
from datetime import datetime, timedelta

import models
from landing import _i, _run, _since, period_windows
from overview import _tz
from shopify_client import HUMAN_SESSIONS_FILTER

logger = logging.getLogger("overview_extras")
_cache: dict = {}

STEPS = (
    ("sessions", "sessions"),
    ("added_to_cart", "sessions_with_cart_additions"),
    ("reached_checkout", "sessions_that_reached_checkout"),
    ("completed_checkout", "sessions_that_completed_checkout"),
)
SHOW = ", ".join(f for _, f in STEPS)


def _cached(key, seconds, fn):
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    val = fn()
    _cache[key] = (time.time() + seconds, val)
    return val


def fetch_device_funnel(store: models.Store, period: str = "yesterday") -> dict:
    period = period if period in ("today", "yesterday", "last7") else "yesterday"
    first, last, _pf, _pl, window_label, _cl = period_windows(
        store, 7, None if period == "last7" else period
    )

    def build():
        rows = _run(
            store,
            f"FROM sessions SHOW {SHOW} {HUMAN_SESSIONS_FILTER}"
            f"GROUP BY session_device_type {_since(first, last)} ORDER BY sessions DESC",
        )
        devices = {}
        for r in rows:
            label = r.get("session_device_type")
            if label is None:
                continue  # totals row
            label = str(label).strip().title() or "Unknown"
            d = devices.setdefault(label, {k: 0 for k, _ in STEPS})
            for k, f in STEPS:
                d[k] += _i(r.get(f))
        return {"period": period, "window_label": window_label, "devices": devices}

    day = datetime.now(_tz(store)).date().isoformat()
    return _cached(("devfun", store.store_url, period, day), 120 if period == "today" else 600, build)


WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def _hour_rows(store: models.Store, first, last) -> list[dict]:
    """Hourly session rows for first..last (store days), asked for in 7-day
    pieces: one long hourly query was refused live, while the 9-day hourly
    query the Today funnel uses works. One extra day either side because UTC
    hour buckets spill over store-time days."""
    from concurrent.futures import ThreadPoolExecutor

    chunks = []
    a = first
    while a <= last:
        b = min(a + timedelta(days=6), last)
        chunks.append((a, b))
        a = b + timedelta(days=1)

    def one(ab):
        a, b = ab
        return _run(
            store,
            "FROM sessions SHOW sessions, sessions_that_completed_checkout "
            f"{HUMAN_SESSIONS_FILTER}TIMESERIES hour "
            f"{_since(a - timedelta(days=1), b + timedelta(days=1))}",
        )

    with ThreadPoolExecutor(max_workers=4) as pool:
        parts = list(pool.map(one, chunks))
    # chunks overlap by the spill-over days: keep each UTC hour once
    seen, rows = set(), []
    for part in parts:
        for r in part:
            k = str(r.get("hour"))
            if k not in seen:
                seen.add(k)
                rows.append(r)
    return rows


def fetch_buy_heatmap(store: models.Store, days: int = 28, db=None) -> dict:
    """
    Conversion rate by weekday x hour from Shopify sessions. If Shopify's
    hourly data can't be read, falls back to our synced orders (order time in
    store time zone) and shows order counts per hour instead.
    """
    from funnel import _local_hour

    tz = _tz(store)
    last = datetime.now(tz).date() - timedelta(days=1)
    first = last - timedelta(days=days - 1)
    label = f"{first.strftime('%d %b')} - {last.strftime('%d %b')} (last {days} complete days, store time)"

    def from_sessions():
        rows = _hour_rows(store, first, last)
        grid = {(w, h): [0, 0] for w in range(7) for h in range(24)}
        seen = 0
        for r in rows:
            t = _local_hour(r.get("hour"), tz)
            if t is None or not (first <= t.date() <= last):
                continue
            cell = grid[(t.weekday(), t.hour)]
            cell[0] += _i(r.get("sessions"))
            cell[1] += _i(r.get("sessions_that_completed_checkout"))
            seen += 1
        if not seen:
            raise ValueError("no hourly rows returned")
        cells = [
            {"weekday": w, "hour": h, "sessions": s, "orders": o,
             "cvr": round(o / s * 100, 2) if s >= 20 else None}  # too few visits = no colour
            for (w, h), (s, o) in sorted(grid.items())
        ]
        ts = sum(c["sessions"] for c in cells)
        to = sum(c["orders"] for c in cells)
        return {"metric": "cvr", "source": "shopify_sessions", "days": days, "window_label": label,
                "weekdays": list(WEEKDAYS), "cells": cells, "hours_with_data": seen,
                "average_cvr": round(to / ts * 100, 2) if ts else None, "note": None}

    def from_orders(reason: str):
        from overview import _day_bounds_utc

        start, _ = _day_bounds_utc(first, tz)
        _, end = _day_bounds_utc(last, tz)
        q = (
            db.query(models.Order.created_at)
            .filter(
                models.Order.store_id == store.id,
                models.Order.shopify_order_id.isnot(None),
                models.Order.cancelled_at.is_(None),
                models.Order.created_at >= start,
                models.Order.created_at < end,
            )
        )
        grid = {(w, h): 0 for w in range(7) for h in range(24)}
        total = 0
        for (created,) in q:
            if created is None:
                continue
            if created.tzinfo is None:
                from datetime import timezone as _utc
                created = created.replace(tzinfo=_utc.utc)
            t = created.astimezone(tz)
            grid[(t.weekday(), t.hour)] += 1
            total += 1
        cells = [{"weekday": w, "hour": h, "sessions": 0, "orders": n, "cvr": None}
                 for (w, h), n in sorted(grid.items())]
        return {"metric": "orders", "source": "synced_orders", "days": days, "window_label": label,
                "weekdays": list(WEEKDAYS), "cells": cells, "hours_with_data": total,
                "average_cvr": None, "total_orders": total,
                "note": "Shopify's hourly visit data couldn't be read, so this shows when orders were placed "
                        "(from our synced orders) instead of conversion rate.",
                "error": reason[:200]}

    def build():
        try:
            return from_sessions()
        except Exception as exc:
            logger.warning("Hourly sessions heatmap failed, using orders: %s", exc)
            if db is None:
                raise
            return from_orders(str(exc))

    return _cached(("heat", store.store_url, days, last.isoformat()), 1800, build)


def fetch_kpi_totals(db, store: models.Store) -> dict:
    """
    Total sales and total sessions for Today (so far), Yesterday and the last
    30 complete days - for the two Overview tiles. Both straight from Shopify
    Analytics (sales = Shopify's "Total sales", sessions = human sessions), so
    they match Shopify's own reports. Sales fall back to synced orders if
    ShopifyQL fails.
    """
    from shopify_sales import daily_sales

    tz = _tz(store)
    today = datetime.now(tz).date()
    yesterday = today - timedelta(days=1)
    first30 = yesterday - timedelta(days=29)

    def ranges_label():
        return {
            "today": f"Today so far ({today.strftime('%a %d %b')})",
            "yesterday": f"Yesterday ({yesterday.strftime('%a %d %b')})",
            "last30": f"Last 30 days ({first30.strftime('%d %b')} - {yesterday.strftime('%d %b')})",
        }

    def sales():
        try:
            days = daily_sales(store, first30, today)
            tot = lambda a, b: round(sum(v["total"] for k, v in days.items() if a.isoformat() <= k <= b.isoformat()), 2)  # noqa: E731
            return {"today": tot(today, today), "yesterday": tot(yesterday, yesterday),
                    "last30": tot(first30, yesterday), "source": "shopify"}
        except Exception as exc:
            logger.warning("KPI sales from ShopifyQL failed, using synced orders: %s", exc)
            from overview import _day_bounds_utc
            from sales import _sales_stats

            def rng(a, b):
                s, _ = _day_bounds_utc(a, tz)
                _, e = _day_bounds_utc(b, tz)
                return _sales_stats(db, store, s, e)["total"]
            return {"today": rng(today, today), "yesterday": rng(yesterday, yesterday),
                    "last30": rng(first30, yesterday), "source": "orders"}

    def sessions():
        try:
            rows = _run(
                store,
                f"FROM sessions SHOW sessions {HUMAN_SESSIONS_FILTER}TIMESERIES day {_since(first30, today)}",
            )
            by = {str(r.get("day") or "")[:10]: _i(r.get("sessions")) for r in rows if r.get("day")}
            tot = lambda a, b: sum(v for k, v in by.items() if a.isoformat() <= k <= b.isoformat())  # noqa: E731
            return {"today": tot(today, today), "yesterday": tot(yesterday, yesterday),
                    "last30": tot(first30, yesterday), "source": "shopify"}
        except Exception as exc:
            logger.warning("KPI sessions failed: %s", exc)
            return {"today": None, "yesterday": None, "last30": None, "source": None, "error": str(exc)[:200]}

    def build():
        return {"labels": ranges_label(), "sales": sales(), "sessions": sessions()}

    return _cached(("kpi", store.store_url, today.isoformat()), 120, build)
