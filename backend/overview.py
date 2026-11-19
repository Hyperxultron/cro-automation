"""
Overview "fix-first" logic (manager checklist, section 1 + section 2 P1 items).

Why this file exists: the old /dashboard/summary always showed "Today" and
"Yesterday" side by side and compared "today so far" to "yesterday same time",
which is really a day-before comparison. The manager's checklist specifically
asks us to stop doing that:

  - Default the period to yesterday (a complete day); "Today so far" is a toggle.
  - Compare with the same weekday last week, or the 4-week same-weekday
    average - not the day before.
  - Below ~20 orders or ~500 sessions, say "too early to compare" instead of
    printing a % change that is mostly noise.
  - Label the period on every KPI card.

This module is additive: it does not touch /dashboard/summary (still used by
the alarm cards), it only powers the new /dashboard/overview endpoint.
"""

from datetime import datetime, timedelta, time as dtime, timezone as dt_tz
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from cvr import fetch_daily_cvr

# Traffic-based thresholds from the checklist ("about 70 orders and 2,800
# sessions a day" as of 19 Nov 2026 - re-check if traffic changes a lot).
MIN_ORDERS_FOR_COMPARISON = 20
MIN_SESSIONS_FOR_COMPARISON = 500

WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _tz(store: models.Store) -> ZoneInfo:
    return ZoneInfo(store.timezone or "UTC")


def _day_bounds_utc(day, tz: ZoneInfo):
    start = datetime.combine(day, dtime.min, tzinfo=tz)
    return start.astimezone(dt_tz.utc), (start + timedelta(days=1)).astimezone(dt_tz.utc)


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
    revenue = round(float(revenue or 0), 2)
    aov = round(revenue / orders, 2) if orders else 0.0
    return {"orders": orders, "revenue": revenue, "aov": aov}


def history_start_date(db: Session, store: models.Store):
    """
    First local day we actually have synced orders for. Any baseline day before
    this is "no data", not "zero orders" - treating it as 0 is what made the
    Overview print "vs $0 baseline" / "4-week Wed average: 0".
    """
    first = (
        db.query(func.min(models.Order.created_at))
        .filter(models.Order.store_id == store.id, models.Order.shopify_order_id.isnot(None))
        .scalar()
    )
    if first is None:
        return None
    if first.tzinfo is None:
        first = first.replace(tzinfo=dt_tz.utc)
    # The first day is usually only partly synced, so start from the day after.
    return first.astimezone(_tz(store)).date() + timedelta(days=1)


def _has_history(history_start, day) -> bool:
    return history_start is not None and day >= history_start


def _pct_change(current, previous):
    if previous is None or previous == 0:
        return None
    return round((current - previous) / previous * 100, 2)


def _metric_block(value, baseline, too_early: bool, baseline_label: str, round_abs: int = 2):
    """value/baseline -> {value, baseline_value, change_abs, change_pct, too_early, baseline_label}."""
    change_abs = None if (value is None or baseline is None) else round(value - baseline, round_abs)
    if round_abs == 0 and change_abs is not None:
        change_abs = int(change_abs) if float(change_abs).is_integer() else round(change_abs, 1)
    change_pct = None if too_early else _pct_change(value, baseline)
    return {
        "value": value,
        "baseline_value": baseline,
        "baseline_label": baseline_label,
        "change_abs": change_abs if not too_early else None,
        "change_pct": change_pct,
        "too_early": too_early,
    }


def _same_weekday_dates_back(target_date, weeks_back: int) -> list:
    return [target_date - timedelta(days=7 * w) for w in range(1, weeks_back + 1)]


def fetch_overview(
    db: Session,
    store: models.Store,
    period: str = "yesterday",
    compare: str = "4week_avg",
) -> dict:
    """
    period: "yesterday" | "today" | "last7"
    compare: "4week_avg" | "last_week" (ignored for period="last7", which always
             compares to the prior 7-day window - that's what "Last 7 vs prior 7" means)
    """
    tz = _tz(store)
    now_local = datetime.now(tz)
    today_date = now_local.date()
    yesterday_date = today_date - timedelta(days=1)

    warnings: list[str] = []

    # ---- 1. Figure out the window + comparison window ----------------------
    if period == "today":
        target_date = today_date
        start, _ = _day_bounds_utc(target_date, tz)
        end = datetime.now(dt_tz.utc)
        is_partial = True
        elapsed = end - start
        period_label = f"Today so far ({now_local.strftime('%a %d %b')}, as of {now_local.strftime('%H:%M')})"
    elif period == "last7":
        target_date = yesterday_date  # window ends at the last complete day
        start, _ = _day_bounds_utc(target_date - timedelta(days=6), tz)
        _, end = _day_bounds_utc(target_date, tz)
        is_partial = False
        period_label = f"Last 7 days ({(target_date - timedelta(days=6)).strftime('%d %b')} - {target_date.strftime('%d %b')})"
    else:  # "yesterday" - the default
        period = "yesterday"
        target_date = yesterday_date
        start, end = _day_bounds_utc(target_date, tz)
        is_partial = False
        period_label = f"Yesterday ({target_date.strftime('%a %d %b')}, complete day)"

    current = _order_stats(db, store, start, end)
    history_start = history_start_date(db, store)
    empty_baseline = {"orders": None, "revenue": None, "aov": None}

    # ---- 2. Baseline window(s) ----------------------------------------------
    # A baseline window that starts before our synced order history has no
    # real data, so it is reported as missing (None), never as 0.
    if period == "last7":
        prior_first_day = target_date - timedelta(days=13)
        prior_start, _ = _day_bounds_utc(prior_first_day, tz)
        _, prior_end = _day_bounds_utc(target_date - timedelta(days=7), tz)
        baseline = (
            _order_stats(db, store, prior_start, prior_end)
            if _has_history(history_start, prior_first_day) else empty_baseline
        )
        baseline_label = "vs prior 7 days"
    elif period == "today" and is_partial:
        # Compare today-so-far against the SAME elapsed window, same weekday last week.
        last_week_same_day = target_date - timedelta(days=7)
        lw_start, _ = _day_bounds_utc(last_week_same_day, tz)
        baseline = (
            _order_stats(db, store, lw_start, lw_start + elapsed)
            if _has_history(history_start, last_week_same_day) else empty_baseline
        )
        baseline_label = f"vs same time {WEEKDAY_NAMES[last_week_same_day.weekday()]} last week"
    elif compare == "last_week":
        last_week_same_day = target_date - timedelta(days=7)
        lw_start, lw_end = _day_bounds_utc(last_week_same_day, tz)
        baseline = (
            _order_stats(db, store, lw_start, lw_end)
            if _has_history(history_start, last_week_same_day) else empty_baseline
        )
        baseline_label = f"vs same {WEEKDAY_NAMES[last_week_same_day.weekday()]} last week"
    else:
        # 4-week same-weekday average (default) - more stable at ~70 orders/day.
        # Only weeks we actually have order history for are averaged.
        compare = "4week_avg"
        weekday_dates = [
            d for d in _same_weekday_dates_back(target_date, 4) if _has_history(history_start, d)
        ]
        stats_list = []
        for d in weekday_dates:
            s, e = _day_bounds_utc(d, tz)
            stats_list.append(_order_stats(db, store, s, e))
        if stats_list:
            baseline = {
                "orders": round(sum(s["orders"] for s in stats_list) / len(stats_list), 1),
                "revenue": round(sum(s["revenue"] for s in stats_list) / len(stats_list), 2),
                "aov": round(sum(s["aov"] for s in stats_list) / len(stats_list), 2),
            }
        else:
            baseline = empty_baseline
        weeks = len(stats_list)
        baseline_label = (
            f"vs 4-week {WEEKDAY_NAMES[target_date.weekday()]} average"
            if weeks in (0, 4)
            else f"vs {weeks}-week {WEEKDAY_NAMES[target_date.weekday()]} average"
        )

    too_early_orders = current["orders"] < MIN_ORDERS_FOR_COMPARISON

    metrics = {
        "orders": _metric_block(current["orders"], baseline["orders"], too_early_orders, baseline_label, 0),
        "revenue": _metric_block(current["revenue"], baseline["revenue"], too_early_orders, baseline_label),
        "aov": _metric_block(current["aov"], baseline["aov"], too_early_orders, baseline_label),
    }

    # ---- 3. CVR / sessions (ShopifyQL) - its own too-early threshold --------
    cvr_value = None
    cvr_sessions = None
    cvr_baseline = None
    cvr_too_early = True
    cvr_error = None
    try:
        daily = fetch_daily_cvr(db, store, days=35)
        by_date = {r["date"]: r for r in daily}
        target_row = by_date.get(target_date.isoformat())
        if target_row:
            cvr_value = target_row["cvr"]
            cvr_sessions = target_row["sessions"]
        if period == "last7":
            window_dates = [(target_date - timedelta(days=i)).isoformat() for i in range(7)]
            prior_dates = [(target_date - timedelta(days=i)).isoformat() for i in range(7, 14)]
            window_rows = [by_date[d] for d in window_dates if d in by_date]
            prior_rows = [by_date[d] for d in prior_dates if d in by_date]
            cvr_sessions = sum(r["sessions"] for r in window_rows) or None
            total_orders_7d = current["orders"]
            cvr_value = round(total_orders_7d / cvr_sessions * 100, 2) if cvr_sessions else None
            prior_sessions = sum(r["sessions"] for r in prior_rows) or None
            # baseline["orders"] is already the prior 7-day TOTAL (the window
            # spans 7 days), so no extra *7 here.
            cvr_baseline = (
                round(baseline["orders"] / prior_sessions * 100, 2)
                if prior_sessions and baseline["orders"] is not None else None
            )
        else:
            # CVR comes straight from Shopify Analytics (not our order DB), so it
            # has full history. Follow the same comparison the picker asks for.
            if period == "today" or compare == "last_week":
                weekday_dates = [(target_date - timedelta(days=7)).isoformat()]
            else:
                weekday_dates = [d.isoformat() for d in _same_weekday_dates_back(target_date, 4)]
            comparable = [by_date[d]["cvr"] for d in weekday_dates if by_date.get(d) and by_date[d]["cvr"] is not None]
            cvr_baseline = round(sum(comparable) / len(comparable), 2) if comparable else None
        cvr_too_early = (cvr_sessions or 0) < MIN_SESSIONS_FOR_COMPARISON
    except Exception as exc:  # Shopify analytics down shouldn't break the page
        cvr_error = str(exc)[:300]

    metrics["conversion_rate"] = _metric_block(
        cvr_value, cvr_baseline, cvr_too_early, baseline_label
    )
    metrics["conversion_rate"]["sessions"] = cvr_sessions
    metrics["conversion_rate"]["base_label"] = (
        f"{current['orders']} of ~{cvr_sessions:,} sessions" if cvr_sessions else "sessions pending"
    )

    # ---- 4. Health strip ------------------------------------------------------
    last_order = (
        db.query(func.max(models.Order.created_at))
        .filter(models.Order.store_id == store.id, models.Order.shopify_order_id.isnot(None))
        .scalar()
    )
    health = {
        "last_order_at": last_order.isoformat() if last_order else None,
        # Mobile page speed / Core Web Vitals needs a new data source (not yet
        # wired up - see the manager's "Site health" section). Reported as
        # unavailable rather than faked.
        "mobile_page_speed": None,
        "mobile_page_speed_status": "not_available",
    }

    return {
        "period": period,
        "period_label": period_label,
        "compare": compare,
        "history_start": history_start.isoformat() if history_start else None,
        "is_partial": is_partial,
        "timezone": store.timezone or "UTC",
        "as_of": now_local.isoformat(),
        "metrics": metrics,
        "health": health,
        "cvr_error": cvr_error,
        "warnings": warnings,
    }
