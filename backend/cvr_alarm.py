"""
Conversion Rate Drop Alarm

Rule: Kal ka CVR parso ke CVR se 20% (threshold) ya zyada gira -> alert.
  Percentage Drop = ((Previous CVR - Yesterday CVR) / Previous CVR) * 100

- Previous CVR 0 ya missing -> koi alert nahi ("insufficient_data")
- Ek store + ek date ke liye sirf ek alert (duplicate nahi)
"""

from sqlalchemy.orm import Session

import models
from cvr import cvr_comparison, fetch_daily_cvr

CVR_RULE_TITLE = "Conversion Rate Drop 20%"
DEFAULT_DROP_THRESHOLD = 20.0


def get_or_create_cvr_rule(db: Session) -> models.AlarmRule:
    rule = db.query(models.AlarmRule).filter(models.AlarmRule.title == CVR_RULE_TITLE).first()
    if not rule:
        rule = models.AlarmRule(
            title=CVR_RULE_TITLE,
            description="Alert when yesterday's CVR drops 20% or more vs the previous day.",
            threshold=DEFAULT_DROP_THRESHOLD,
            is_active=True,
        )
        db.add(rule)
        db.commit()
        db.refresh(rule)
    return rule


def check_cvr_alarm(db: Session, store: models.Store) -> dict:
    rule = get_or_create_cvr_rule(db)
    if not rule.is_active:
        return {"status": "rule_inactive"}

    threshold = float(rule.threshold or DEFAULT_DROP_THRESHOLD)
    comparison = cvr_comparison(fetch_daily_cvr(db, store, days=7), store)
    base = {"store_id": store.id, "threshold_percent": threshold, **comparison}

    if comparison["drop_percent"] is None:
        return {**base, "status": "insufficient_data"}

    if comparison["drop_percent"] < threshold:
        return {**base, "status": "normal"}

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

    try:
        alert = models.AlertHistory(
            alarm_rule_id=rule.id,
            store_id=store.id,
            message=(
                f"{marker} Conversion rate dropped {comparison['drop_percent']}% in "
                f"'{store.store_name}': {comparison['previous_cvr']}% "
                f"({comparison['previous_date']}) -> {comparison['yesterday_cvr']}% "
                f"({comparison['yesterday_date']})."
            ),
            status="pending",
        )
        db.add(alert)
        db.commit()
        db.refresh(alert)
    except Exception:
        db.rollback()
        raise

    return {**base, "status": "alarm_triggered", "alert_id": alert.id}
