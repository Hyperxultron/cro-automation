"""
Conversion by country and by US state (manager checklist, section 3, P2).

ShopifyQL `sessions` schema, human sessions only (same filter as the rest of
the app, so numbers match Shopify Analytics):
  dimensions: session_country, session_region (US states use
              session_country_code = 'US')
  metrics:    sessions, sessions_with_cart_additions,
              sessions_that_completed_checkout
Conversion = sessions that completed checkout / sessions (Shopify's own
definition). Compared with the same window as the other pages: yesterday vs
the same weekday last week, or the last N complete days vs the N days before.
Read-only, cached.
"""

import logging
import time
from concurrent.futures import ThreadPoolExecutor

import models
from landing import _f, _run, _since, period_windows
from shopify_client import HUMAN_SESSIONS_FILTER

logger = logging.getLogger("geo")

CACHE_SECONDS = 600
_cache: dict = {}

SHOW = "sessions, sessions_with_cart_additions, sessions_that_completed_checkout"


def _rows(raw, field):
    out: dict[str, dict] = {}
    for r in raw or []:
        if r.get(field) is None:
            continue
        k = str(r[field]).strip() or "Unknown"
        o = out.setdefault(k, {"s": 0, "c": 0, "b": 0})
        o["s"] += int(_f(r.get("sessions")) or 0)
        o["c"] += int(_f(r.get("sessions_with_cart_additions")) or 0)
        o["b"] += int(_f(r.get("sessions_that_completed_checkout")) or 0)
    return out


def _table(cur: dict, prev: dict, min_sessions: int, limit: int) -> list[dict]:
    rows = []
    for k, v in sorted(cur.items(), key=lambda kv: -kv[1]["s"])[:limit]:
        p = prev.get(k)
        cvr = round(v["b"] / v["s"] * 100, 2) if v["s"] else None
        pcvr = round(p["b"] / p["s"] * 100, 2) if p and p["s"] else None
        rows.append({
            "label": k,
            "sessions": v["s"],
            "previous_sessions": p["s"] if p else None,
            "sessions_change_pct": round((v["s"] - p["s"]) / p["s"] * 100, 1) if p and p["s"] else None,
            "added_to_cart_rate": round(v["c"] / v["s"] * 100, 2) if v["s"] else None,
            "conversion_rate": cvr,
            "previous_conversion_rate": pcvr,
            "conversion_change_pts": round(cvr - pcvr, 2) if cvr is not None and pcvr is not None else None,
            "purchases": v["b"],
            "share_of_sessions": None,
            "enough_data": v["s"] >= min_sessions and bool(p) and p["s"] >= min_sessions,
        })
    total = sum(v["s"] for v in cur.values())
    for r in rows:
        r["share_of_sessions"] = round(r["sessions"] / total * 100, 1) if total else None
    return rows


def fetch_geo(store: models.Store, period: str = "days", days: int = 28) -> dict:
    period = "yesterday" if period == "yesterday" else "days"
    if period == "yesterday":
        days = 1
    first, last, p_first, p_last, window_label, compare_label = period_windows(
        store, days, "yesterday" if period == "yesterday" else None
    )
    key = (store.store_url, period, days, first.isoformat())
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]

    H = HUMAN_SESSIONS_FILTER
    us = f"{H}AND session_country_code = 'US' "
    queries = {}
    for tag, w in (("cur", _since(first, last)), ("prev", _since(p_first, p_last))):
        queries[f"country_{tag}"] = f"FROM sessions SHOW {SHOW} {H}GROUP BY session_country {w} ORDER BY sessions DESC LIMIT 60"
        queries[f"state_{tag}"] = f"FROM sessions SHOW {SHOW} {us}GROUP BY session_region {w} ORDER BY sessions DESC LIMIT 70"

    res, errors = {}, {}

    def run(item):
        name, q = item
        try:
            return name, _run(store, q), None
        except Exception as exc:
            return name, None, str(exc)[:300]

    with ThreadPoolExecutor(max_workers=4) as pool:
        for name, rows, err in pool.map(run, queries.items()):
            res[name] = rows
            if err:
                logger.warning("Geo %s failed: %s", name, err)
                errors[name] = err

    min_seg = 50 if days <= 1 else (150 if days <= 7 else 400)
    out = {
        "period": period,
        "days": days,
        "window_label": window_label,
        "compare_label": compare_label,
        "min_segment_sessions": min_seg,
        "countries": _table(_rows(res.get("country_cur"), "session_country"),
                            _rows(res.get("country_prev"), "session_country"), min_seg, 12)
        if res.get("country_cur") is not None else None,
        "states": _table(_rows(res.get("state_cur"), "session_region"),
                         _rows(res.get("state_prev"), "session_region"), min_seg, 15)
        if res.get("state_cur") is not None else None,
        "errors": errors,
    }
    if not errors:
        _cache[key] = (time.time() + CACHE_SECONDS, out)
    return out
