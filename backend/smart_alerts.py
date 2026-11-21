"""
Manager checklist "Later: alerts" - baaki alerts (sab read-only, Shopify pe kuch nahi likhta).

Har rule:
  - evaluate(db, store, threshold) -> {"status", "detail", "message", "marker", ...}
      status: "breach" (alert banta hai), "normal", "insufficient_data", "outside_hours", "error"
  - breach par ek hi baar alert + email (marker se duplicate nahi banta)
  - har alert batata hai: kya hila, kitna, kis baseline ke against, aur kaunsa page kholna hai

Rules:
  1. No Orders for 2 Hours (US Daytime)      - DB orders, 9 AM-9 PM store time
  2. Add-to-Cart Rate Drop                    - ShopifyQL funnel, kal vs 4-week same weekday
  3. Checkout Completion Drop                 - ShopifyQL funnel, kal vs 4-week same weekday
  4. Traffic Up but Conversion Down           - ShopifyQL sessions/CVR, kal vs 4-week same weekday
  5. Mobile Page Speed Got Worse              - ShopifyQL web_performance, latest day vs pichhle 7 din
  6. Best-Seller Out of Stock                 - DB best-sellers + Shopify products (availableForSale)
"""

import hashlib
import logging
import time
from datetime import datetime, time as dtime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from cvr import MIN_ALARM_SESSIONS, cvr_vs_weekday_average, fetch_daily_cvr, store_today
from emailer import send_alert_email
from funnel import fetch_funnel_trend
from shopify_client import graphql

logger = logging.getLogger("smart_alerts")

DASHBOARD_URL = "https://cro-automation-1.onrender.com/"
DAY_START, DAY_END = dtime(9, 0), dtime(21, 0)  # "US daytime" in store time
MIN_EXPECTED_ORDERS = 3  # 2h gap tabhi ajeeb jab normally us waqt 3+ orders aate hain

_cache: dict = {}


def _cached(key, seconds: int, fn):
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    value = fn()
    _cache[key] = (time.time() + seconds, value)
    return value


def _tz(store: models.Store) -> ZoneInfo:
    return ZoneInfo(store.timezone or "America/New_York")


def _utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _fmt_time(dt: datetime) -> str:
    return dt.strftime("%a %d %b, %I:%M %p").replace(" 0", " ")


def _weekday_rate(rows: list[dict], store: models.Store, num_key: str, den_key: str, min_den: int) -> dict:
    """Kal ka rate (num/den %) vs pichhle 4 same weekdays ka average."""
    by_date = {r["date"]: r for r in rows}
    y = store_today(store) - timedelta(days=1)

    def rate(d):
        r = by_date.get(d.isoformat())
        if not r or (r.get(den_key) or 0) < min_den:
            return None, (r or {}).get(den_key) or 0
        return r[num_key] / r[den_key] * 100, r[den_key]

    y_rate, y_den = rate(y)
    base = [v for v in (rate(y - timedelta(days=7 * w))[0] for w in range(1, 5)) if v is not None]
    out = {
        "date": y.isoformat(),
        "weekday": y.strftime("%A"),
        "value": round(y_rate, 2) if y_rate is not None else None,
        "base_count": y_den,
        "baseline": round(sum(base) / len(base), 2) if base else None,
        "drop_percent": None,
    }
    if y_rate is not None and len(base) >= 3 and out["baseline"]:
        out["drop_percent"] = round((out["baseline"] - y_rate) / out["baseline"] * 100, 1)
    return out


# ---------------------------------------------------------------------------
# 1. No orders for 2 hours during US daytime
# ---------------------------------------------------------------------------

def eval_no_orders(db: Session, store: models.Store, threshold: float, now: datetime | None = None) -> dict:
    tz = _tz(store)
    now = now.astimezone(tz) if now else datetime.now(tz)
    window_start = now.replace(hour=DAY_START.hour, minute=0, second=0, microsecond=0)
    if not (DAY_START <= now.time() < DAY_END):
        return {"status": "outside_hours", "detail": "Checks only between 9 AM and 9 PM store time (New York)."}

    live = db.query(models.Order).filter(models.Order.store_id == store.id, models.Order.cancelled_at.is_(None))
    last = live.order_by(models.Order.created_at.desc()).first()
    last_local = _utc(last.created_at).astimezone(tz) if last else None
    gap_from = max(last_local, window_start) if last_local else window_start
    gap_hours = (now - gap_from).total_seconds() / 3600

    # How many orders normally land in this same stretch of the day (last 28 days)?
    since = datetime.combine(now.date() - timedelta(days=28), dtime(0), tz)
    until = datetime.combine(now.date(), dtime(0), tz)
    times = [
        _utc(t).astimezone(tz).time()
        for (t,) in live.with_entities(models.Order.created_at).filter(
            models.Order.created_at >= since.astimezone(timezone.utc),
            models.Order.created_at < until.astimezone(timezone.utc),
        )
    ]
    lo, hi = gap_from.time(), now.time()
    expected = round(sum(1 for t in times if lo <= t < hi) / 28, 1)

    since_txt = f"the last order ({last.order_number}, {_fmt_time(last_local)})" if last_local and last_local >= window_start else "9 AM today"
    detail = (
        f"{gap_hours:.1f}h since {since_txt}. Normally about {expected:g} orders come in between "
        f"{lo.strftime('%I:%M %p').lstrip('0')} and {hi.strftime('%I:%M %p').lstrip('0')} (28-day average)."
    )
    out = {"status": "normal", "detail": detail, "gap_hours": round(gap_hours, 2), "expected_orders": expected}
    if gap_hours >= threshold and expected >= MIN_EXPECTED_ORDERS:
        out.update(
            status="breach",
            marker=f"[no-orders:{gap_from.isoformat(timespec='minutes')}]",
            subject="No orders for 2+ hours",
            message=f"No orders in '{store.store_name}' for {detail}",
        )
    elif gap_hours >= threshold:
        out["detail"] = detail + " That is a normally quiet time, so no alert."
    return out


# ---------------------------------------------------------------------------
# 2 + 3. Add-to-cart rate drop, checkout completion drop
# ---------------------------------------------------------------------------

def _funnel_rows(store: models.Store) -> list[dict]:
    return fetch_funnel_trend(store, days=29)


def _funnel_rule(store: models.Store, threshold: float, num_key: str, den_key: str, min_den: int,
                 name: str, den_label: str, key: str, subject: str) -> dict:
    r = _weekday_rate(_funnel_rows(store), store, num_key, den_key, min_den)
    if r["value"] is None:
        return {"status": "insufficient_data", "detail": f"Yesterday ({r['weekday']}) had only {r['base_count']} {den_label}, too few to judge."}
    if r["drop_percent"] is None:
        return {"status": "insufficient_data", "detail": f"Not enough past {r['weekday']}s with data yet."}
    pts = round(r["value"] - r["baseline"], 2)
    detail = (
        f"Yesterday ({r['weekday']}) {r['value']}% vs {r['weekday']} 4-week avg {r['baseline']}%: "
        f"{pts:+g} pts ({-r['drop_percent']:+g}%)."
    )
    out = {"status": "normal", "detail": detail, **r}
    if r["drop_percent"] >= threshold:
        out.update(
            status="breach",
            marker=f"[{key}:{r['date']}]",
            subject=subject,
            message=f"{name} in '{store.store_name}' fell. {detail} Based on {r['base_count']:,} {den_label}.",
        )
    return out


def eval_atc(db: Session, store: models.Store, threshold: float) -> dict:
    return _funnel_rule(store, threshold, "added_to_cart", "sessions", 100,
                        "Add-to-cart rate", "sessions", "atc", "Add-to-cart rate dropped")


def eval_checkout(db: Session, store: models.Store, threshold: float) -> dict:
    return _funnel_rule(store, threshold, "completed_checkout", "reached_checkout", 20,
                        "Checkout completion (checkouts that ended in an order)", "checkouts",
                        "checkout", "Checkout completion dropped")


# ---------------------------------------------------------------------------
# 4. Traffic up but conversion down
# ---------------------------------------------------------------------------

CVR_FALL_FOR_TRAFFIC_RULE = 15.0


def eval_traffic_cvr(db: Session, store: models.Store, threshold: float) -> dict:
    c = cvr_vs_weekday_average(fetch_daily_cvr(db, store, days=35), store)
    if c["drop_percent"] is None:
        return {"status": "insufficient_data", "detail": "Not enough sessions yet to compare yesterday with its weekday average."}
    base_sessions = [b["sessions"] for b in c["baseline_days"] if b.get("sessions")]
    avg_sessions = sum(base_sessions) / len(base_sessions) if base_sessions else 0
    if not avg_sessions:
        return {"status": "insufficient_data", "detail": "No past sessions to compare with."}
    traffic_up = round((c["yesterday_sessions"] - avg_sessions) / avg_sessions * 100, 1)
    day = c["yesterday_weekday"]
    detail = (
        f"Yesterday ({day}) sessions {c['yesterday_sessions']:,} vs {day} avg {round(avg_sessions):,} ({traffic_up:+g}%); "
        f"conversion {c['yesterday_cvr']}% vs {c['baseline_cvr']}% ({-c['drop_percent']:+g}%)."
    )
    out = {"status": "normal", "detail": detail, "traffic_up_percent": traffic_up, "cvr_drop_percent": c["drop_percent"]}
    if traffic_up >= threshold and c["drop_percent"] >= CVR_FALL_FOR_TRAFFIC_RULE:
        out.update(
            status="breach",
            marker=f"[traffic-cvr:{c['yesterday_date']}]",
            subject="More visitors but fewer buying",
            message=(
                f"Traffic went up but conversion went down in '{store.store_name}'. {detail} "
                "New visitors may be the wrong audience, or something on the site is blocking them."
            ),
        )
    return out


# ---------------------------------------------------------------------------
# 5. Mobile page speed much worse
# ---------------------------------------------------------------------------

LCP_GOOD_MS = 2500
MIN_PAGE_LOADS = 100


def _mobile_lcp_days(store: models.Store) -> list[dict]:
    from landing import _run  # same ShopifyQL runner as Site Health

    def load():
        rows = _run(store, "FROM web_performance SHOW page_loads, lcp_p75_ms WHERE device_type = 'Mobile' "
                           "TIMESERIES day SINCE -12d UNTIL today ORDER BY day ASC")
        out = []
        for r in rows:
            try:
                loads = int(float(r.get("page_loads") or 0))
                lcp = float(r["lcp_p75_ms"]) if r.get("lcp_p75_ms") not in (None, "") else None
            except (TypeError, ValueError):
                continue
            if lcp is not None and loads >= MIN_PAGE_LOADS:
                out.append({"date": str(r.get("day", ""))[:10], "loads": loads, "lcp": lcp})
        return out

    return _cached(("lcp", store.store_url), 3600, load)


def eval_mobile_speed(db: Session, store: models.Store, threshold: float) -> dict:
    days = _mobile_lcp_days(store)
    if len(days) < 4:
        return {"status": "insufficient_data", "detail": "Shopify has not published enough mobile page speed days yet."}
    cur, prev = days[-1], days[-8:-1]
    avg = sum(d["lcp"] for d in prev) / len(prev)
    worse = round((cur["lcp"] - avg) / avg * 100, 1)
    label = datetime.fromisoformat(cur["date"]).strftime("%a %d %b")
    detail = (
        f"Mobile load time (LCP) on {label}, the latest day Shopify has published: {cur['lcp'] / 1000:.2f}s vs "
        f"{avg / 1000:.2f}s average of the {len(prev)} days before ({worse:+g}%). Google's 'good' limit is 2.5s."
    )
    out = {"status": "normal", "detail": detail, "worse_percent": worse}
    if worse >= threshold and cur["lcp"] > LCP_GOOD_MS:
        out.update(
            status="breach",
            marker=f"[mobile-speed:{cur['date']}]",
            subject="Mobile pages got much slower",
            message=f"Mobile pages in '{store.store_name}' got much slower. {detail}",
        )
    return out


# ---------------------------------------------------------------------------
# 6. Best-seller (or its popular variant) out of stock
# ---------------------------------------------------------------------------

TOP_PRODUCTS = 10

PRODUCTS_STOCK_QUERY = """
query Stock($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product {
      id
      title
      status
      variants(first: 100) { nodes { title availableForSale } }
    }
  }
}
"""


def _best_sellers(db: Session, store: models.Store) -> list[tuple[str, str, float]]:
    since = datetime.now(timezone.utc) - timedelta(days=28)
    revenue = func.sum(models.OrderItem.quantity * models.OrderItem.unit_price)
    rows = (
        db.query(models.Product.shopify_product_id, models.Product.product_name, revenue)
        .join(models.OrderItem, models.OrderItem.product_id == models.Product.id)
        .join(models.Order, models.Order.id == models.OrderItem.order_id)
        .filter(
            models.Order.store_id == store.id,
            models.Order.cancelled_at.is_(None),
            models.Order.created_at >= since,
            models.Product.shopify_product_id.isnot(None),
        )
        .group_by(models.Product.shopify_product_id, models.Product.product_name)
        .order_by(revenue.desc())
        .limit(TOP_PRODUCTS)
        .all()
    )
    return [(pid, name, float(rev or 0)) for pid, name, rev in rows]


def _popular_variants(store: models.Store) -> list[tuple[str, str]]:
    """Top variants by items sold (28 days) from Shopify Analytics. Empty if not available."""
    from landing import _run

    def load():
        try:
            rows = _run(store, "FROM sales SHOW net_items_sold GROUP BY product_title, product_variant_title "
                               "SINCE -28d UNTIL -1d ORDER BY net_items_sold DESC LIMIT 15")
        except Exception as exc:
            logger.warning("Variant sales query failed: %s", exc)
            return []
        return [(str(r.get("product_title") or ""), str(r.get("product_variant_title") or "")) for r in rows]

    return _cached(("variants", store.store_url), 3600, load)


def eval_out_of_stock(db: Session, store: models.Store, threshold: float) -> dict:
    sellers = _best_sellers(db, store)
    if not sellers:
        return {"status": "insufficient_data", "detail": "No sales in the last 28 days to pick best-sellers from."}
    gid = lambda pid: pid if str(pid).startswith("gid://") else f"gid://shopify/Product/{pid}"
    nodes = _cached(
        ("stock", store.store_url, tuple(p for p, _, _ in sellers)), 600,
        lambda: graphql(store.store_url, PRODUCTS_STOCK_QUERY, {"ids": [gid(p) for p, _, _ in sellers]})["nodes"],
    )
    popular = set(_popular_variants(store))

    sold_out, variant_out = [], []
    for n in nodes or []:
        if not n or n.get("status") not in (None, "ACTIVE"):
            continue
        variants = (n.get("variants") or {}).get("nodes") or []
        if variants and not any(v.get("availableForSale") for v in variants):
            sold_out.append(n["title"])
            continue
        for v in variants:
            if not v.get("availableForSale") and (n["title"], v.get("title") or "") in popular:
                variant_out.append(f"{n['title']} ({v['title']})")

    if not sold_out and not variant_out:
        return {"status": "normal", "detail": f"All top {len(sellers)} best-sellers (last 28 days) and their popular variants are in stock."}
    parts = []
    if sold_out:
        parts.append("Sold out: " + ", ".join(sold_out) + ".")
    if variant_out:
        parts.append("Popular variant sold out: " + ", ".join(variant_out) + ".")
    detail = " ".join(parts)
    key = "|".join(sorted(sold_out + variant_out))
    return {
        "status": "breach",
        "detail": detail,
        "marker": f"[oos:{store_today(store).isoformat()}:{hashlib.md5(key.encode()).hexdigest()[:8]}]",
        "subject": "Best-seller out of stock",
        "message": (
            f"Best-sellers out of stock in '{store.store_name}' (top {len(sellers)} by sales, last 28 days). {detail} "
            "Every visitor who lands on these pages now can't buy."
        ),
    }


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

RULES = [
    {
        "title": "No Orders for 2 Hours (US Daytime)",
        "description": "Alerts when no order has come in for 2 hours between 9 AM and 9 PM New York time, "
                       "but only at times of day that normally bring 3 or more orders in that stretch.",
        "threshold": 2.0, "limit": "Limit: {t:g}h without an order", "page": "Overview", "fn": eval_no_orders,
    },
    {
        "title": "Add-to-Cart Rate Drop",
        "description": "Alerts when yesterday's add-to-cart rate is 20% or more below the same weekday's "
                       "average over the last 4 weeks. Skipped on days under 100 sessions.",
        "threshold": 20.0, "limit": "Limit: {t:g}% below average", "page": "Cart & Checkout", "fn": eval_atc,
    },
    {
        "title": "Checkout Completion Drop",
        "description": "Alerts when the share of checkouts that end in an order yesterday is 20% or more below "
                       "the same weekday's 4-week average. Skipped on days under 20 checkouts.",
        "threshold": 20.0, "limit": "Limit: {t:g}% below average", "page": "Cart & Checkout", "fn": eval_checkout,
    },
    {
        "title": "Traffic Up but Conversion Down",
        "description": "Alerts when yesterday's sessions were 20% or more above the same weekday's 4-week average "
                       "while conversion was 15% or more below it.",
        "threshold": 20.0, "limit": "Limit: traffic {t:g}% up and conversion 15% down", "page": "Conversion Analytics",
        "fn": eval_traffic_cvr,
    },
    {
        "title": "Mobile Page Speed Got Worse",
        "description": "Alerts when mobile load time (LCP) on the latest day Shopify has published is 30% or more "
                       "slower than the 7 days before and above Google's 2.5s 'good' limit.",
        "threshold": 30.0, "limit": "Limit: {t:g}% slower", "page": "Site Health", "fn": eval_mobile_speed,
    },
    {
        "title": "Best-Seller Out of Stock",
        "description": "Alerts when one of the top 10 products by sales (last 28 days), or one of its most-sold "
                       "variants, can no longer be bought.",
        "threshold": None, "limit": "Watches the top 10 products", "page": "Product Analytics", "fn": eval_out_of_stock,
    },
]
RULES_BY_TITLE = {r["title"]: r for r in RULES}


def ensure_rules(db: Session) -> dict[str, models.AlarmRule]:
    existing = {r.title: r for r in db.query(models.AlarmRule).filter(models.AlarmRule.title.in_(list(RULES_BY_TITLE))).all()}
    changed = False
    for spec in RULES:
        rule = existing.get(spec["title"])
        if not rule:
            rule = models.AlarmRule(title=spec["title"], description=spec["description"],
                                    threshold=spec["threshold"], is_active=True)
            db.add(rule)
            existing[spec["title"]] = rule
            changed = True
        elif rule.description != spec["description"]:
            rule.description = spec["description"]
            changed = True
    if changed:
        db.commit()
    return existing


def limit_text(rule: models.AlarmRule) -> str | None:
    spec = RULES_BY_TITLE.get(rule.title)
    if not spec:
        return None
    t = rule.threshold if rule.threshold is not None else spec["threshold"]
    return spec["limit"].format(t=t or 0)


def evaluate(db: Session, store: models.Store, rule: models.AlarmRule) -> dict:
    spec = RULES_BY_TITLE[rule.title]
    threshold = float(rule.threshold if rule.threshold is not None else (spec["threshold"] or 0))
    try:
        res = spec["fn"](db, store, threshold)
    except Exception as exc:
        db.rollback()
        logger.exception("Alert check failed: %s", rule.title)
        return {"status": "error", "detail": f"Check failed: {str(exc)[:160]}"}
    if res.get("status") == "breach":
        seen = (
            db.query(models.AlertHistory.id)
            .filter(
                models.AlertHistory.alarm_rule_id == rule.id,
                models.AlertHistory.store_id == store.id,
                models.AlertHistory.message.like(f"{res['marker']}%"),
            )
            .first()
        )
        res["alert_id"] = seen[0] if seen else None
    return res


def _record(db: Session, store: models.Store, rule: models.AlarmRule, res: dict) -> dict:
    spec = RULES_BY_TITLE[rule.title]
    message = f"{res['marker']} {res['message']}\nOpen: Ridhi Pulse > {spec['page']} ({DASHBOARD_URL})"
    alert = models.AlertHistory(alarm_rule_id=rule.id, store_id=store.id, message=message, status="pending")
    db.add(alert)
    db.commit()
    db.refresh(alert)
    try:
        if store.email_alerts_enabled is False:
            alert.status = "email_disabled"
        else:
            override = store.notification_email if store.email_alerts_enabled and store.notification_email else None
            alert.status = "sent" if send_alert_email(res["subject"], message, override_to=override) else "email_failed"
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Alert email failed: %s", rule.title)
    return {**res, "status": "alarm_triggered", "alert_id": alert.id}


def run_smart_alerts(db: Session, store: models.Store) -> dict:
    """Scheduler / sync: har active rule check karo, naya breach ho toh alert + email."""
    out = {}
    for title, rule in ensure_rules(db).items():
        rule.last_checked_at = datetime.now(timezone.utc)
        db.commit()
        if not rule.is_active:
            out[title] = "rule_inactive"
            continue
        res = evaluate(db, store, rule)
        if res.get("status") == "breach" and not res.get("alert_id"):
            res = _record(db, store, rule, res)
        out[title] = live_status(res)
    return out


def live_status(res: dict) -> str:
    """Alarm Rules page ke liye status (breach -> alerting)."""
    s = res.get("status")
    if s == "breach":
        return "alarm_active"
    return s or "error"
