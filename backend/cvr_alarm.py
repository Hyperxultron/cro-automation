"""
Conversion Rate Drop Alarm

Rule: Kal ka CVR pichhle 4 hafton ke ussi weekday ke average se 20% (threshold)
ya zyada gira -> alert. (Kal Tuesday tha -> pichhle 4 Tuesdays ka average.)
  Percentage Drop = ((4-week avg CVR - Yesterday CVR) / 4-week avg CVR) * 100
Manager checklist: shor (noise) pe alert na aaye - isliye alert tabhi jab
  (a) gir "normal daily swing" ke 2x se zyada ho, ya
  (b) lagatar 2 din threshold se zyada gira ho.

- Kal 30 se kam sessions, ya 3 se kam purane hafton ka data -> koi alert nahi
  ("insufficient_data")
- Ek store + ek date ke liye sirf ek alert (duplicate nahi)
"""

from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

import models
from cvr import cvr_normal_swing, cvr_vs_weekday_average, fetch_daily_cvr
from emailer import send_alert_email

CVR_RULE_TITLE = "Conversion Rate Drop vs 4-Week Average"
LEGACY_CVR_TITLES = ("Conversion Rate Drop 20%",)
CVR_RULE_TITLES = (CVR_RULE_TITLE, *LEGACY_CVR_TITLES)
CVR_RULE_DESCRIPTION = (
    "Alerts when yesterday's conversion rate is 20% or more below the average "
    "of the same weekday over the last 4 weeks, and the drop is at least twice the "
    "normal daily swing or has lasted 2 days in a row. Skipped on days under 30 sessions."
)
DEFAULT_DROP_THRESHOLD = 20.0


def get_or_create_cvr_rule(db: Session) -> models.AlarmRule:
    rule = db.query(models.AlarmRule).filter(models.AlarmRule.title.in_(CVR_RULE_TITLES)).first()
    if not rule:
        rule = models.AlarmRule(
            title=CVR_RULE_TITLE,
            description=CVR_RULE_DESCRIPTION,
            threshold=DEFAULT_DROP_THRESHOLD,
            is_active=True,
        )
        db.add(rule)
        db.commit()
        db.refresh(rule)
    elif rule.title != CVR_RULE_TITLE or rule.description != CVR_RULE_DESCRIPTION:
        # Purana "kal vs parso" rule -> naye 4-week rule mein badlo (history wahi rehti hai)
        rule.title = CVR_RULE_TITLE
        rule.description = CVR_RULE_DESCRIPTION
        db.commit()
        db.refresh(rule)
    return rule


def check_cvr_alarm(db: Session, store: models.Store) -> dict:
    rule = get_or_create_cvr_rule(db)
    rule.last_checked_at = datetime.now(timezone.utc)
    db.commit()
    if not rule.is_active:
        return {"status": "rule_inactive"}

    threshold = float(rule.threshold or DEFAULT_DROP_THRESHOLD)
    # 35 din = 4 purane same-weekdays + kal (overview bhi 35 hi mangta hai -> cache share)
    # 63 din = kal + pichhle 28 din (normal swing) + har din ke 4 purane weekdays
    daily = fetch_daily_cvr(db, store, days=63)
    comparison = cvr_vs_weekday_average(daily, store)
    day_before = cvr_vs_weekday_average(
        daily, store, target=date.fromisoformat(comparison["yesterday_date"]) - timedelta(days=1)
    )
    swing = cvr_normal_swing(daily, store)
    base = {
        "store_id": store.id,
        "threshold_percent": threshold,
        **comparison,
        **swing,
        "day_before_drop_percent": day_before["drop_percent"],
    }

    if comparison["drop_percent"] is None:
        return {**base, "status": "insufficient_data"}

    drop = comparison["drop_percent"]
    big_vs_swing = swing["swing_percent"] is None or drop >= 2 * swing["swing_percent"]
    two_days = (day_before["drop_percent"] or 0) >= threshold
    base["fired_because"] = "two_days" if two_days and not big_vs_swing else "big_vs_swing"
    if drop < threshold:
        return {**base, "status": "normal"}
    if not (big_vs_swing or two_days):
        return {**base, "status": "within_normal_swing"}

    marker = f"[{comparison['yesterday_date']}]"
    existing = (
        db.query(models.AlertHistory)
        .filter(
            models.AlertHistory.alarm_rule_id == rule.id,
            models.AlertHistory.store_id == store.id,
            models.AlertHistory.message.like(f"{marker}%"),
        )
        .first()
    )
    if existing:
        return {**base, "status": "alarm_active", "alert_id": existing.id}

    message = (
        f"{marker} Conversion rate in '{store.store_name}' was "
        f"{comparison['yesterday_cvr']}% on {comparison['yesterday_weekday']} "
        f"({comparison['yesterday_date']}, {comparison['yesterday_sessions']:,} sessions), "
        f"{comparison['drop_percent']}% below the {comparison['yesterday_weekday']} average of the "
        f"last {len(comparison['baseline_days'])} weeks ({comparison['baseline_cvr']}%)."
    )
    if base["fired_because"] == "two_days":
        message += f" Second day in a row: the day before was {day_before['drop_percent']}% below its own weekday average."
    elif swing["swing_percent"] is not None:
        message += f" A normal day moves about {swing['swing_percent']}% either way, so this is more than twice the usual swing."
    message += "\nOpen: Ridhi Pulse > Conversion Analytics (https://cro-automation-1.onrender.com/)"
    try:
        alert = models.AlertHistory(
            alarm_rule_id=rule.id,
            store_id=store.id,
            message=message,
            status="pending",
        )
        db.add(alert)
        db.commit()
        db.refresh(alert)

        email_override = (
            store.notification_email if store.email_alerts_enabled and store.notification_email else None
        )
        if store.email_alerts_enabled is False:
            alert.status = "email_disabled"
        else:
            sent = send_alert_email("CVR Drop Alarm Triggered", message, override_to=email_override)
            alert.status = "sent" if sent else "email_failed"
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {**base, "status": "alarm_triggered", "alert_id": alert.id}
