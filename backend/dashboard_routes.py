"""
Dashboard API - real Shopify data (database + Shopify Analytics).

Endpoints:
  GET  /dashboard/summary     -> KPI cards + dono alarms ka status
  GET  /dashboard/cvr-trend   -> daily conversion rate (chart)
  GET  /dashboard/alerts      -> alert history (sirf is store ki)
  POST /dashboard/sync        -> Shopify se latest data + alarms check
"""

import logging
import os
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from cvr import fetch_daily_cvr, cvr_comparison
from cvr_alarm import check_cvr_alarm
from dependencies import get_db
from quilt_alarm import check_quilt_alarm
from shopify_sync import sync_store

logger = logging.getLogger("dashboard")
router = APIRouter(prefix="/dashboard", tags=["dashboard"])

DEFAULT_SHOP = os.getenv("SHOPIFY_SHOP", "guz0he-21.myshopify.com")


def _get_store(db: Session, shop: str | None) -> models.Store:
    store = (
        db.query(models.Store)
        .filter(models.Store.store_url == (shop or DEFAULT_SHOP))
        .first()
    )
    if not store:
        raise HTTPException(status_code=404, detail="Store not synced yet. Run sync first.")
    return store


def _local_day_range_utc(store: models.Store, days_ago: int = 0):
    tz = ZoneInfo(store.timezone or "UTC")
    day = datetime.now(tz).date() - timedelta(days=days_ago)
    start = datetime.combine(day, time.min, tzinfo=tz)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


def _order_stats(db: Session, store: models.Store, start, end) -> dict:
    base = db.query(models.Order).filter(
        models.Order.store_id == store.id,
        models.Order.shopify_order_id.isnot(None),
        models.Order.cancelled_at.is_(None),
        models.Order.created_at >= start,
        models.Order.created_at < end,
    )
    orders = base.count()
    revenue = base.with_entities(func.coalesce(func.sum(models.Order.total_amount), 0)).scalar()

    quilt_orders = (
        base.join(models.OrderItem, models.OrderItem.order_id == models.Order.id)
        .join(models.Product, models.Product.id == models.OrderItem.product_id)
        .filter(models.Product.category == "Quilt")
        .with_entities(func.count(func.distinct(models.Order.id)))
        .scalar()
    )
    return {"orders": orders, "revenue": round(float(revenue or 0), 2), "quilt_orders": quilt_orders}


def _pct_change(current, previous):
    if not previous:
        return None
    return round((current - previous) / previous * 100, 1)


@router.get("/summary")
def dashboard_summary(shop: str | None = Query(None), db: Session = Depends(get_db)):
    store = _get_store(db, shop)

    today_start, _ = _local_day_range_utc(store, 0)
    y_start, y_end = _local_day_range_utc(store, 1)
    elapsed = datetime.now(timezone.utc) - today_start

    today = _order_stats(db, store, today_start, datetime.now(timezone.utc))
    yesterday = _order_stats(db, store, y_start, y_end)
    # Fair comparison: aaj abhi tak vs kal isi samay tak
    yesterday_same_time = _order_stats(db, store, y_start, y_start + elapsed)

    # Alarm statuses (yeh check alert bhi bana sakte hain - wahi monitoring hai)
    quilt = check_quilt_alarm(db, store.id)

    cvr_error = None
    try:
        cvr = cvr_comparison(fetch_daily_cvr(db, store, days=7), store)
    except Exception as exc:  # Shopify analytics na mile toh dashboard band na ho
        logger.exception("CVR fetch failed")
        cvr, cvr_error = None, str(exc)[:300]

    active_rules = db.query(models.AlarmRule).filter(models.AlarmRule.is_active.is_(True)).count()
    open_alerts = (
        db.query(models.AlertHistory)
        .filter(
            models.AlertHistory.store_id == store.id,
            models.AlertHistory.resolved_at.is_(None),
            models.AlertHistory.status != "resolved",
        )
        .count()
    )

    return {
        "store": {
            "id": store.id,
            "name": store.store_name,
            "domain": store.store_url,
            "timezone": store.timezone,
            "currency": store.currency,
            "last_synced_at": store.last_synced_at.isoformat() if store.last_synced_at else None,
        },
        "today": today,
        "yesterday": yesterday,
        "yesterday_same_time": yesterday_same_time,
        "changes": {
            "orders_pct": _pct_change(today["orders"], yesterday_same_time["orders"]),
            "quilt_orders_pct": _pct_change(
                today["quilt_orders"], yesterday_same_time["quilt_orders"]
            ),
        },
        "cvr": cvr,
        "cvr_error": cvr_error,
        "quilt_alarm": quilt,
        "active_rules": active_rules,
        "open_alerts": open_alerts,
    }


@router.get("/cvr-trend")
def cvr_trend(
    days: int = Query(7, ge=2, le=90),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    store = _get_store(db, shop)
    try:
        return {"store_id": store.id, "days": fetch_daily_cvr(db, store, days=days)}
    except Exception as exc:
        logger.exception("CVR trend failed")
        raise HTTPException(status_code=502, detail=f"Shopify analytics error: {str(exc)[:300]}")


@router.get("/alerts")
def dashboard_alerts(
    limit: int = Query(50, ge=1, le=500),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    store = _get_store(db, shop)
    rows = (
        db.query(models.AlertHistory, models.AlarmRule.title)
        .outerjoin(models.AlarmRule, models.AlarmRule.id == models.AlertHistory.alarm_rule_id)
        .filter(models.AlertHistory.store_id == store.id)
        .order_by(models.AlertHistory.triggered_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": alert.id,
            "rule": title,
            "message": alert.message,
            "status": alert.status,
            "triggered_at": alert.triggered_at.isoformat() if alert.triggered_at else None,
            "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
        }
        for alert, title in rows
    ]


@router.post("/sync")
def dashboard_sync(
    days: int = Query(2, ge=1, le=60),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    try:
        result = sync_store(db, shop or DEFAULT_SHOP, days=days)
    except Exception as exc:
        logger.exception("Sync failed")
        raise HTTPException(status_code=502, detail=f"Shopify sync failed: {str(exc)[:300]}")

    if result.get("status") == "skipped":
        return result

    store = _get_store(db, shop)
    alarms = {"quilt": check_quilt_alarm(db, store.id)}
    try:
        alarms["cvr"] = check_cvr_alarm(db, store)
    except Exception as exc:
        logger.exception("CVR alarm failed")
        alarms["cvr"] = {"status": "error", "detail": str(exc)[:300]}

    return {**result, "alarms": alarms}
