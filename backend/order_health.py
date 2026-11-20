"""
Order health - paid / refunded / cancelled / pending orders placed in a window.

Read straight from Shopify (GraphQL orders, read-only), not from our synced
copy. Why: the background sync only re-reads the last 2 days of orders, so an
order paid on 1 Nov and refunded on 15 Nov stayed "paid" in our table forever.
That made the refund and cancel rates look too low (20 Nov report).

Window = complete days in the store's time zone, same buttons as the other
cards (Today / Yesterday / Last 7 / Last 30). Each order is counted by the
day it was placed, with its status as it is right now in Shopify. Test
orders are left out.

Buckets (Shopify displayFinancialStatus):
  cancelled          - cancelledAt is set (wins over the payment status),
                       plus VOIDED / EXPIRED payments
  refunded           - REFUNDED (fully refunded)
  partially_refunded - PARTIALLY_REFUNDED
  paid               - PAID, PARTIALLY_PAID
  pending            - PENDING, AUTHORIZED (payment not captured yet)
"""

import logging
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

import models
from landing import period_windows
from overview import _day_bounds_utc, _tz
from shopify_client import graphql

logger = logging.getLogger("order_health")

ORDERS_STATUS_QUERY = """
query OrderStatus($cursor: String, $search: String) {
  orders(first: 250, after: $cursor, query: $search, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes { createdAt cancelledAt test displayFinancialStatus }
  }
}
"""

BUCKETS = ("paid", "partially_refunded", "refunded", "cancelled", "pending")
_cache: dict = {}


def _bucket(status: str | None, cancelled: bool) -> str:
    s = (status or "").upper()
    if cancelled or s in ("VOIDED", "EXPIRED"):
        return "cancelled"
    if s == "REFUNDED":
        return "refunded"
    if s == "PARTIALLY_REFUNDED":
        return "partially_refunded"
    if s in ("PAID", "PARTIALLY_PAID"):
        return "paid"
    return "pending"


def _from_shopify(store: models.Store, start: datetime, end: datetime) -> list[tuple[str | None, bool]]:
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    search = f"created_at:>='{start.astimezone(timezone.utc).strftime(fmt)}' created_at:<'{end.astimezone(timezone.utc).strftime(fmt)}'"
    out = []
    cursor = None
    for _ in range(60):  # 15,000 orders max - far above this store's volume
        data = graphql(store.store_url, ORDERS_STATUS_QUERY, {"cursor": cursor, "search": search})["orders"]
        for n in data["nodes"]:
            if n.get("test"):
                continue
            out.append((n.get("displayFinancialStatus"), bool(n.get("cancelledAt"))))
        if not data["pageInfo"]["hasNextPage"]:
            break
        cursor = data["pageInfo"]["endCursor"]
    return out


def _from_db(db: Session, store: models.Store, start: datetime, end: datetime) -> list[tuple[str | None, bool]]:
    rows = (
        db.query(models.Order.financial_status, models.Order.cancelled_at)
        .filter(models.Order.store_id == store.id, models.Order.created_at >= start, models.Order.created_at < end)
        .all()
    )
    return [(s, c is not None) for s, c in rows]


def fetch_order_health(db: Session, store: models.Store, days: int = 30, period: str | None = None) -> dict:
    """period: None (last `days` complete days), "yesterday" or "today" (so far)."""
    period = period if period in ("today", "yesterday") else None
    first, last, _, _, window_label, _ = period_windows(store, days, period)
    tz = _tz(store)
    start, _ = _day_bounds_utc(first, tz)
    _, end = _day_bounds_utc(last, tz)
    if period == "today":
        end = min(end, datetime.now(timezone.utc))

    key = (store.store_url, first.isoformat(), last.isoformat(), period)
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]

    source, note = "shopify", None
    try:
        orders = _from_shopify(store, start, end)
    except Exception as exc:
        logger.warning("Order health from Shopify failed, using synced orders: %s", exc)
        orders = _from_db(db, store, start, end)
        source = "synced_orders"
        note = ("Couldn't reach Shopify, so this uses the dashboard's copy of orders. "
                "Refunds or cancellations made after an order's first 2 days may be missing.")

    counts = {b: 0 for b in BUCKETS}
    for status, cancelled in orders:
        counts[_bucket(status, cancelled)] += 1
    total = len(orders)

    def pct(n: int) -> float:
        return round(n / total * 100, 1) if total else 0.0

    out = {
        "days": (last - first).days + 1,
        "period": period or f"last{days}",
        "window_label": window_label,
        "source": source,
        "note": note,
        "total_orders": total,
        **{b: {"count": counts[b], "pct": pct(counts[b])} for b in BUCKETS},
        "any_refund": {
            "count": counts["refunded"] + counts["partially_refunded"],
            "pct": pct(counts["refunded"] + counts["partially_refunded"]),
        },
    }
    if source == "shopify":
        _cache[key] = (time.time() + (120 if period == "today" else 600), out)
    return out
