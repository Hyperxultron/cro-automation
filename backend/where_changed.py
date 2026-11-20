"""
Overview "Where it changed" + "Top movers" (manager checklist, section 2, P2).

For the chosen window (yesterday vs the same weekday last week, or the last
7 / 28 complete days vs the same number of days before) we split sessions and
conversion by device and by channel, straight from Shopify Analytics with
bots excluded, so every number matches Shopify's own reports.

Each segment's change in purchases (sessions that completed checkout) is split
into two parts, so it's clear WHY it moved:
    traffic effect    = (sessions now - sessions before) x conversion before
    conversion effect = sessions now x (conversion now - conversion before)
The two add up to the change in purchases. Top movers = the 3 biggest effects
(by size), written as plain sentences. Small segments are skipped so a 3-visit
channel can't top the list. Read-only, cached.
"""

import logging
import time
from concurrent.futures import ThreadPoolExecutor

import models
from landing import _f, _i, _run, _since, period_windows
from shopify_client import HUMAN_SESSIONS_FILTER

logger = logging.getLogger("where_changed")

CACHE_SECONDS = 600
_cache: dict = {}

MIN_TOTAL_SESSIONS = 500  # same "too early to compare" rule as the Overview
DIMS = {"device": "session_device_type", "channel": "referrer_source"}


def _nice(label: str) -> str:
    s = str(label or "").strip() or "Unknown"
    return s[:1].upper() + s[1:]


def _min_segment(days: int) -> int:
    return 100 if days <= 1 else (300 if days <= 7 else 800)


def fetch_where_changed(store: models.Store, period: str = "yesterday", days: int = 7) -> dict:
    if period not in ("yesterday", "days"):
        period = "yesterday"
    if period == "yesterday":
        days = 1
    first, last, p_first, p_last, window_label, compare_label = period_windows(
        store, days, "yesterday" if period == "yesterday" else None
    )
    key = (store.store_url, period, days, first.isoformat())
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]

    cur_w, prev_w = _since(first, last), _since(p_first, p_last)
    H = HUMAN_SESSIONS_FILTER
    queries = {}
    for dim, field in DIMS.items():
        for tag, w in (("cur", cur_w), ("prev", prev_w)):
            queries[f"{dim}_{tag}"] = (
                f"FROM sessions SHOW sessions, sessions_that_completed_checkout {H}GROUP BY {field} {w} ORDER BY sessions DESC"
            )
    for tag, w in (("cur", cur_w), ("prev", prev_w)):
        queries[f"sales_{tag}"] = f"FROM sales SHOW total_sales, orders GROUP BY order_referrer_source {w}"

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
                logger.warning("Where-changed %s failed: %s", name, err)
                errors[name] = err

    def by_label(rows, field, a, b):
        out: dict[str, dict] = {}
        for r in rows or []:
            if r.get(field) is None:
                continue
            k = str(r[field]).strip().lower() or "unknown"
            o = out.setdefault(k, {"a": 0.0, "b": 0.0})
            o["a"] += _f(r.get(a)) or 0
            o["b"] += _f(r.get(b)) or 0
        return out

    sales_cur = by_label(res.get("sales_cur"), "order_referrer_source", "total_sales", "orders")
    sales_prev = by_label(res.get("sales_prev"), "order_referrer_source", "total_sales", "orders")
    min_seg = _min_segment(days)

    tables, movers, total_now = {}, [], 0
    for dim, field in DIMS.items():
        cur = by_label(res.get(f"{dim}_cur"), field, "sessions", "sessions_that_completed_checkout")
        prev = by_label(res.get(f"{dim}_prev"), field, "sessions", "sessions_that_completed_checkout")
        if dim == "device":
            total_now = sum(v["a"] for v in cur.values())
        rows = []
        for k in sorted(set(cur) | set(prev), key=lambda x: -(cur.get(x, {}).get("a", 0))):
            s1, b1 = int(cur.get(k, {}).get("a", 0)), int(cur.get(k, {}).get("b", 0))
            s0, b0 = int(prev.get(k, {}).get("a", 0)), int(prev.get(k, {}).get("b", 0))
            if s1 == 0 and s0 == 0:
                continue
            c1 = b1 / s1 if s1 else None
            c0 = b0 / s0 if s0 else None
            traffic = (s1 - s0) * c0 if c0 is not None else None
            conv = s1 * (c1 - c0) if (c1 is not None and c0 is not None) else None
            row = {
                "key": k,
                "label": _nice(k),
                "sessions": s1,
                "previous_sessions": s0,
                "sessions_change_pct": round((s1 - s0) / s0 * 100, 1) if s0 else None,
                "conversion_rate": round(c1 * 100, 2) if c1 is not None else None,
                "previous_conversion_rate": round(c0 * 100, 2) if c0 is not None else None,
                "conversion_change_pts": round((c1 - c0) * 100, 2) if (c1 is not None and c0 is not None) else None,
                "purchases": b1,
                "previous_purchases": b0,
                "purchases_change": b1 - b0,
                "traffic_effect": round(traffic, 1) if traffic is not None else None,
                "conversion_effect": round(conv, 1) if conv is not None else None,
                "enough_data": s1 >= min_seg and s0 >= min_seg,
            }
            if dim == "channel":
                r1, r0 = sales_cur.get(k, {}).get("a"), sales_prev.get(k, {}).get("a")
                row["revenue_per_session"] = round(r1 / s1, 2) if (r1 is not None and s1) else None
                row["previous_revenue_per_session"] = round(r0 / s0, 2) if (r0 is not None and s0) else None
                rps1, rps0 = row["revenue_per_session"], row["previous_revenue_per_session"]
                row["revenue_per_session_change_pct"] = round((rps1 - rps0) / rps0 * 100, 1) if (rps1 is not None and rps0) else None
            rows.append(row)
            if row["enough_data"]:
                subject = f"{row['label']} conversion" if dim == "device" else f"Conversion from {row['label']}"
                if conv is not None:
                    movers.append({
                        "dimension": dim, "segment": row["label"], "kind": "conversion", "effect": conv,
                        "text": (
                            f"{subject} {'rose' if conv > 0 else 'fell'} from {row['previous_conversion_rate']}% "
                            f"to {row['conversion_rate']}% ({row['conversion_change_pts']:+.2f} pts): about "
                            f"{abs(round(conv))} {'more' if conv > 0 else 'fewer'} purchases."
                        ),
                    })
                if traffic is not None:
                    movers.append({
                        "dimension": dim, "segment": row["label"], "kind": "traffic", "effect": traffic,
                        "text": (
                            (f"{row['label']} sessions " if dim == "device" else f"Traffic from {row['label']} ")
                            + 
                            f"{'rose' if s1 > s0 else 'fell'} {abs(row['sessions_change_pct'] or 0):.0f}% "
                            f"({s0:,} to {s1:,} sessions): about {abs(round(traffic))} "
                            f"{'more' if traffic > 0 else 'fewer'} purchases."
                        ),
                    })
        tables[dim] = rows

    too_early = total_now < MIN_TOTAL_SESSIONS
    top = [] if too_early else [
        m for m in sorted(movers, key=lambda m: -abs(m["effect"])) if abs(m["effect"]) >= 1
    ][:3]
    for m in top:
        m["effect"] = round(m["effect"], 1)
        m["good"] = m["effect"] > 0

    out = {
        "period": period,
        "days": days,
        "window_label": window_label,
        "compare_label": compare_label,
        "too_early": too_early,
        "total_sessions": int(total_now),
        "min_segment_sessions": min_seg,
        "device": tables.get("device", []),
        "channel": tables.get("channel", []),
        "movers": top,
        "errors": errors,
    }
    if not errors:
        _cache[key] = (time.time() + CACHE_SECONDS, out)
    return out
