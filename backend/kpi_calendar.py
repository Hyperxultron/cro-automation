"""
Overview KPI card popup ("Calendar + related", template 4).

Har din ke numbers, pichhle `days` poore din (aaj chhod kar), wahi definitions
jo Overview ke cards use karte hain:
  revenue  = Shopify total sales (ShopifyQL, cards jaisa)
  orders   = hamare DB ke orders (cancelled hata ke)
  aov      = subtotal (discount ke baad) / orders  - Shopify ki definition
  sessions, cvr = Shopify Analytics, bots hata ke
  rps      = revenue / sessions
Plus 7 din extra, taaki har din ka "same weekday last week" change nikle.
"""

import logging
from collections import defaultdict
from datetime import datetime, time as dtime, timedelta, timezone

from sqlalchemy.orm import Session

import models
from cvr import fetch_daily_cvr, store_today
from overview import _tz

logger = logging.getLogger("kpi_calendar")


def fetch_kpi_calendar(db: Session, store: models.Store, days: int = 35) -> dict:
    tz = _tz(store)
    last = store_today(store) - timedelta(days=1)
    first = last - timedelta(days=days + 6)  # +7 for week-before changes
    dates = [(first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)]

    # Orders + AOV from our order copy, bucketed by store-time day.
    start = datetime.combine(first, dtime.min, tz).astimezone(timezone.utc)
    end = datetime.combine(last + timedelta(days=1), dtime.min, tz).astimezone(timezone.utc)
    rows = (
        db.query(models.Order.created_at, models.Order.subtotal_amount, models.Order.total_amount)
        .filter(
            models.Order.store_id == store.id,
            models.Order.shopify_order_id.isnot(None),
            models.Order.cancelled_at.is_(None),
            models.Order.created_at >= start,
            models.Order.created_at < end,
        )
        .all()
    )
    orders = defaultdict(int)
    subtotal = defaultdict(float)
    db_total = defaultdict(float)
    for created, sub, total in rows:
        c = created if created.tzinfo else created.replace(tzinfo=timezone.utc)
        d = c.astimezone(tz).date().isoformat()
        orders[d] += 1
        subtotal[d] += float(sub or 0)
        db_total[d] += float(total or 0)

    # Revenue = Shopify total sales (same as the Revenue card); DB total if ShopifyQL fails.
    revenue_source = "shopify"
    try:
        from shopify_sales import daily_sales

        sales = {d: v["total"] for d, v in daily_sales(store, first, last).items()}
    except Exception as exc:
        logger.warning("Daily sales for KPI calendar failed: %s", exc)
        sales = {d: round(db_total[d], 2) for d in dates}
        revenue_source = "orders"

    sessions_error = None
    try:
        cvr_days = {r["date"]: r for r in fetch_daily_cvr(db, store, days=len(dates))}
    except Exception as exc:
        logger.warning("Daily sessions for KPI calendar failed: %s", exc)
        cvr_days, sessions_error = {}, str(exc)[:200]

    out = []
    for d in dates:
        rev = sales.get(d)
        n = orders.get(d, 0)
        s = cvr_days.get(d, {})
        sess = s.get("sessions")
        out.append({
            "date": d,
            "revenue": round(rev, 2) if rev is not None else None,
            "orders": n,
            "aov": round(subtotal[d] / n, 2) if n else None,
            "sessions": sess,
            "cvr": s.get("cvr"),
            "rps": round(rev / sess, 2) if rev is not None and sess else None,
        })
    return {
        "first": dates[7],
        "last": last.isoformat(),
        "timezone": store.timezone,
        "revenue_source": revenue_source,
        "sessions_error": sessions_error,
        "days": out,
    }
