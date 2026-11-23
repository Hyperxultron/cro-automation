"""
Two grids for the Landing Pages page (manager checklist, section 3, P2):

  1. Landing page x traffic source: for the top landing pages and the top
     sources, each cell = sessions, conversion rate and bounce rate of visits
     that landed on that page from that source.
  2. Device x page type: conversion, add-to-cart and bounce rate of visits by
     the type of page they landed on (home, collection, product, ...) and the
     device they used.

ShopifyQL `sessions`, human sessions only, same windows as the rest of the
Landing Pages page. Cells with few sessions are flagged so a 4-visit cell
isn't read as a trend. Read-only, cached.
"""

import logging
import time
from concurrent.futures import ThreadPoolExecutor

import models
from landing import (
    HUMAN_SESSIONS_FILTER, MIN_SESSIONS, MIN_SESSIONS_ONE_DAY, SESSION_METRICS,
    _f, _i, _run, _since, norm_path, period_windows,
)

logger = logging.getLogger("landing_grids")

CACHE_SECONDS = 600
_cache: dict = {}

TOP_PAGES = 10
TOP_SOURCES = 5


def _cells(rows, a: str, b: str) -> dict[tuple[str, str], dict]:
    out: dict[tuple[str, str], dict] = {}
    for r in rows or []:
        ra, rb = r.get(a), r.get(b)
        if ra is None or rb is None:
            continue
        ka = norm_path(ra) if a == "landing_page_path" else (str(ra).strip() or "Unknown")
        kb = str(rb).strip() or "Unknown"
        s = _i(r.get("sessions"))
        c = out.setdefault((ka, kb), {"sessions": 0, "_b": 0.0, "_a": 0.0, "_c": 0.0})
        c["sessions"] += s
        c["_b"] += (_f(r.get("bounce_rate")) or 0.0) * s
        c["_a"] += (_f(r.get("added_to_cart_rate")) or 0.0) * s
        c["_c"] += (_f(r.get("conversion_rate")) or 0.0) * s
    return out


def _finish(c: dict | None, min_s: int) -> dict:
    if not c or not c["sessions"]:
        return {"sessions": 0, "bounce_rate": None, "added_to_cart_rate": None, "conversion_rate": None, "enough_data": False}
    s = c["sessions"]
    return {
        "sessions": s,
        "bounce_rate": round(c["_b"] / s * 100, 2),
        "added_to_cart_rate": round(c["_a"] / s * 100, 2),
        "conversion_rate": round(c["_c"] / s * 100, 2),
        "enough_data": s >= min_s,
    }


def _grid(cells: dict, rows_order: list[str], cols_order: list[str], min_s: int) -> dict:
    def total(keys):
        t = {"sessions": 0, "_b": 0.0, "_a": 0.0, "_c": 0.0}
        for k in keys:
            c = cells.get(k)
            if c:
                for f in t:
                    t[f] += c[f]
        return t
    return {
        "rows": rows_order,
        "columns": cols_order,
        "cells": [[_finish(cells.get((r, c)), min_s) for c in cols_order] for r in rows_order],
        "row_totals": [_finish(total([(r, c) for c in cols_order]), min_s) for r in rows_order],
        "column_totals": [_finish(total([(r, c) for r in rows_order]), min_s) for c in cols_order],
    }


def fetch_landing_grids(store: models.Store, days: int = 28, period: str | None = None, start=None, end=None) -> dict:
    custom = start is not None and end is not None
    period = period if period in ("today", "yesterday") and not custom else None
    if custom:
        days = (end - start).days + 1
    first, last, _pf, _pl, window_label, _cl = period_windows(store, days, period, start, end)
    key = (store.store_url, days, period, first.isoformat(), last.isoformat())
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]

    min_s = MIN_SESSIONS_ONE_DAY if period or (custom and days < 7) else MIN_SESSIONS
    w = _since(first, last)
    H = HUMAN_SESSIONS_FILTER
    queries = {
        "page_source": f"FROM sessions SHOW {SESSION_METRICS} {H}GROUP BY landing_page_path, referrer_source {w} ORDER BY sessions DESC LIMIT 1000",
        "type_device": f"FROM sessions SHOW {SESSION_METRICS} {H}GROUP BY landing_page_type, session_device_type {w} ORDER BY sessions DESC LIMIT 200",
    }
    res, errors = {}, {}

    def run(item):
        name, q = item
        try:
            return name, _run(store, q), None
        except Exception as exc:
            return name, None, str(exc)[:300]

    with ThreadPoolExecutor(max_workers=2) as pool:
        for name, rows, err in pool.map(run, queries.items()):
            res[name] = rows
            if err:
                logger.warning("Landing grid %s failed: %s", name, err)
                errors[name] = err

    def ranked(cells, idx):
        tot: dict[str, int] = {}
        for k, v in cells.items():
            tot[k[idx]] = tot.get(k[idx], 0) + v["sessions"]
        return [k for k, _ in sorted(tot.items(), key=lambda kv: -kv[1])]

    ps = _cells(res.get("page_source"), "landing_page_path", "referrer_source") if res.get("page_source") is not None else None
    td = _cells(res.get("type_device"), "landing_page_type", "session_device_type") if res.get("type_device") is not None else None

    out = {
        "days": days,
        "period": "custom" if custom else (period or f"last{days}"),
        "window_label": window_label,
        "min_sessions": min_s,
        # cell min is lower than the page min: a grid splits traffic many ways
        "page_source": _grid(ps, ranked(ps, 0)[:TOP_PAGES], ranked(ps, 1)[:TOP_SOURCES], max(20, min_s // 3)) if ps is not None else None,
        "type_device": _grid(td, ranked(td, 0)[:8], ranked(td, 1)[:4], max(20, min_s // 3)) if td is not None else None,
        "errors": errors,
    }
    if not errors:
        _cache[key] = (time.time() + CACHE_SECONDS, out)
    return out
