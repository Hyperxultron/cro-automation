"""
Quilt Order Monitoring Alarm

Rule: Agar kisi store mein `threshold` ghante (default 12) tak koi
qualifying quilt order nahi aata, toh ek alert banta hai.

Logic:
  1. Store ke quilt products dhoondo (abhi: category mein "quilt").
  2. Us store ki sabse latest quilt order dhoondo.
  3. Kabhi koi quilt order nahi aaya -> koi alert nahi ("no_quilt_orders_yet").
  4. Agar koi khula (open) alert hai aur uske baad nayi quilt order aa gayi
     -> alert resolve kar do (timer reset).
  5. Elapsed >= threshold aur koi open alert nahi -> naya alert banao.
  6. Elapsed >= threshold aur open alert pehle se hai -> duplicate mat banao.

Ek "open" alert = is rule + is store ka alert jiska resolved_at NULL hai.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

import models

QUILT_RULE_TITLE = "No Quilt Orders for 12 Hours"
DEFAULT_THRESHOLD_HOURS = 12.0


def _as_utc(value: datetime) -> datetime:
    """DB se aaya datetime hamesha timezone-aware (UTC) bana do."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _get_open_alert(db: Session, rule_id: int, store_id: int):
    return (
        db.query(models.AlertHistory)
        .filter(
            models.AlertHistory.alarm_rule_id == rule_id,
            models.AlertHistory.store_id == store_id,
            models.AlertHistory.resolved_at.is_(None),
        )
        .order_by(models.AlertHistory.triggered_at.desc())
        .first()
    )


def check_quilt_alarm(db: Session, store_id: int) -> dict:
    now = datetime.now(timezone.utc)

    store = db.query(models.Store).filter(models.Store.id == store_id).first()
    if not store:
        return {"status": "store_not_found", "store_id": store_id}

    rule = (
        db.query(models.AlarmRule)
        .filter(
            models.AlarmRule.title == QUILT_RULE_TITLE,
            models.AlarmRule.is_active.is_(True),
        )
        .first()
    )
    if not rule:
        return {"status": "no_active_rule", "store_id": store_id}

    threshold_hours = float(rule.threshold or DEFAULT_THRESHOLD_HOURS)

    # 1. Quilt products of this store
    quilt_product_ids = [
        p.id
        for p in db.query(models.Product.id).filter(
            models.Product.store_id == store_id,
            models.Product.category.ilike("%quilt%"),
        )
    ]
    if not quilt_product_ids:
        return {"status": "no_quilt_products", "store_id": store_id}

    # 2. Latest quilt order of this store
    last_quilt_order = (
        db.query(models.Order)
        .join(models.OrderItem, models.Order.id == models.OrderItem.order_id)
        .filter(
            models.Order.store_id == store_id,
            models.Order.created_at.isnot(None),
            models.Order.cancelled_at.is_(None),
            models.OrderItem.product_id.in_(quilt_product_ids),
        )
        .order_by(models.Order.created_at.desc())
        .first()
    )

    # 3. Never received a quilt order -> no alert
    if not last_quilt_order:
        return {"status": "no_quilt_orders_yet", "store_id": store_id}

    last_order_time = _as_utc(last_quilt_order.created_at)
    elapsed_hours = (now - last_order_time).total_seconds() / 3600

    base = {
        "store_id": store_id,
        "last_quilt_order_number": last_quilt_order.order_number,
        "last_quilt_order_at": last_order_time.isoformat(),
        "hours_elapsed": round(elapsed_hours, 2),
        "threshold_hours": threshold_hours,
    }

    try:
        open_alert = _get_open_alert(db, rule.id, store_id)
        resolved_alert_id = None

        # 4. New quilt order after the alert -> resolve it (timer reset)
        if open_alert and open_alert.triggered_at is not None:
            if last_order_time > _as_utc(open_alert.triggered_at):
                open_alert.resolved_at = now
                open_alert.status = "resolved"
                db.commit()
                resolved_alert_id = open_alert.id
                open_alert = None

        if elapsed_hours >= threshold_hours:
            # 6. Already alerted -> do not duplicate
            if open_alert:
                return {**base, "status": "alarm_active", "alert_id": open_alert.id}

            # 5. Create a new alert
            alert = models.AlertHistory(
                alarm_rule_id=rule.id,
                store_id=store_id,
                message=(
                    f"No quilt order for {round(elapsed_hours, 1)} hours "
                    f"in store '{store.store_name}'. "
                    f"Last quilt order: {last_quilt_order.order_number} "
                    f"at {last_order_time.isoformat()}."
                ),
                status="pending",
            )
            db.add(alert)
            db.commit()
            db.refresh(alert)
            return {**base, "status": "alarm_triggered", "alert_id": alert.id}

        result = {**base, "status": "normal"}
        if resolved_alert_id:
            result["resolved_alert_id"] = resolved_alert_id
        return result

    except Exception:
        db.rollback()
        raise
