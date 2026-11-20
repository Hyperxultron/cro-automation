"""
Cart and checkout extras (manager checklist, section 6, P2/P3) - the parts we
can show without Shopify customer events:

  - Payment method mix and failed payments (P2): ShopifyQL `payment_attempts`.
      authorization rate = successful payments / unique purchase attempts
      (a customer retrying the same purchase counts once).
  - Free-shipping threshold (P2): histogram of order values and the share of
    orders just below the threshold (within 20% under it). Order value =
    subtotal after discounts, before shipping and tax (Shopify's AOV basis).
    Uses completed orders from our synced data - Shopify doesn't expose
    abandoned cart values, so this shows what buyers spent, not carts.
  - Items per order (P3): distribution of pieces per order.

Checkout step drop-off (contact -> address -> shipping -> payment) needs
Shopify customer events (a web pixel) and isn't in Shopify Analytics, so it
isn't shown.
"""

import logging
import os
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from landing import _f, _i, _run, _since, period_windows
from overview import _day_bounds_utc, _tz

logger = logging.getLogger("cart_extras")

CACHE_SECONDS = 600
_cache: dict = {}

BUCKET = 25.0           # $25 histogram bars
MAX_BUCKET = 300.0      # everything above lands in "$300+"
NEAR_SHARE = 0.20       # "just below" = within 20% under the threshold


def _env_threshold() -> float | None:
    try:
        v = float(os.getenv("FREE_SHIPPING_THRESHOLD", "") or 0)
    except ValueError:
        return None
    return v or None


def _payments(store: models.Store, first, last) -> tuple[dict | None, str | None]:
    """
    Daily rows (TIMESERIES day) summed in Python for the days we want.

    Why not just SINCE first UNTIL last: for a one-day window (Today /
    Yesterday) that returned no payment rows at all, while 28 days worked.
    Asking for daily rows over a slightly wider window and picking the days
    ourselves gives the same totals as Shopify's payment report for any range.
    """
    since = (first - timedelta(days=3)).isoformat()
    until = (last + timedelta(days=1)).isoformat()
    wanted = {(first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)}
    q = (
        "FROM payment_attempts SHOW unique_payment_attempts, successful_payments, failed_payment_attempts "
        f"GROUP BY payment_method TIMESERIES day SINCE {since} UNTIL {until}"
    )
    q_wallet = (
        "FROM payment_attempts SHOW unique_payment_attempts, successful_payments, failed_payment_attempts "
        f"GROUP BY payment_card_wallet TIMESERIES day SINCE {since} UNTIL {until}"
    )
    out = {}
    errors = []
    with ThreadPoolExecutor(max_workers=2) as pool:
        futs = {name: pool.submit(_run, store, q_) for name, q_ in (("method", q), ("wallet", q_wallet))}
        for name, fut in futs.items():
            try:
                out[name] = fut.result()
            except Exception as exc:
                logger.warning("Payment query %s failed: %s", name, exc)
                errors.append(str(exc)[:300])
                out[name] = None
    if out.get("method") is None:
        return None, "; ".join(errors) or "payment data unavailable"

    def summed(raw, key):
        acc: dict[str, dict] = {}
        for r in raw or []:
            day = str(r.get("day") or "")[:10]
            if day not in wanted or r.get(key) is None:
                continue
            a = acc.setdefault(r.get(key), {"unique_payment_attempts": 0, "successful_payments": 0, "failed_payment_attempts": 0, key: r.get(key)})
            for m in ("unique_payment_attempts", "successful_payments", "failed_payment_attempts"):
                a[m] += _i(r.get(m))
        return sorted(acc.values(), key=lambda x: -x["unique_payment_attempts"])

    seen_days = sorted({str(r.get("day") or "")[:10] for r in out["method"] or [] if r.get("day") and _i(r.get("unique_payment_attempts"))})
    latest_day = seen_days[-1] if seen_days else None
    out["method"] = summed(out["method"], "payment_method")
    if out.get("wallet") is not None:
        out["wallet"] = summed(out["wallet"], "payment_card_wallet")

    def rows(raw, key):
        res = []
        for r in raw or []:
            label = r.get(key)
            if label is None:
                continue
            uniq, ok, failed = _i(r.get("unique_payment_attempts")), _i(r.get("successful_payments")), _i(r.get("failed_payment_attempts"))
            res.append({
                "label": str(label).strip() or "Other / none",
                "attempts": uniq,
                "successful": ok,
                "failed_attempts": failed,
                "authorization_rate": round(ok / uniq * 100, 1) if uniq else None,
            })
        total = sum(x["successful"] for x in res)
        for x in res:
            x["share_of_payments"] = round(x["successful"] / total * 100, 1) if total else None
        return res

    methods = rows(out["method"], "payment_method")
    uniq = sum(m["attempts"] for m in methods)
    ok = sum(m["successful"] for m in methods)
    failed = sum(m["failed_attempts"] for m in methods)
    return {
        "methods": methods,
        "wallets": rows(out.get("wallet"), "payment_card_wallet") if out.get("wallet") is not None else [],
        "attempts": uniq,
        "successful": ok,
        "failed_attempts": failed,
        "authorization_rate": round(ok / uniq * 100, 1) if uniq else None,
        "latest_day_with_data": latest_day,
    }, (None if uniq else (
        f"Shopify has no payment attempts for this period yet (latest day with payment data: {latest_day})."
        if latest_day else "Shopify returned no payment attempts for this period."
    ))


def _orders(db: Session, store: models.Store, first, last):
    tz = _tz(store)
    start, _ = _day_bounds_utc(first, tz)
    _, end = _day_bounds_utc(last, tz)
    base = db.query(models.Order).filter(
        models.Order.store_id == store.id,
        models.Order.cancelled_at.is_(None),
        models.Order.created_at >= start,
        models.Order.created_at < end,
    )
    values = [float(v or 0) for (v,) in base.with_entities(models.Order.subtotal_amount)]
    items = (
        db.query(models.Order.id, func.coalesce(func.sum(models.OrderItem.quantity), 0))
        .join(models.OrderItem, models.OrderItem.order_id == models.Order.id)
        .filter(
            models.Order.store_id == store.id,
            models.Order.cancelled_at.is_(None),
            models.Order.created_at >= start,
            models.Order.created_at < end,
        )
        .group_by(models.Order.id)
        .all()
    )
    return values, [int(q) for _, q in items]


def _histogram(values: list[float], threshold: float | None) -> dict:
    counts = Counter()
    for v in values:
        b = MAX_BUCKET if v >= MAX_BUCKET else int(v // BUCKET) * BUCKET
        counts[b] += 1
    n = len(values)
    bars = []
    b = 0.0
    while b <= MAX_BUCKET:
        label = f"${int(b)}+" if b == MAX_BUCKET else f"${int(b)}-{int(b + BUCKET - 1)}"
        bars.append({
            "from": b,
            "label": label,
            "orders": counts.get(b, 0),
            "share": round(counts.get(b, 0) / n * 100, 1) if n else 0,
            "below_threshold_zone": bool(threshold and b < threshold and b + BUCKET > threshold * (1 - NEAR_SHARE)),
        })
        b += BUCKET
    near = above = 0
    if threshold:
        near = sum(1 for v in values if threshold * (1 - NEAR_SHARE) <= v < threshold)
        above = sum(1 for v in values if v >= threshold)
    sv = sorted(values)
    median = (sv[n // 2] if n % 2 else (sv[n // 2 - 1] + sv[n // 2]) / 2) if n else None
    return {
        "orders": n,
        "average": round(sum(values) / n, 2) if n else None,
        "median": round(median, 2) if median is not None else None,
        "bars": bars,
        "threshold": threshold,
        "near_threshold_orders": near if threshold else None,
        "near_threshold_share": round(near / n * 100, 1) if threshold and n else None,
        "near_threshold_from": round(threshold * (1 - NEAR_SHARE), 2) if threshold else None,
        "at_or_above_threshold_share": round(above / n * 100, 1) if threshold and n else None,
    }


def _items(qtys: list[int]) -> dict:
    n = len(qtys)
    c = Counter(min(q, 5) for q in qtys)
    return {
        "orders": n,
        "average_items": round(sum(qtys) / n, 2) if n else None,
        "single_item_share": round(c.get(1, 0) / n * 100, 1) if n else None,
        "bars": [
            {"label": "5+" if k == 5 else str(k), "orders": c.get(k, 0), "share": round(c.get(k, 0) / n * 100, 1) if n else 0}
            for k in range(1, 6)
        ],
    }


def fetch_cart_extras(db: Session, store: models.Store, days: int = 28, threshold: float | None = None,
                      period: str | None = None) -> dict:
    """period: None (last `days` complete days), "yesterday", or "today" (live, so far)."""
    threshold = threshold if threshold else _env_threshold()
    period = period if period in ("today", "yesterday") else None
    first, last, _, _, window_label, _ = period_windows(store, days, period)
    key = (store.store_url, days, period, datetime.now(_tz(store)).date().isoformat())
    cached = _cache.get(key)
    if cached and cached[0] > time.time():
        payments, pay_err = cached[1]
    else:
        payments, pay_err = _payments(store, first, last)
        if payments is not None:
            ttl = 120 if period == "today" else CACHE_SECONDS
            _cache[key] = (time.time() + ttl, (payments, pay_err))

    values, qtys = _orders(db, store, first, last)
    return {
        "days": days,
        "period": period or f"last{days}",
        "window_label": window_label,
        "payments": payments,
        "payments_error": pay_err,
        "order_values": _histogram(values, threshold),
        "items_per_order": _items(qtys),
        "not_available": [
            "Checkout step drop-off (contact → address → shipping → payment) needs Shopify customer events, "
            "which Shopify Analytics doesn't store.",
            "Abandoned cart values aren't available, so the order value chart shows completed orders.",
        ],
    }
