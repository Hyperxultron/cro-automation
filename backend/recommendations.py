"""
CRO Recommendations - rule-based.

Har recommendation sirf tab banta hai jab uske peeche real evidence (data) ho.
Koi bhi recommendation fabricate nahi hoti.
"""

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from cvr import cvr_comparison, fetch_daily_cvr
from funnel import fetch_funnel
from quilt_alarm import check_quilt_alarm


def _day_range(store: models.Store, days_ago: int):
    tz = ZoneInfo(store.timezone or "UTC")
    day = datetime.now(tz).date() - timedelta(days=days_ago)
    start = datetime.combine(day, time.min, tzinfo=tz)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


def _revenue_in_range(db: Session, store: models.Store, start, end) -> float:
    value = (
        db.query(func.coalesce(func.sum(models.Order.total_amount), 0))
        .filter(
            models.Order.store_id == store.id,
            models.Order.cancelled_at.is_(None),
            models.Order.created_at >= start,
            models.Order.created_at < end,
        )
        .scalar()
    )
    return round(float(value or 0), 2)


def _declining_products(db: Session, store: models.Store, limit: int = 3) -> list[dict]:
    """Pichhle 7 din vs usse pehle ke 7 din - revenue mein sabse zyada decline wale products."""
    recent_start, recent_end = _day_range(store, 6)
    recent_end = datetime.now(timezone.utc)
    prior_start, _ = _day_range(store, 13)
    prior_end, _ = _day_range(store, 7)

    def revenue_by_product(start, end):
        rows = (
            db.query(
                models.Product.id,
                models.Product.product_name,
                func.coalesce(func.sum(models.OrderItem.quantity * models.OrderItem.unit_price), 0),
            )
            .join(models.OrderItem, models.OrderItem.product_id == models.Product.id)
            .join(models.Order, models.Order.id == models.OrderItem.order_id)
            .filter(
                models.Order.store_id == store.id,
                models.Order.cancelled_at.is_(None),
                models.Order.created_at >= start,
                models.Order.created_at < end,
            )
            .group_by(models.Product.id, models.Product.product_name)
            .all()
        )
        return {pid: (name, float(rev)) for pid, name, rev in rows}

    recent = revenue_by_product(recent_start, recent_end)
    prior = revenue_by_product(prior_start, prior_end)

    declines = []
    for pid, (name, prior_rev) in prior.items():
        if prior_rev <= 0:
            continue
        recent_rev = recent.get(pid, (name, 0.0))[1]
        drop_pct = round((prior_rev - recent_rev) / prior_rev * 100, 1)
        if drop_pct >= 30:
            declines.append({"name": name, "prior_revenue": round(prior_rev, 2),
                               "recent_revenue": round(recent_rev, 2), "drop_percent": drop_pct})

    declines.sort(key=lambda d: d["drop_percent"], reverse=True)
    return declines[:limit]


def build_recommendations(db: Session, store: models.Store) -> list[dict]:
    recs: list[dict] = []

    # 1. Quilt order inactivity
    quilt = check_quilt_alarm(db, store.id)
    if quilt.get("status") in ("alarm_triggered", "alarm_active"):
        recs.append({
            "title": "Quilt orders have stalled",
            "explanation": (
                f"No qualifying quilt order in the last {quilt.get('hours_elapsed')} hours "
                f"(threshold is {quilt.get('threshold_hours')}h). This usually means a traffic, "
                "pricing or stock issue on quilt listings."
            ),
            "evidence": f"Last quilt order: {quilt.get('last_quilt_order_number')} · "
                        f"{quilt.get('hours_elapsed')}h ago",
            "priority": "High",
            "suggested_action": "Check quilt product availability, pricing and any ad campaigns pointed at quilt listings.",
            "affected_metric": "Quilt orders",
        })

    # 2. CVR drop
    try:
        cvr_cmp = cvr_comparison(fetch_daily_cvr(db, store, days=7), store)
        if cvr_cmp["drop_percent"] is not None and cvr_cmp["drop_percent"] >= 15:
            recs.append({
                "title": "Conversion rate dropped sharply",
                "explanation": (
                    f"Yesterday's conversion rate ({cvr_cmp['yesterday_cvr']}%) is "
                    f"{cvr_cmp['drop_percent']}% lower than the day before "
                    f"({cvr_cmp['previous_cvr']}%). Worth checking for a broken checkout step, "
                    "a pricing change, or a traffic-quality shift."
                ),
                "evidence": f"{cvr_cmp['previous_date']}: {cvr_cmp['previous_cvr']}% -> "
                            f"{cvr_cmp['yesterday_date']}: {cvr_cmp['yesterday_cvr']}%",
                "priority": "High" if cvr_cmp["drop_percent"] >= 20 else "Medium",
                "suggested_action": "Test the checkout flow end-to-end and check recent traffic sources for quality drops.",
                "affected_metric": "Conversion Rate",
            })
    except Exception:
        pass

    # 3. Cart added but not checking out (funnel gap)
    try:
        funnel = fetch_funnel(store)
        if funnel["sessions"] and funnel["cart_rate"] and funnel["checkout_rate"] is not None:
            gap = funnel["cart_rate"] - funnel["checkout_rate"]
            if funnel["cart_rate"] >= 15 and gap >= 15:
                recs.append({
                    "title": "Customers add to cart but don't reach checkout",
                    "explanation": (
                        f"{funnel['cart_rate']}% of sessions added something to the cart, but only "
                        f"{funnel['checkout_rate']}% reached checkout - a {round(gap, 1)} point gap. "
                        "This points to friction before checkout: shipping cost surprise, "
                        "slow cart page, or a confusing cart UI."
                    ),
                    "evidence": f"Added to cart: {funnel['added_to_cart']} sessions · "
                                f"Reached checkout: {funnel['reached_checkout']} sessions ({funnel['date']})",
                    "priority": "Medium",
                    "suggested_action": "Review the cart page for unexpected costs, slow loading, or unclear next steps.",
                    "affected_metric": "Cart → Checkout",
                })
        if funnel["reached_checkout"] and funnel["conversion_rate"] is not None and funnel["checkout_rate"]:
            checkout_completion = round(
                funnel["completed_checkout"] / funnel["reached_checkout"] * 100, 1
            ) if funnel["reached_checkout"] else None
            if checkout_completion is not None and funnel["reached_checkout"] >= 10 and checkout_completion <= 40:
                recs.append({
                    "title": "Low checkout completion rate",
                    "explanation": (
                        f"Of the sessions that reached checkout, only {checkout_completion}% "
                        "completed the purchase. This often means a payment, shipping-cost, or "
                        "trust issue at the final step."
                    ),
                    "evidence": f"Reached checkout: {funnel['reached_checkout']} · "
                                f"Completed: {funnel['completed_checkout']} ({funnel['date']})",
                    "priority": "High" if checkout_completion <= 25 else "Medium",
                    "suggested_action": "Check available payment methods, shipping cost visibility, and checkout page load time.",
                    "affected_metric": "Checkout Completion Rate",
                })
    except Exception:
        pass

    # 4. Revenue decline (today-so-far vs yesterday same elapsed time)
    today_start, _ = _day_range(store, 0)
    y_start, _ = _day_range(store, 1)
    elapsed = datetime.now(timezone.utc) - today_start
    today_rev = _revenue_in_range(db, store, today_start, datetime.now(timezone.utc))
    y_same_time_rev = _revenue_in_range(db, store, y_start, y_start + elapsed)
    if y_same_time_rev > 0:
        change_pct = round((today_rev - y_same_time_rev) / y_same_time_rev * 100, 1)
        if change_pct <= -25:
            recs.append({
                "title": "Revenue is pacing well below yesterday",
                "explanation": (
                    f"So far today, revenue is {abs(change_pct)}% lower than at the same time "
                    "yesterday. Could be normal day-to-day variation, or a sign of a traffic/"
                    "availability issue - worth a quick look."
                ),
                "evidence": f"Today (so far): {today_rev} · Yesterday (same time): {y_same_time_rev}",
                "priority": "Medium",
                "suggested_action": "Check store uptime, ad spend pacing and whether any key product went out of stock.",
                "affected_metric": "Revenue",
            })

    # 5. Declining products
    try:
        declines = _declining_products(db, store)
        for d in declines:
            recs.append({
                "title": f"'{d['name']}' sales are declining",
                "explanation": (
                    f"Revenue from this product dropped {d['drop_percent']}% over the last 7 days "
                    "compared to the 7 days before that."
                ),
                "evidence": f"Prior 7 days: {d['prior_revenue']} -> Last 7 days: {d['recent_revenue']}",
                "priority": "Medium" if d["drop_percent"] < 60 else "High",
                "suggested_action": "Check stock levels, pricing, and product page content for this item.",
                "affected_metric": d["name"],
            })
    except Exception:
        pass

    priority_rank = {"High": 0, "Medium": 1, "Low": 2}
    recs.sort(key=lambda r: priority_rank.get(r["priority"], 3))
    return recs
