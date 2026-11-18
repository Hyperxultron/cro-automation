"""
Quilt Order Monitoring Alarm.

Rule: Agar `threshold` hours tak koi qualifying (quilt) order nahi aaya -> alert.
- Naya quilt order aane par purana open alert "resolved" ho jaata hai (timer reset).
- Ek store ke liye ek time par sirf ek open alert (duplicate nahi banta).
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

import models

RULE_TITLE = "No Quilt Orders for 12 Hours"


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


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
    rule = (
        db.query(models.AlarmRule)
        .filter(models.AlarmRule.title == RULE_TITLE, models.AlarmRule.is_active.is_(True))
        .first()
    )
    if not rule:
        return {"status": "no_active_rule"}

    threshold_hours = float(rule.threshold or 12)

    quilt_product_ids = [
        p.id
        for p in db.query(models.Product.id).filter(
            models.Product.store_id == store_id,
            models.Product.category.ilike("%quilt%"),
        )
    ]
    if not quilt_product_ids:
        return {"status": "no_quilt_products", "threshold_hours": threshold_hours}

    last_quilt_order = (
        db.query(models.Order)
        .join(models.OrderItem, models.Order.id == models.OrderItem.order_id)
        .filter(
            models.Order.store_id == store_id,
            models.Order.cancelled_at.is_(None),
            models.OrderItem.product_id.in_(quilt_product_ids),
        )
        .order_by(models.Order.created_at.desc())
        .first()
    )

    open_alert = _get_open_alert(db, rule.id, store_id)

    if not last_quilt_order:
        return {"status": "no_quilt_orders_yet", "threshold_hours": threshold_hours}

    now = datetime.now(timezone.utc)
    last_order_time = _as_utc(last_quilt_order.created_at)
    elapsed_hours = round((now - last_order_time).total_seconds() / 3600, 2)

    base = {
        "store_id": store_id,
        "threshold_hours": threshold_hours,
        "last_quilt_order_number": last_quilt_order.order_number,
        "last_quilt_order_at": last_order_time.isoformat(),
        "hours_elapsed": elapsed_hours,
    }

    # Naya order open alert ke baad aaya -> resolve kar do (timer reset)
    if open_alert and last_order_time > _as_utc(open_alert.triggered_at):
        open_alert.resolved_at = now
        open_alert.status = "resolved"
        db.commit()
        open_alert = None

    if elapsed_hours < threshold_hours:
        return {**base, "status": "normal"}

    if open_alert:
        return {**base, "status": "alarm_active", "alert_id": open_alert.id}

    from emailer import send_alert_email  # local import, circular-import se bachne ke liye

    message = (
        f"No qualifying quilt order for store {store_id} in the last "
        f"{elapsed_hours}h (threshold {threshold_hours}h). "
        f"Last quilt order: {last_quilt_order.order_number}."
    )
    alert = models.AlertHistory(
        alarm_rule_id=rule.id,
        store_id=store_id,
        message=message,
        status="pending",
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)

    alert.status = "sent" if send_alert_email("Quilt Order Alarm Triggered", message) else "email_failed"
    db.commit()

    return {**base, "status": "alarm_triggered", "alert_id": alert.id}
