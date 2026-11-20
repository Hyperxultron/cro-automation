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


def fetch_buy_heatmap(store: models.Store, days: int = 28) -> dict:
    from funnel import _local_hour

    tz = _tz(store)
    last = datetime.now(tz).date() - timedelta(days=1)
    first = last - timedelta(days=days - 1)

    def build():
        # one extra day either side: UTC hour buckets spill over store-time days
        rows = _run(
            store,
            "FROM sessions SHOW sessions, sessions_that_completed_checkout "
            f"{HUMAN_SESSIONS_FILTER}TIMESERIES hour "
            f"{_since(first - timedelta(days=1), last + timedelta(days=1))}",
        )
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
        cells = [
            {
                "weekday": w,
                "hour": h,
                "sessions": s,
                "orders": o,
                "cvr": round(o / s * 100, 2) if s >= 20 else None,  # too few visits = no colour
            }
            for (w, h), (s, o) in sorted(grid.items())
        ]
        total_s = sum(c["sessions"] for c in cells)
        total_o = sum(c["orders"] for c in cells)
        return {
            "days": days,
            "window_label": f"{first.strftime('%d %b')} - {last.strftime('%d %b')} (last {days} complete days, store time)",
            "weekdays": list(WEEKDAYS),
            "cells": cells,
            "hours_with_data": seen,
            "average_cvr": round(total_o / total_s * 100, 2) if total_s else None,
        }

    return _cached(("heat", store.store_url, days, last.isoformat()), 1800, build)
