"""
Device + channel splits for Conversion Analytics (manager checklist,
section 3, P1: "Split by device: mobile, desktop, tablet" and
"Split by channel: Meta, Google, organic search, email, direct, referral").

Uses ShopifyQL's `sessions` schema, GROUP BY session_device_type /
referrer_source - no new Shopify scope needed, same pattern as cvr.py and
funnel.py (ShopifyQL via the existing Admin GraphQL client).

AOV and revenue per session (also asked for on this split):
  - channel: ShopifyQL's `sales` schema has `order_referrer_source`, the same
    referrer types as the sessions schema's `referrer_source`, so revenue per
    channel = total_sales GROUP BY order_referrer_source, and revenue per
    session = that / the channel's sessions.
  - device: the `sales` schema has no device dimension, so AOV / revenue per
    session by device stays unavailable rather than estimated.
"""

import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import models
from shopify_client import HUMAN_SESSIONS_FILTER, graphql

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
        f"{HUMAN_SESSIONS_FILTER}"
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


def _run_channel_sales_query(store: models.Store, days_ago_start: int, days_ago_end: int) -> dict[str, dict]:
    """{referrer type (lower-case): {revenue, orders, aov}} from the sales schema."""
    since = f"-{days_ago_start}d"
    until = f"-{days_ago_end}d" if days_ago_end else "today"
    q = (
        f"FROM sales SHOW total_sales, orders, average_order_value "
        f"GROUP BY order_referrer_source SINCE {since} UNTIL {until}"
    )
    data = graphql(store.store_url, SEGMENT_QUERY, {"q": q})["shopifyqlQuery"]
    if data.get("parseErrors"):
        raise ValueError(f"ShopifyQL error: {data['parseErrors']}")
    out = {}
    for row in (data.get("tableData") or {}).get("rows") or []:
        label = row.get("order_referrer_source")
        if label is None:
            continue
        key = (str(label).strip() or "Unknown").lower()
        revenue = _to_float(row.get("total_sales")) or 0.0
        orders = _to_int(row.get("orders"))
        aov = _to_float(row.get("average_order_value"))
        prev = out.get(key)
        if prev:  # same label twice (e.g. "" and "Unknown") - merge
            revenue += prev["revenue"]
            orders += prev["orders"]
            aov = None
        out[key] = {
            "revenue": round(revenue, 2),
            "orders": orders,
            "aov": round(aov, 2) if aov is not None else (round(revenue / orders, 2) if orders else None),
        }
    return out


def _with_revenue(row: dict, sales: dict[str, dict] | None) -> dict:
    s = (sales or {}).get(row["label"].lower())
    revenue = s["revenue"] if s else (0.0 if sales is not None else None)
    return {
        "revenue": revenue,
        "aov": s["aov"] if s else None,
        "revenue_per_session": round(revenue / row["sessions"], 2) if revenue is not None and row["sessions"] else None,
    }


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

    revenue_available = False
    cur_sales = base_sales = None
    revenue_note = (
        "AOV and revenue per session by device aren't available: Shopify's sales data "
        "has no device dimension, so they can't be split this way without guessing."
    )
    if dimension == "channel":
        try:
            cur_sales = _run_channel_sales_query(store, days_ago_start=days, days_ago_end=0)
            base_sales = _run_channel_sales_query(store, days_ago_start=days * 2, days_ago_end=days)
            revenue_available = True
            revenue_note = (
                "Revenue is Shopify's total sales (incl. tax and shipping) by the order's referrer; "
                "revenue per session = that revenue / the channel's sessions."
            )
        except Exception as exc:
            cur_sales = base_sales = None
            revenue_note = f"Channel revenue unavailable from Shopify right now ({str(exc)[:120]})."

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
        money = _with_revenue(row, cur_sales) if revenue_available else {"revenue": None, "aov": None, "revenue_per_session": None}
        base_money = (
            _with_revenue(base, base_sales) if (revenue_available and base) else {"revenue_per_session": None}
        )
        rps_change_pct = None
        if money["revenue_per_session"] is not None and base_money["revenue_per_session"]:
            rps_change_pct = round(
                (money["revenue_per_session"] - base_money["revenue_per_session"]) / base_money["revenue_per_session"] * 100, 1
            )
        rows.append(
            {
                **row,
                **money,
                "baseline_revenue_per_session": base_money["revenue_per_session"],
                "revenue_per_session_change_pct": rps_change_pct,
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
        "revenue_available": revenue_available,
        "revenue_note": revenue_note,
    }
    _cache[key] = (time.time() + CACHE_SECONDS, result)
    return result
