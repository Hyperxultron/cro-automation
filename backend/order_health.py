"""
Order health breakdown - paid / refunded / cancelled / pending orders over a window.

Why this matters for CRO: a rising refund or cancellation rate is often a sign of
checkout friction, payment-gateway issues, or a trust problem at the point of sale -
exactly the kind of signal competitor CRO tools (Lifetimely, Triple Whale, Shopify's
own analytics) surface as a standard "order health" or "payment health" widget.

Uses ONLY data already synced into the local `orders` table (financial_status,
cancelled_at) - no new Shopify API calls, no new scopes needed.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

import models

REFUND_STATUSES = {"refunded", "partially_refunded"}
PAID_STATUSES = {"paid", "partially_paid"}


def fetch_order_health(db: Session, store: models.Store, days: int = 30) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    orders = (
        db.query(models.Order)
        .filter(models.Order.store_id == store.id, models.Order.created_at >= since)
        .all()
    )

    total = len(orders)
    cancelled = sum(1 for o in orders if o.cancelled_at is not None)
    refunded = sum(
        1
        for o in orders
        if o.cancelled_at is None and (o.financial_status or "").lower() in REFUND_STATUSES
    )
    paid = sum(
        1
        for o in orders
        if o.cancelled_at is None and (o.financial_status or "").lower() in PAID_STATUSES
    )
    pending = total - cancelled - refunded - paid

    def pct(n: int) -> float:
        return round((n / total) * 100, 1) if total else 0.0

    return {
        "days": days,
        "total_orders": total,
        "paid": {"count": paid, "pct": pct(paid)},
        "refunded": {"count": refunded, "pct": pct(refunded)},
        "cancelled": {"count": cancelled, "pct": pct(cancelled)},
        "pending": {"count": max(pending, 0), "pct": pct(max(pending, 0))},
    }
