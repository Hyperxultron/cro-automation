"""
Microsoft Clarity -> product page views (manager checklist, section 4).

Shopify Analytics has no per-product page views, so we take them from
Clarity's Data Export API:
    GET https://www.clarity.ms/export-data/api/v1/project-live-insights
        ?numOfDays=1&dimension1=URL
    Authorization: Bearer <CLARITY_API_TOKEN>

Clarity limits: only the last 1-3 days, 10 calls per project per day, 1,000
rows per call. So once a day we save a snapshot (one row per product handle)
in `clarity_product_days`, and the Product page adds those rows up.

Views = human sessions that opened the product page (Clarity's
totalSessionCount minus totalBotSessionCount), so bots are removed like on
the Shopify-matched sessions numbers.

.env / Render settings:
  CLARITY_API_TOKEN=<token from Clarity: Settings -> Data Export>
"""

import logging
import os
import re
import time
from datetime import date, datetime, timedelta, timezone
from urllib.parse import unquote, urlparse

import httpx
from sqlalchemy import func
from sqlalchemy.orm import Session

import models

logger = logging.getLogger("clarity")

API_URL = "https://www.clarity.ms/export-data/api/v1/project-live-insights"
# One saved snapshot per UTC day. Retry a failed call at most every 3 hours so
# we never burn through Clarity's 10-calls-a-day limit.
RETRY_AFTER_SECONDS = 3 * 60 * 60
_last_attempt_at: float = 0.0
last_status: dict = {"status": "not_run_yet"}

_PRODUCT_PATH = re.compile(r"/products/([^/?#]+)")


def token() -> str | None:
    return (os.getenv("CLARITY_API_TOKEN") or "").strip() or None


def product_handle(url: str) -> str | None:
    """'https://shop.com/collections/x/products/blue-quilt?variant=1' -> 'blue-quilt'."""
    if not url:
        return None
    path = urlparse(url).path if "://" in url else url
    m = _PRODUCT_PATH.search(path)
    return unquote(m.group(1)).lower() if m else None


def _int(v) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def parse_product_traffic(payload) -> dict[str, dict]:
    """{handle: {"sessions": human sessions, "bot_sessions": n}} from the API JSON."""
    out: dict[str, dict] = {}
    for block in payload or []:
        if str(block.get("metricName", "")).lower() != "traffic":
            continue
        for row in block.get("information") or []:
            url = row.get("URL") or row.get("Url") or row.get("url") or ""
            handle = product_handle(str(url))
            if not handle:
                continue
            total = _int(row.get("totalSessionCount"))
            bots = _int(row.get("totalBotSessionCount"))
            agg = out.setdefault(handle, {"sessions": 0, "bot_sessions": 0})
            agg["sessions"] += max(total - bots, 0)
            agg["bot_sessions"] += bots
    return out


def snapshot_day(now_utc: datetime) -> date:
    # numOfDays=1 = the last 24 hours, so a call made early in a UTC day
    # covers (roughly) the previous UTC day.
    return (now_utc - timedelta(days=1)).date()


def sync_clarity(db: Session, store: models.Store, force: bool = False) -> dict:
    """Save yesterday's (UTC) product-page views once a day. Safe to call every 15 min."""
    global _last_attempt_at, last_status
    tok = token()
    if not tok:
        last_status = {"status": "skipped", "reason": "CLARITY_API_TOKEN not set"}
        return last_status

    now = datetime.now(timezone.utc)
    day = snapshot_day(now)
    have = (
        db.query(func.count(models.ClarityProductDay.id))
        .filter(models.ClarityProductDay.store_id == store.id, models.ClarityProductDay.day == day)
        .scalar()
    )
    if have and not force:
        last_status = {"status": "up_to_date", "day": day.isoformat()}
        return last_status
    if not force and time.time() - _last_attempt_at < RETRY_AFTER_SECONDS:
        return last_status
    _last_attempt_at = time.time()

    try:
        resp = httpx.get(
            API_URL,
            params={"numOfDays": 1, "dimension1": "URL"},
            headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
            timeout=60,
        )
    except httpx.HTTPError as exc:
        last_status = {"status": "error", "detail": f"network: {str(exc)[:200]}"}
        logger.warning("Clarity call failed: %s", last_status)
        return last_status

    if resp.status_code != 200:
        reason = {401: "token invalid or expired", 403: "token not allowed", 429: "daily limit reached"}.get(
            resp.status_code, resp.text[:200]
        )
        last_status = {"status": "error", "http": resp.status_code, "detail": reason}
        logger.warning("Clarity call failed: %s", last_status)
        return last_status

    traffic = parse_product_traffic(resp.json())
    db.query(models.ClarityProductDay).filter(
        models.ClarityProductDay.store_id == store.id, models.ClarityProductDay.day == day
    ).delete()
    for handle, v in traffic.items():
        db.add(models.ClarityProductDay(
            store_id=store.id, day=day, handle=handle[:255],
            sessions=v["sessions"], bot_sessions=v["bot_sessions"],
        ))
    db.commit()
    last_status = {"status": "success", "day": day.isoformat(), "products": len(traffic)}
    logger.info("Clarity snapshot saved: %s", last_status)
    return last_status


def product_views(db: Session, store: models.Store, first_day: date, last_day: date) -> dict | None:
    """
    {"by_product": {shopify_product_id: views}, "days": [dates with data]}
    for saved Clarity snapshots between first_day and last_day, or None when
    Clarity isn't connected / nothing saved yet.
    """
    rows = (
        db.query(models.ClarityProductDay.day, models.ClarityProductDay.handle, models.ClarityProductDay.sessions)
        .filter(
            models.ClarityProductDay.store_id == store.id,
            models.ClarityProductDay.day >= first_day,
            models.ClarityProductDay.day <= last_day,
        )
        .all()
    )
    if not rows:
        return None
    handles = {
        (p.handle or "").lower(): p.shopify_product_id
        for p in db.query(models.Product).filter(models.Product.store_id == store.id, models.Product.handle.isnot(None))
    }
    by_product: dict[str, int] = {}
    days = set()
    for day, handle, sessions in rows:
        days.add(day)
        spid = handles.get(handle)
        if spid:
            by_product[spid] = by_product.get(spid, 0) + int(sessions or 0)
    return {"by_product": by_product, "days": sorted(days)}
