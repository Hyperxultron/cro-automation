"""
"Total sales over time" + "Total sales breakdown" (manager's ask: bring
Shopify's own Analytics-page sales widgets onto our dashboard, since the
Shopify admin view has too much going on and isn't built for this store's
own CRO workflow).

Two pieces, both built from real order data already synced into our
database (no new Shopify scopes needed - subtotal/discounts/shipping/tax/
refunded are standard Order fields we just started pulling in sync):

  fetch_sales_trend(db, store, days)
      Day-by-day total sales for the current window AND the window right
      before it (aligned by day-offset, not date) - this is what powers the
      "solid line vs dashed comparison line" chart, same idea as Shopify's
      "Total sales over time".

  fetch_sales_breakdown(db, store, period, compare)
      Gross sales -> discounts -> returns -> net sales -> shipping -> taxes
      -> total sales, for one period, each with a baseline + % change -
      reusing the exact same period/baseline/"too early to compare" rules
      as /dashboard/overview (section 1 of the checklist), so the numbers
      here are never computed on a different basis than the rest of the
      dashboard.

Honesty note: "Returns" below is `total_refunded`, which Shopify's API
reports as one number per order covering any refund (product, shipping, or
tax). We show it as a single "Returns" row rather than splitting it into
product-only vs shipping-only - splitting that out would require assuming a
breakdown Shopify doesn't actually give us per-field.
"""

from datetime import datetime, timedelta, timezone as dt_tz

from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from overview import (
    MIN_ORDERS_FOR_COMPARISON,
    WEEKDAY_NAMES,
    _day_bounds_utc,
    _metric_block,
    _has_history,
    _same_weekday_dates_back,
    _tz,
    history_start_date,
)

_KEYS = ("orders", "total", "gross", "discounts", "returns", "net", "shipping", "tax")
_EMPTY = {k: None for k in _KEYS}


def _sales_stats(db: Session, store: models.Store, start, end) -> dict:
    base = db.query(models.Order).filter(
        models.Order.store_id == store.id,
        models.Order.shopify_order_id.isnot(None),
        models.Order.cancelled_at.is_(None),
        models.Order.created_at >= start,
        models.Order.created_at < end,
    )
    orders = base.count()
    sums = base.with_entities(
        func.coalesce(func.sum(models.Order.total_amount), 0),
        func.coalesce(func.sum(models.Order.subtotal_amount), 0),
        func.coalesce(func.sum(models.Order.total_discounts), 0),
        func.coalesce(func.sum(models.Order.total_shipping), 0),
        func.coalesce(func.sum(models.Order.total_tax), 0),
        func.coalesce(func.sum(models.Order.total_refunded), 0),
    ).first()
    total, subtotal, discounts, shipping, tax, refunded = (round(float(v or 0), 2) for v in sums)

    gross = round(subtotal + discounts, 2)
    net = round(subtotal - refunded, 2)

    return {
        "orders": orders,
        "total": total,
        "gross": gross,
        "discounts": discounts,
        "returns": refunded,
        "net": net,
        "shipping": shipping,
        "tax": tax,
    }


def fetch_sales_trend(db: Session, store: models.Store, days: int = 14) -> dict:
    """
    Day-by-day total sales for the last `days` complete days, plus the same
    number of days right before that window - for the "vs previous period"
    dashed comparison line on the chart.
    """
    tz = _tz(store)
    today = datetime.now(tz).date()
    yesterday = today - timedelta(days=1)

    history_start = history_start_date(db, store)

    def point(day):
        # Days before our synced order history are unknown (None), not $0 -
        # otherwise the chart draws a flat zero line and then a fake jump.
        if not _has_history(history_start, day):
            return {"date": day.isoformat(), "revenue": None, "orders": None}
        stats = _sales_stats(db, store, *_day_bounds_utc(day, tz))
        return {"date": day.isoformat(), "revenue": stats["total"], "orders": stats["orders"]}

    current = []
    previous = []
    for i in range(days - 1, -1, -1):
        day = yesterday - timedelta(days=i)
        current.append(point(day))
        previous.append(point(day - timedelta(days=days)))

    return {
        "days": days,
        "history_start": history_start.isoformat() if history_start else None,
        "current": current,
        "previous": previous,
    }


def fetch_sales_breakdown(db: Session, store: models.Store, period: str = "yesterday", compare: str = "4week_avg") -> dict:
    """
    period: "yesterday" | "today" | "last7" - same meaning as /dashboard/overview.
    compare: "4week_avg" | "last_week" - ignored for period="last7" (always prior 7 days).
    """
    tz = _tz(store)
    now_local = datetime.now(tz)
    today_date = now_local.date()
    yesterday_date = today_date - timedelta(days=1)

    if period == "today":
        target_date = today_date
        start, _ = _day_bounds_utc(target_date, tz)
        end = datetime.now(dt_tz.utc)
        period_label = f"Today so far ({now_local.strftime('%a %d %b')})"
    elif period == "last7":
        target_date = yesterday_date
        start, _ = _day_bounds_utc(target_date - timedelta(days=6), tz)
        _, end = _day_bounds_utc(target_date, tz)
        period_label = f"Last 7 days ({(target_date - timedelta(days=6)).strftime('%d %b')} - {target_date.strftime('%d %b')})"
    else:
        period = "yesterday"
        target_date = yesterday_date
        start, end = _day_bounds_utc(target_date, tz)
        period_label = f"Yesterday ({target_date.strftime('%a %d %b')})"

    current = _sales_stats(db, store, start, end)
    history_start = history_start_date(db, store)

    if period == "last7":
        prior_first_day = target_date - timedelta(days=13)
        prior_start, _ = _day_bounds_utc(prior_first_day, tz)
        _, prior_end = _day_bounds_utc(target_date - timedelta(days=7), tz)
        baseline = (
            _sales_stats(db, store, prior_start, prior_end)
            if _has_history(history_start, prior_first_day) else _EMPTY
        )
        baseline_label = "vs prior 7 days"
    elif compare == "last_week" or period == "today":
        last_week_same_day = target_date - timedelta(days=7)
        lw_start, lw_end = _day_bounds_utc(last_week_same_day, tz)
        if period == "today":
            # Same elapsed window as today-so-far, like /dashboard/overview.
            lw_end = lw_start + (end - start)
        baseline = (
            _sales_stats(db, store, lw_start, lw_end)
            if _has_history(history_start, last_week_same_day) else _EMPTY
        )
        prefix = "vs same time" if period == "today" else "vs same"
        baseline_label = f"{prefix} {WEEKDAY_NAMES[last_week_same_day.weekday()]} last week"
    else:
        compare = "4week_avg"
        weekday_dates = [
            d for d in _same_weekday_dates_back(target_date, 4) if _has_history(history_start, d)
        ]
        stats_list = [
            _sales_stats(db, store, *_day_bounds_utc(d, tz)) for d in weekday_dates
        ]
        baseline = (
            {key: round(sum(s[key] for s in stats_list) / len(stats_list), 2) for key in _KEYS}
            if stats_list else _EMPTY
        )
        baseline_label = f"vs 4-week {WEEKDAY_NAMES[target_date.weekday()]} average"

    too_early = current["orders"] < MIN_ORDERS_FOR_COMPARISON

    def row(key, label):
        return {
            "label": label,
            **_metric_block(current[key], baseline[key], too_early, baseline_label),
        }

    return {
        "period": period,
        "period_label": period_label,
        "compare": compare,
        "too_early": too_early,
        "rows": [
            row("gross", "Gross sales"),
            row("discounts", "Discounts"),
            row("returns", "Sales reversals (refunds)"),
            row("net", "Net sales"),
            row("shipping", "Shipping charges"),
            row("tax", "Taxes"),
            row("total", "Total sales"),
        ],
        "note": "Same rows as Shopify Analytics. Sales reversals = money refunded on orders (can include refunded shipping or tax). Return fees aren't synced yet.",
    }
