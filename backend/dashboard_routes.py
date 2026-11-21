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
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from pydantic import BaseModel

import models
from cvr import fetch_daily_cvr, cvr_comparison
from cvr_alarm import check_cvr_alarm, CVR_RULE_TITLES, get_or_create_cvr_rule
from dependencies import get_db
from funnel import fetch_funnel, fetch_funnel_compare, fetch_funnel_trend
from quilt_alarm import check_quilt_alarm, RULE_TITLE as QUILT_RULE_TITLE
import smart_alerts
from recommendations import build_recommendations, set_status as set_recommendation_status, STATUSES as REC_STATUSES
from benchmarks import get_benchmarks
from order_health import fetch_order_health
from product_groups import fetch_product_analytics
from landing import fetch_landing_pages
from landing_grids import fetch_landing_grids
from site_health import fetch_site_health
from cart_extras import fetch_cart_extras
from overview import fetch_overview
from shopify_sync import ensure_fresh_orders
from sales import fetch_sales_trend, fetch_sales_breakdown
from segments import fetch_segment_split
from where_changed import fetch_where_changed
from geo import fetch_geo
from deeper import fetch_deeper
from overview_trends import fetch_overview_trends
from experiments import METRICS as EXPERIMENT_METRICS, delete_experiment, list_experiments, save_experiment
from change_log import list_change_log, create_change_log_entry, delete_change_log_entry, VALID_AREAS
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
    revenue = round(float(revenue or 0), 2)
    aov = round(revenue / orders, 2) if orders else 0.0
    return {"orders": orders, "revenue": revenue, "aov": aov, "quilt_orders": quilt_orders}


def _top_products(db: Session, store: models.Store, start, end, limit: int = 5) -> list[dict]:
    rows = (
        db.query(
            models.Product.product_name,
            models.Product.category,
            func.coalesce(func.sum(models.OrderItem.quantity), 0).label("qty"),
            func.coalesce(
                func.sum(models.OrderItem.quantity * models.OrderItem.unit_price), 0
            ).label("revenue"),
        )
        .join(models.OrderItem, models.OrderItem.product_id == models.Product.id)
        .join(models.Order, models.Order.id == models.OrderItem.order_id)
        .filter(
            models.Order.store_id == store.id,
            models.Order.cancelled_at.is_(None),
            models.Order.created_at >= start,
            models.Order.created_at < end,
        )
        .group_by(models.Product.id, models.Product.product_name, models.Product.category)
        .order_by(func.sum(models.OrderItem.quantity * models.OrderItem.unit_price).desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "name": name,
            "category": category,
            "quantity": int(qty),
            "revenue": round(float(revenue), 2),
        }
        for name, category, qty, revenue in rows
    ]


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


@router.get("/top-products")
def top_products(
    days: int = Query(1, ge=1, le=90),
    limit: int = Query(5, ge=1, le=20),
    period: str | None = Query(None, pattern="^(today|yesterday|last7)$"),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    store = _get_store(db, shop)
    if period == "today":
        ensure_fresh_orders(db, store)
    if period == "yesterday":
        start, end = _local_day_range_utc(store, 1)
        return {"days": 1, "period": period, "products": _top_products(db, store, start, end, limit)}
    if period == "last7":
        start, _ = _local_day_range_utc(store, 7)
        _, end = _local_day_range_utc(store, 1)
        return {"days": 7, "period": period, "products": _top_products(db, store, start, end, limit)}
    if days == 1:
        start, end = _local_day_range_utc(store, 0)
    else:
        start, _ = _local_day_range_utc(store, days - 1)
        _, end = _local_day_range_utc(store, 0)
    return {"days": days, "products": _top_products(db, store, start, end, limit)}


@router.get("/orders-trend")
def orders_trend(
    days: int = Query(7, ge=2, le=90),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    store = _get_store(db, shop)
    result = []
    for days_ago in range(days - 1, -1, -1):
        start, end = _local_day_range_utc(store, days_ago)
        stats = _order_stats(db, store, start, end)
        result.append({"date": start.date().isoformat(), **stats})
    return {"days": days, "trend": result}


@router.get("/funnel")
def funnel(shop: str | None = Query(None), db: Session = Depends(get_db)):
    store = _get_store(db, shop)
    try:
        return fetch_funnel(store)
    except Exception as exc:
        logger.exception("Funnel fetch failed")
        raise HTTPException(status_code=502, detail=f"Shopify analytics error: {str(exc)[:300]}")


@router.get("/funnel-compare")
def funnel_compare(
    period: str = Query("yesterday", pattern="^(today|yesterday|last7)$"),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Sessions -> product view -> cart -> checkout -> purchase, vs a comparison window."""
    store = _get_store(db, shop)
    try:
        return fetch_funnel_compare(store, period=period)
    except Exception as exc:
        logger.exception("Funnel compare failed")
        raise HTTPException(status_code=502, detail=f"Shopify analytics error: {str(exc)[:300]}")


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
    try:
        alarms["smart"] = smart_alerts.run_smart_alerts(db, store)
    except Exception as exc:
        db.rollback()
        logger.exception("Smart alerts failed")
        alarms["smart"] = {"status": "error", "detail": str(exc)[:300]}

    return {**result, "alarms": alarms}


# ---------------------------------------------------------------------------
# Alarm Rules (real data - pehle frontend mein hardcoded "demo" tha)
# ---------------------------------------------------------------------------

@router.get("/alarm-rules")
def list_alarm_rules(shop: str | None = Query(None), db: Session = Depends(get_db)):
    store = _get_store(db, shop)
    get_or_create_cvr_rule(db)  # purana CVR rule naye naam/description mein badal jaata hai
    smart_alerts.ensure_rules(db)  # manager checklist ke baaki alerts
    rules = db.query(models.AlarmRule).order_by(models.AlarmRule.id.asc()).all()

    out = []
    for rule in rules:
        last_triggered = (
            db.query(func.max(models.AlertHistory.triggered_at))
            .filter(
                models.AlertHistory.alarm_rule_id == rule.id,
                models.AlertHistory.store_id == store.id,
            )
            .scalar()
        )
        live_status = None
        live_detail = None
        if rule.is_active:
            try:
                if rule.title == QUILT_RULE_TITLE:
                    res = check_quilt_alarm(db, store.id)
                    live_status = res.get("status")
                    live_detail = _quilt_detail(res)
                elif rule.title in CVR_RULE_TITLES:
                    res = check_cvr_alarm(db, store)
                    live_status = res.get("status")
                    live_detail = _cvr_detail(res)
                elif rule.title in smart_alerts.RULES_BY_TITLE:
                    res = smart_alerts.evaluate(db, store, rule)
                    live_status = smart_alerts.live_status(res)
                    live_detail = res.get("detail")
            except Exception:
                logger.exception("Live status check failed for rule %s", rule.id)
                live_status = "error"

        out.append(
            {
                "id": rule.id,
                "title": rule.title,
                "description": rule.description,
                "threshold": rule.threshold,
                "is_active": rule.is_active,
                "last_checked_at": rule.last_checked_at.isoformat() if rule.last_checked_at else None,
                "last_triggered_at": last_triggered.isoformat() if last_triggered else None,
                "live_status": live_status,
                "live_detail": live_detail,
                "limit_text": _limit_text(rule),
                "page": _rule_page(rule),
            }
        )
    return out


def _limit_text(rule: models.AlarmRule) -> str | None:
    if rule.title in smart_alerts.RULES_BY_TITLE:
        return smart_alerts.limit_text(rule)
    if rule.threshold is None:
        return None
    if rule.title == QUILT_RULE_TITLE:
        return f"Limit: {rule.threshold:g}h without a quilt order"
    return f"Limit: {rule.threshold:g}% below average"


def _rule_page(rule: models.AlarmRule) -> str | None:
    if rule.title in smart_alerts.RULES_BY_TITLE:
        return smart_alerts.RULES_BY_TITLE[rule.title]["page"]
    if rule.title in CVR_RULE_TITLES:
        return "Conversion Analytics"
    if rule.title == QUILT_RULE_TITLE:
        return "Product Analytics"
    return None


def _quilt_detail(res: dict) -> str | None:
    hours = res.get("hours_elapsed")
    if hours is None:
        return None
    return f"Last quilt order {res.get('last_quilt_order_number')} was {hours:.1f}h ago (limit {res.get('threshold_hours'):g}h)."


def _cvr_detail(res: dict) -> str | None:
    if res.get("yesterday_date") is None:
        return None
    day = res.get("yesterday_weekday")
    if res.get("reason") == "too_few_sessions_yesterday":
        return f"Yesterday ({day}) had only {res.get('yesterday_sessions') or 0} sessions, too few to judge."
    if res.get("reason") == "not_enough_past_weeks":
        return f"Not enough past {day}s with data yet to build a 4-week average."
    drop = res.get("drop_percent")
    if drop is None:
        return None
    direction = f"{abs(drop):g}% below" if drop > 0 else f"{abs(drop):g}% above"
    text = (
        f"Yesterday ({day}) {res.get('yesterday_cvr')}% vs {day} 4-week avg "
        f"{res.get('baseline_cvr')}%: {direction}."
    )
    swing = res.get("swing_percent")
    if swing is not None:
        text += f" A normal day moves about {swing:g}% either way."
    if res.get("status") == "within_normal_swing":
        text += " Below the limit, but within twice the normal swing and only 1 day, so no alert yet."
    return text


class AlarmRulePatch(BaseModel):
    is_active: bool | None = None
    threshold: float | None = None


@router.patch("/alarm-rules/{rule_id}")
def update_alarm_rule(rule_id: int, patch: AlarmRulePatch, db: Session = Depends(get_db)):
    rule = db.query(models.AlarmRule).filter(models.AlarmRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Alarm rule not found")
    if patch.is_active is not None:
        rule.is_active = patch.is_active
    if patch.threshold is not None:
        rule.threshold = patch.threshold
    db.commit()
    db.refresh(rule)
    return {"id": rule.id, "is_active": rule.is_active, "threshold": rule.threshold}


# ---------------------------------------------------------------------------
# Settings (real data - pehle frontend mein hardcoded "demo" tha)
# ---------------------------------------------------------------------------

@router.get("/settings")
def get_settings(shop: str | None = Query(None), db: Session = Depends(get_db)):
    store = _get_store(db, shop)
    return {
        "store_name": store.store_name,
        "store_domain": store.store_url,
        "timezone": store.timezone,
        "currency": store.currency,
        "notification_email": store.notification_email,
        "email_alerts_enabled": store.email_alerts_enabled,
        "smtp_configured": bool(os.getenv("SMTP_HOST") or os.getenv("ALERT_EMAIL_TO")),
    }


class SettingsPatch(BaseModel):
    notification_email: str | None = None
    email_alerts_enabled: bool | None = None


@router.patch("/settings")
def update_settings(
    patch: SettingsPatch, shop: str | None = Query(None), db: Session = Depends(get_db)
):
    store = _get_store(db, shop)
    if patch.notification_email is not None:
        store.notification_email = patch.notification_email.strip() or None
    if patch.email_alerts_enabled is not None:
        store.email_alerts_enabled = patch.email_alerts_enabled
    db.commit()
    db.refresh(store)
    return {
        "notification_email": store.notification_email,
        "email_alerts_enabled": store.email_alerts_enabled,
    }


# ---------------------------------------------------------------------------
# Store Integration
# ---------------------------------------------------------------------------

@router.get("/store-info")
def store_info(shop: str | None = Query(None), db: Session = Depends(get_db)):
    store = _get_store(db, shop)
    return {
        "id": store.id,
        "name": store.store_name,
        "domain": store.store_url,
        "platform": store.platform,
        "timezone": store.timezone,
        "currency": store.currency,
        "connected_at": store.created_at.isoformat() if store.created_at else None,
        "last_synced_at": store.last_synced_at.isoformat() if store.last_synced_at else None,
        "auth_method": "Shopify client-credentials grant (app + store same organization)",
    }


# ---------------------------------------------------------------------------
# Product Analytics (full list, not just top 5)
# ---------------------------------------------------------------------------

@router.get("/product-performance")
def product_performance(
    days: int = Query(30, ge=1, le=90),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    store = _get_store(db, shop)
    if days == 1:
        start, end = _local_day_range_utc(store, 0)
    else:
        start, _ = _local_day_range_utc(store, days - 1)
        _, end = _local_day_range_utc(store, 0)

    products = _top_products(db, store, start, end, limit=10_000)
    if not products:
        return {"days": days, "products": []}

    revenues = sorted((p["revenue"] for p in products), reverse=True)
    top_cutoff = revenues[max(0, len(revenues) // 3 - 1)]
    low_cutoff = revenues[max(0, (2 * len(revenues)) // 3)]

    for p in products:
        if p["revenue"] >= top_cutoff:
            p["performance_status"] = "top"
        elif p["revenue"] <= low_cutoff:
            p["performance_status"] = "low"
        else:
            p["performance_status"] = "average"

    return {"days": days, "products": products}


@router.get("/product-analytics")
def product_analytics(
    days: int = Query(28, ge=7, le=60),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Product table, category comparison, four groups and fix-first list (checklist section 4)."""
    store = _get_store(db, shop)
    return fetch_product_analytics(db, store, days=days)


@router.get("/landing-grids")
def landing_grids(
    days: int = Query(28, ge=7, le=90),
    period: str | None = Query(None, pattern="^(today|yesterday)$"),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Landing page x source and device x page type grids (checklist section 3, P2)."""
    store = _get_store(db, shop)
    try:
        return fetch_landing_grids(store, days=days, period=period)
    except Exception as exc:
        logger.exception("Landing grids failed")
        raise HTTPException(status_code=502, detail=f"Shopify analytics error: {str(exc)[:300]}")


@router.get("/landing-pages")
def landing_pages(
    days: int = Query(28, ge=7, le=90),
    period: str | None = Query(None, pattern="^(today|yesterday)$"),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Landing pages, page types and bounce by source / device (checklist section 5)."""
    store = _get_store(db, shop)
    try:
        return fetch_landing_pages(store, days=days, period=period)
    except Exception as exc:
        logger.exception("Landing pages failed")
        raise HTTPException(status_code=502, detail=f"Shopify analytics error: {str(exc)[:300]}")


@router.get("/site-health")
def site_health(
    days: int = Query(28, ge=7, le=90),
    period: str | None = Query(None, pattern="^(today|yesterday)$"),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Core Web Vitals and site search (checklist section 7)."""
    store = _get_store(db, shop)
    try:
        return fetch_site_health(store, days=days, period=period)
    except Exception as exc:
        logger.exception("Site health failed")
        raise HTTPException(status_code=502, detail=f"Shopify analytics error: {str(exc)[:300]}")


@router.get("/cart-extras")
def cart_extras(
    days: int = Query(28, ge=7, le=90),
    period: str | None = Query(None, pattern="^(today|yesterday)$"),
    threshold: float | None = Query(None, ge=0),
    compare: str | None = Query(None, pattern="^(previous|last_week|4week_avg|4weeks_ago|last_year)$"),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Payment methods, order value histogram, items per order (checklist section 6)."""
    store = _get_store(db, shop)
    if period in ("today", "yesterday"):
        ensure_fresh_orders(db, store)  # order values / items come from our synced copy
    return fetch_cart_extras(db, store, days=days, threshold=threshold, period=period, compare=compare)


@router.post("/send-daily-report")
def send_daily_report_now(
    to: str | None = Query(None, description="Optional comma list; default DAILY_REPORT_TO"),
    dry_run: bool = Query(False, description="true = build the email and return it, don't send"),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Send yesterday's daily numbers email now (for testing). Doesn't block the scheduled send."""
    from daily_report import build_report, send_daily_report

    store = _get_store(db, shop)
    if dry_run:
        subject, body = build_report(db, store)
        return {"status": "dry_run", "subject": subject, "preview": body}
    recipients = [a.strip() for a in to.split(",") if a.strip()] if to else None
    return send_daily_report(db, store, force=True, to=recipients)


@router.get("/clarity-status")
def clarity_status(shop: str | None = Query(None), db: Session = Depends(get_db)):
    """Is Microsoft Clarity connected, and how many days of product views are saved?"""
    import clarity

    store = _get_store(db, shop)
    days = (
        db.query(models.ClarityProductDay.day, func.count(models.ClarityProductDay.id), func.sum(models.ClarityProductDay.sessions))
        .filter(models.ClarityProductDay.store_id == store.id)
        .group_by(models.ClarityProductDay.day)
        .order_by(models.ClarityProductDay.day.desc())
        .limit(60)
        .all()
    )
    handles = {
        h for (h,) in db.query(models.Product.handle).filter(models.Product.store_id == store.id, models.Product.handle.isnot(None))
    }
    latest_handles = (
        {h for (h,) in db.query(models.ClarityProductDay.handle).filter(
            models.ClarityProductDay.store_id == store.id, models.ClarityProductDay.day == days[0][0])}
        if days else set()
    )
    return {
        "token_set": clarity.token() is not None,
        "last_status": clarity.last_status,
        "days_saved": len(days),
        "days": [{"day": d.isoformat(), "products": n, "views": int(v or 0)} for d, n, v in days],
        "latest_day_products_matched": len(latest_handles & {h.lower() for h in handles}),
        "latest_day_products_unmatched": len(latest_handles - {h.lower() for h in handles}),
    }


# ---------------------------------------------------------------------------
# Cart & Checkout Analytics (funnel trend)
# ---------------------------------------------------------------------------

@router.get("/funnel-trend")
def funnel_trend(
    days: int = Query(7, ge=2, le=60),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    store = _get_store(db, shop)
    try:
        return {"days": days, "trend": fetch_funnel_trend(store, days=days)}
    except Exception as exc:
        logger.exception("Funnel trend failed")
        raise HTTPException(status_code=502, detail=f"Shopify analytics error: {str(exc)[:300]}")


# ---------------------------------------------------------------------------
# CRO Recommendations
# ---------------------------------------------------------------------------

class RecommendationStatusIn(BaseModel):
    key: str
    status: str


@router.post("/recommendations/status")
def recommendation_status(body: RecommendationStatusIn, shop: str | None = Query(None), db: Session = Depends(get_db)):
    """Save the team's status for one recommendation (open / in_progress / done / ignored)."""
    if body.status not in REC_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {', '.join(REC_STATUSES)}")
    store = _get_store(db, shop)
    return set_recommendation_status(db, store, body.key, body.status)


@router.get("/recommendations")
def recommendations(
    days: int = Query(30, ge=7, le=60),
    period: str | None = Query(None, pattern="^yesterday$"),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """One list of recommendations from every page, ranked by estimated impact (checklist section 8)."""
    store = _get_store(db, shop)
    try:
        return build_recommendations(db, store, days=days, period=period)
    except Exception as exc:
        logger.exception("Recommendations failed")
        raise HTTPException(status_code=502, detail=f"Shopify analytics error: {str(exc)[:300]}")


# ---------------------------------------------------------------------------
# Industry benchmarks (static, cited reference points - not live data)
# ---------------------------------------------------------------------------

@router.get("/benchmarks")
def benchmarks():
    return get_benchmarks()


# ---------------------------------------------------------------------------
# Order health (paid / refunded / cancelled breakdown - local data only)
# ---------------------------------------------------------------------------

@router.get("/order-health")
def order_health(
    days: int = Query(30, ge=1, le=90),
    period: str | None = Query(None, pattern="^(today|yesterday)$"),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Order status mix for orders placed in the window, read live from Shopify."""
    store = _get_store(db, shop)
    return fetch_order_health(db, store, days=days, period=period)


# ---------------------------------------------------------------------------
# Overview v2 - trustworthy numbers (manager checklist, section 1 fix-first +
# section 2 period controls). Default period is "yesterday" (a complete day);
# comparison is same-weekday, not the day before; low-traffic periods say
# "too early to compare" instead of printing a noisy %.
# ---------------------------------------------------------------------------

def _picked_day(value: str | None):
    """Calendar date (YYYY-MM-DD) from the Overview period bar, last 365 days only."""
    if not value:
        return None
    from datetime import date as _date
    try:
        d = _date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail="Date must be YYYY-MM-DD")
    if d < _date.today() - timedelta(days=366):
        raise HTTPException(status_code=400, detail="Pick a date within the last 12 months")
    return d


@router.get("/overview")
def overview(
    period: str = Query("yesterday", pattern="^(yesterday|today|last7)$"),
    compare: str = Query("4week_avg", pattern="^(4week_avg|last_week)$"),
    date: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    store = _get_store(db, shop)
    # Pull the latest orders first if our copy is stale (backend was asleep).
    ensure_fresh_orders(db, store)
    return fetch_overview(db, store, period=period, compare=compare, day=_picked_day(date))


# ---------------------------------------------------------------------------
# "Total sales over time" + "Total sales breakdown" (manager's ask: bring
# Shopify's own Analytics-page sales widgets onto our dashboard, from real
# order data already in our database - no new Shopify scopes needed).
# ---------------------------------------------------------------------------

@router.get("/sales-trend")
def sales_trend(
    days: int = Query(14, ge=2, le=90),
    include_today: bool = Query(False),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    store = _get_store(db, shop)
    if include_today:
        ensure_fresh_orders(db, store)  # today's bar must be current
    return fetch_sales_trend(db, store, days=days, include_today=include_today)


@router.get("/funnel-devices")
def funnel_devices(
    period: str = Query("yesterday", pattern="^(today|yesterday|last7)$"),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    from overview_extras import fetch_device_funnel

    store = _get_store(db, shop)
    try:
        return fetch_device_funnel(store, period=period)
    except Exception as exc:
        logger.exception("Device funnel failed")
        raise HTTPException(status_code=502, detail=f"Shopify analytics error: {str(exc)[:300]}")


@router.get("/kpi-calendar")
def kpi_calendar(
    days: int = Query(35, ge=7, le=56),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Overview card popup: every day's numbers for the last `days` complete days."""
    from kpi_calendar import fetch_kpi_calendar

    store = _get_store(db, shop)
    return fetch_kpi_calendar(db, store, days=days)


@router.get("/kpi-totals")
def kpi_totals(shop: str | None = Query(None), db: Session = Depends(get_db)):
    from overview_extras import fetch_kpi_totals

    store = _get_store(db, shop)
    ensure_fresh_orders(db, store)
    return fetch_kpi_totals(db, store)


@router.get("/buy-heatmap")
def buy_heatmap(
    days: int = Query(28, ge=7, le=56),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    from overview_extras import fetch_buy_heatmap

    store = _get_store(db, shop)
    try:
        return fetch_buy_heatmap(store, days=days, db=db)
    except Exception as exc:
        logger.exception("Buy heatmap failed")
        raise HTTPException(status_code=502, detail=f"Shopify analytics error: {str(exc)[:300]}")


@router.get("/sales-breakdown")
def sales_breakdown(
    period: str = Query("yesterday", pattern="^(yesterday|today|last7)$"),
    compare: str = Query("4week_avg", pattern="^(4week_avg|last_week)$"),
    date: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    store = _get_store(db, shop)
    return fetch_sales_breakdown(db, store, period=period, compare=compare, day=_picked_day(date))


# ---------------------------------------------------------------------------
# Device / channel split (manager checklist, section 3 P1). Same ShopifyQL
# `sessions` schema as cvr.py/funnel.py, just GROUP BY device or referrer.
# ---------------------------------------------------------------------------

@router.get("/where-changed")
def where_changed(
    period: str = Query("yesterday", pattern="^(yesterday|days)$"),
    days: int = Query(7, ge=2, le=28),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Overview "Where it changed" (device / channel) + "Top movers" (checklist section 2, P2)."""
    store = _get_store(db, shop)
    try:
        return fetch_where_changed(store, period=period, days=days)
    except Exception as exc:
        logger.exception("Where-changed failed")
        raise HTTPException(status_code=502, detail=f"Shopify analytics error: {str(exc)[:300]}")


@router.get("/geo")
def geo(
    period: str = Query("days", pattern="^(yesterday|days)$"),
    days: int = Query(28, ge=2, le=28),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Conversion by country and US state (checklist section 3, P2)."""
    store = _get_store(db, shop)
    try:
        return fetch_geo(store, period=period, days=days)
    except Exception as exc:
        logger.exception("Geo split failed")
        raise HTTPException(status_code=502, detail=f"Shopify analytics error: {str(exc)[:300]}")


@router.get("/segments")
def segments(
    dimension: str = Query("device", pattern="^(device|channel)$"),
    days: int = Query(7, ge=1, le=30),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    store = _get_store(db, shop)
    try:
        return fetch_segment_split(db, store, dimension=dimension, days=days)
    except Exception as exc:
        logger.exception("Segment split failed")
        raise HTTPException(status_code=502, detail=f"Shopify analytics error: {str(exc)[:300]}")


# ---------------------------------------------------------------------------
# Change log (manager checklist, section 8 P1). Manual log - team records
# what they changed (theme/app/price/promo/ad); markers on trend charts use
# this same list client-side.
# ---------------------------------------------------------------------------

class ChangeLogCreate(BaseModel):
    date: date
    change: str
    area: str = "other"
    owner: str | None = None


@router.get("/change-log")
def change_log(
    days: int = Query(90, ge=1, le=365),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    store = _get_store(db, shop)
    return {"days": days, "valid_areas": sorted(VALID_AREAS), "entries": list_change_log(db, store, days=days)}


@router.post("/change-log")
def create_change_log(
    body: ChangeLogCreate,
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    if not body.change.strip():
        raise HTTPException(status_code=400, detail="change cannot be empty")
    store = _get_store(db, shop)
    return create_change_log_entry(db, store, body.date, body.change, body.area, body.owner)


@router.delete("/change-log/{entry_id}")
def remove_change_log(
    entry_id: int,
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    store = _get_store(db, shop)
    ok = delete_change_log_entry(db, store, entry_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Change log entry not found")
    return {"deleted": entry_id}


# ---------------------------------------------------------------------------
# Experiment log (manager checklist, section 8 P3). The team saves the plan;
# result and confidence are worked out from Shopify on every read.
# ---------------------------------------------------------------------------

class ExperimentIn(BaseModel):
    name: str
    hypothesis: str
    metric: str
    start_date: date
    end_date: date | None = None
    page_path: str | None = None
    owner: str | None = None
    rec_key: str | None = None


@router.get("/experiments")
def experiments(shop: str | None = Query(None), db: Session = Depends(get_db)):
    store = _get_store(db, shop)
    return {
        "metrics": [{"key": k, **v} for k, v in EXPERIMENT_METRICS.items()],
        "experiments": list_experiments(db, store),
    }


@router.post("/experiments")
def create_experiment(body: ExperimentIn, shop: str | None = Query(None), db: Session = Depends(get_db)):
    store = _get_store(db, shop)
    try:
        return save_experiment(db, store, body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.put("/experiments/{exp_id}")
def update_experiment(exp_id: int, body: ExperimentIn, shop: str | None = Query(None), db: Session = Depends(get_db)):
    store = _get_store(db, shop)
    try:
        return save_experiment(db, store, body.model_dump(), exp_id=exp_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except LookupError:
        raise HTTPException(status_code=404, detail="Experiment not found")


@router.delete("/experiments/{exp_id}")
def remove_experiment(exp_id: int, shop: str | None = Query(None), db: Session = Depends(get_db)):
    store = _get_store(db, shop)
    if not delete_experiment(db, store, exp_id):
        raise HTTPException(status_code=404, detail="Experiment not found")
    return {"deleted": exp_id}


# ---------------------------------------------------------------------------
# Deeper analyses (manager checklist, section 9): price bands, discount codes,
# bought-together pairs. Read-only from Shopify, cached 30 min.
# ---------------------------------------------------------------------------

@router.get("/deeper")
def deeper(
    days: int = Query(30, ge=7, le=60),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    store = _get_store(db, shop)
    try:
        return fetch_deeper(db, store, days=days)
    except Exception as exc:
        logger.exception("Deeper analyses failed")
        raise HTTPException(status_code=502, detail=f"Shopify error: {str(exc)[:300]}")


@router.get("/overview-trends")
def overview_trends(
    days: int = Query(14, ge=7, le=60),
    shop: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """AOV over time, sessions over time and sales by channel (Shopify Overview widgets)."""
    store = _get_store(db, shop)
    try:
        return fetch_overview_trends(store, days=days)
    except Exception as exc:
        logger.exception("Overview trends failed")
        raise HTTPException(status_code=502, detail=f"Shopify analytics error: {str(exc)[:300]}")
