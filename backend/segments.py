"""
Device + channel splits for Conversion Analytics (manager checklist,
section 3, P1: "Split by device: mobile, desktop, tablet" and
"Split by channel: Meta, Google, organic search, email, direct, referral").

Uses ShopifyQL's `sessions` schema, GROUP BY session_device_type /
referrer_source - no new Shopify scope needed, same pattern as cvr.py and
funnel.py (ShopifyQL via the existing Admin GraphQL client).

Note: the checklist also asks for AOV and revenue-per-session on this split.
Those need order revenue linked back to the session's device/channel, which
isn't in the data this app currently syncs (our local `orders` table has no
device/channel dimension). Reported as unavailable rather than estimated -
see `revenue_available: False` in the response.
"""

import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import models
from shopify_client import graphql

SEGMENT_QUERY = """
query Segment($q: String!) {
  shopifyqlQuery(query: $q) {
    tableData { columns { name dataType } rows }
    parseErrors
  }
}
"""

CACHE_SECONDS = 600
_cache: dict[tuple, tuple[float, list[dict]]] = {}

DIMENSIONS = {
    "device": "session_device_type",
    "channel": "referrer_source",
}


def _to_float(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value) -> int:
    f = _to_float(value)
    return int(f) if f is not None else 0


def _pct(fraction):
    """ShopifyQL PERCENT fields are decimals (0.25 = 25%) per the schema docs."""
    f = _to_float(fraction)
    return None if f is None else round(f * 100, 2)


def _run_segment_query(store: models.Store, dimension_field: str, days_ago_start: int, days_ago_end: int) -> list[dict]:
    """
    Window is [days_ago_start days ago, days_ago_end days ago) - e.g. (7, 0) for
    "the last 7 complete days up to and including yesterday".
    """
    since = f"-{days_ago_start}d"
    until = f"-{days_ago_end}d" if days_ago_end else "today"
    q = (
        f"FROM sessions SHOW sessions, added_to_cart_rate, conversion_rate, num_orders "
        f"GROUP BY {dimension_field} WITH TOTALS SINCE {since} UNTIL {until} "
        f"ORDER BY sessions DESC"
    )
    data = graphql(store.store_url, SEGMENT_QUERY, {"q": q})["shopifyqlQuery"]
    if data.get("parseErrors"):
        raise ValueError(f"ShopifyQL error: {data['parseErrors']}")

    rows = (data.get("tableData") or {}).get("rows") or []
    out = []
    for row in rows:
        label = row.get(dimension_field)
        if label is None:
            continue  # the WITH TOTALS grand-total row - not a segment
        label = str(label).strip() or "Unknown"
        out.append(
            {
                "label": label,
                "sessions": _to_int(row.get("sessions")),
                "added_to_cart_rate": _pct(row.get("added_to_cart_rate")),
                "conversion_rate": _pct(row.get("conversion_rate")),
                "orders": _to_int(row.get("num_orders")),
            }
        )
    return out


def fetch_segment_split(db, store: models.Store, dimension: str, days: int = 7) -> dict:
    """
    dimension: "device" | "channel"
    Returns current (last `days` complete days) vs baseline (the `days` before
    that) - same "Last N vs prior N" shape used on the Overview page, so the
    comparison picker language stays consistent across pages.
    """
    if dimension not in DIMENSIONS:
        raise ValueError(f"Unknown dimension: {dimension}")
    dimension_field = DIMENSIONS[dimension]

    key = (store.store_url, dimension, days)
    cached = _cache.get(key)
    if cached and cached[0] > time.time():
        return cached[1]

    current = _run_segment_query(store, dimension_field, days_ago_start=days, days_ago_end=0)
    baseline = _run_segment_query(store, dimension_field, days_ago_start=days * 2, days_ago_end=days)

    baseline_by_label = {r["label"]: r for r in baseline}
    rows = []
    for row in current:
        base = baseline_by_label.get(row["label"])
        sessions_change_pct = None
        cvr_change_pts = None
        if base and base["sessions"]:
            sessions_change_pct = round((row["sessions"] - base["sessions"]) / base["sessions"] * 100, 1)
        if base and base["conversion_rate"] is not None and row["conversion_rate"] is not None:
            cvr_change_pts = round(row["conversion_rate"] - base["conversion_rate"], 2)
        rows.append(
            {
                **row,
                "baseline_sessions": base["sessions"] if base else None,
                "baseline_conversion_rate": base["conversion_rate"] if base else None,
                "sessions_change_pct": sessions_change_pct,
                "conversion_rate_change_pts": cvr_change_pts,
            }
        )

    result = {
        "dimension": dimension,
        "days": days,
        "rows": rows,
        "revenue_available": False,  # see module docstring
        "revenue_note": "AOV and revenue per session aren't available in this split yet - "
                         "that needs order revenue linked back to the session's device/channel, "
                         "which this app doesn't currently sync.",
    }
    _cache[key] = (time.time() + CACHE_SECONDS, result)
    return result
