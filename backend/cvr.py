"""
Conversion Rate (CVR) - Shopify Analytics (ShopifyQL) se real data.

- Shopify ka apna `conversion_rate` metric (sessions schema) use hota hai.
- Din store ke timezone ke hisaab se hote hain (Shopify khud handle karta hai).
- Result 10 minute ke liye memory mein cache hota hai (Shopify par load kam).
"""

import time
from datetime import date, datetime, timedelta
from statistics import median
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from shopify_client import HUMAN_SESSIONS_FILTER, graphql

SHOPIFYQL_QUERY = """
query Cvr($q: String!) {
  shopifyqlQuery(query: $q) {
    tableData { columns { name dataType } rows }
    parseErrors
  }
}
"""

CACHE_SECONDS = 600
_cache: dict[tuple[str, int], tuple[float, list[dict]]] = {}


def store_today(store: models.Store) -> date:
    tz = ZoneInfo(store.timezone or "UTC")
    return datetime.now(tz).date()


def _to_float(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _db_orders_per_day(db: Session, store: models.Store, days: list[str]) -> dict[str, int]:
    """Hamare DB ke orders per din (store timezone) - CVR scale check ke liye."""
    tz_name = store.timezone or "UTC"
    local_day = func.date(func.timezone(tz_name, models.Order.created_at))
    rows = (
        db.query(local_day, func.count(models.Order.id))
        .filter(models.Order.store_id == store.id, models.Order.shopify_order_id.isnot(None))
        .group_by(local_day)
        .all()
    )
    counts = {str(d): c for d, c in rows}
    return {d: counts.get(d, 0) for d in days}


def fetch_daily_cvr(db: Session, store: models.Store, days: int = 7) -> list[dict]:
    """
    Pichhle `days` poore din (aaj ko chhod kar) ka CVR.
    Returns: [{"date": "YYYY-MM-DD", "sessions": int|None, "cvr": float|None (percent)}]
    """
    key = (store.store_url, days)
    cached = _cache.get(key)
    if cached and cached[0] > time.time():
        return cached[1]

    q = (
        f"FROM sessions SHOW sessions, conversion_rate "
        f"{HUMAN_SESSIONS_FILTER}"
        f"TIMESERIES day SINCE -{days + 1}d UNTIL today ORDER BY day ASC"
    )
    data = graphql(store.store_url, SHOPIFYQL_QUERY, {"q": q})["shopifyqlQuery"]
    if data.get("parseErrors"):
        raise ValueError(f"ShopifyQL error: {data['parseErrors']}")

    rows = (data.get("tableData") or {}).get("rows") or []
    today = store_today(store).isoformat()

    result = []
    for row in rows:
        day = str(row.get("day", ""))[:10]
        if not day or day >= today:
            continue  # aaj ka adhoora din skip
        result.append(
            {
                "date": day,
                "sessions": int(_to_float(row.get("sessions")) or 0),
                "raw_cvr": _to_float(row.get("conversion_rate")),
            }
        )
    result = result[-days:]

    # Scale detect: Shopify ratio (0.025) bhejta hai ya percent (2.5)?
    values = [r["raw_cvr"] for r in result if r["raw_cvr"]]
    as_fraction = False
    if values and max(values) <= 1:
        orders = _db_orders_per_day(db, store, [r["date"] for r in result])
        ratios = [
            orders[r["date"]] / r["sessions"]
            for r in result
            if r["sessions"] and orders.get(r["date"])
        ]
        if ratios:
            v, rt = median(values), median(ratios)
            as_fraction = abs(v - rt) < abs(v - rt * 100)

    for r in result:
        raw = r.pop("raw_cvr")
        r["cvr"] = None if raw is None else round(raw * 100 if as_fraction else raw, 2)

    _cache[key] = (time.time() + CACHE_SECONDS, result)
    return result


def cvr_comparison(daily: list[dict], store: models.Store) -> dict:
    """Kal vs parso ka CVR aur % drop."""
    by_date = {r["date"]: r for r in daily}
    today = store_today(store)
    yesterday = (today - timedelta(days=1)).isoformat()
    previous = (today - timedelta(days=2)).isoformat()

    y = by_date.get(yesterday, {}).get("cvr")
    p = by_date.get(previous, {}).get("cvr")

    drop = None
    if y is not None and p:  # p == 0 ya None -> drop calculate nahi hota
        drop = round((p - y) / p * 100, 2)

    return {
        "yesterday_date": yesterday,
        "yesterday_cvr": y,
        "previous_date": previous,
        "previous_cvr": p,
        "drop_percent": drop,
    }


MIN_ALARM_SESSIONS = 30  # isse kam sessions wale din par CVR bharosemand nahi


def cvr_vs_weekday_average(daily: list[dict], store: models.Store, weeks: int = 4) -> dict:
    """
    Kal ka CVR vs pichhle `weeks` hafton ke ussi weekday ka average CVR.
    (e.g. kal Tuesday tha -> pichhle 4 Tuesdays ka average)
    Drop % = (avg - kal) / avg * 100. Kam data ho toh drop None.
    """
    by_date = {r["date"]: r for r in daily}
    yesterday = store_today(store) - timedelta(days=1)
    y_row = by_date.get(yesterday.isoformat(), {})
    y_cvr, y_sessions = y_row.get("cvr"), y_row.get("sessions") or 0

    baseline = []
    for w in range(1, weeks + 1):
        d = (yesterday - timedelta(days=7 * w)).isoformat()
        row = by_date.get(d)
        if row and row.get("cvr") is not None and (row.get("sessions") or 0) >= MIN_ALARM_SESSIONS:
            baseline.append({"date": d, "cvr": row["cvr"], "sessions": row.get("sessions")})

    avg = round(sum(b["cvr"] for b in baseline) / len(baseline), 2) if baseline else None

    drop = None
    reason = None
    if y_cvr is None or y_sessions < MIN_ALARM_SESSIONS:
        reason = "too_few_sessions_yesterday"
    elif len(baseline) < max(2, weeks - 1) or not avg:
        reason = "not_enough_past_weeks"
    else:
        drop = round((avg - y_cvr) / avg * 100, 2)

    return {
        "yesterday_date": yesterday.isoformat(),
        "yesterday_weekday": yesterday.strftime("%A"),
        "yesterday_cvr": y_cvr,
        "yesterday_sessions": y_sessions,
        "baseline_weeks": weeks,
        "baseline_days": baseline,
        "baseline_cvr": avg,
        "drop_percent": drop,
        "reason": reason,
    }
