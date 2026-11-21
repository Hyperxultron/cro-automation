"""
Background scheduler (simple, no extra package).

Har SYNC_INTERVAL_MINUTES (default 15) minute mein:
  1. Shopify se pichhle 2 din ke orders sync
     (startup par aur din mein ek baar: pichhle BACKFILL_DAYS (default 60)
     din ka full backfill - warna "4-week same-weekday average" jaise
     comparisons ke liye purana data DB mein hota hi nahi aur baseline 0
     dikhta hai)
  2. Quilt alarm check
  3. CVR alarm check + baaki smart alerts (smart_alerts.py)
  4. Microsoft Clarity product views (din mein ek baar, CLARITY_API_TOKEN ho tab)

.env settings (optional):
  ENABLE_SCHEDULER=true / false
  SYNC_INTERVAL_MINUTES=15
"""

import logging
import os
import threading
import time

from clarity import sync_clarity
from cvr_alarm import check_cvr_alarm
from daily_report import maybe_send_daily_report
from database import SessionLocal
from quilt_alarm import check_quilt_alarm
from shopify_sync import sync_store
from smart_alerts import run_smart_alerts
import models

logger = logging.getLogger("scheduler")
logging.basicConfig(level=logging.INFO)

SHOP = os.getenv("SHOPIFY_SHOP", "guz0he-21.myshopify.com")
INTERVAL_MINUTES = max(5, int(os.getenv("SYNC_INTERVAL_MINUTES", "15")))
# Shopify returns only the last 60 days of orders without the read_all_orders
# scope, so 60 is the most we can backfill by default.
BACKFILL_DAYS = max(2, min(60, int(os.getenv("BACKFILL_DAYS", "60"))))
BACKFILL_EVERY_SECONDS = 24 * 60 * 60
_last_backfill_at: float = 0.0

_stop_event = threading.Event()
_thread: threading.Thread | None = None
last_run: dict = {"status": "not_run_yet"}


def run_once() -> dict:
    """Ek baar sync + dono alarms. Error aaye toh log karo, scheduler band mat karo."""
    global last_run, _last_backfill_at
    db = SessionLocal()
    try:
        backfill = time.time() - _last_backfill_at >= BACKFILL_EVERY_SECONDS
        if backfill:
            # Recent orders first (a few seconds), so today's numbers are right
            # straight after a wake-up; the slow 60-day backfill comes after.
            sync_store(db, SHOP, days=2)
        result = sync_store(db, SHOP, days=BACKFILL_DAYS if backfill else 2)
        if backfill and result.get("status") == "success":
            _last_backfill_at = time.time()
        if result.get("status") == "skipped":
            last_run = {"status": "skipped", "reason": result.get("reason")}
            logger.info("Scheduler run skipped: %s", last_run)
            return last_run
        store = db.query(models.Store).filter(models.Store.store_url == SHOP).first()
        quilt = check_quilt_alarm(db, store.id)
        try:
            cvr = check_cvr_alarm(db, store)
        except Exception as exc:
            logger.exception("CVR alarm failed")
            cvr = {"status": "error", "detail": str(exc)[:300]}
        try:
            smart = run_smart_alerts(db, store)
        except Exception as exc:
            db.rollback()
            logger.exception("Smart alerts failed")
            smart = {"status": "error", "detail": str(exc)[:300]}
        try:
            # Product page views - once a day, skipped without CLARITY_API_TOKEN.
            clarity = sync_clarity(db, store)
        except Exception as exc:
            db.rollback()
            logger.exception("Clarity sync failed")
            clarity = {"status": "error", "detail": str(exc)[:300]}

        try:
            # Daily numbers email (once a day at/after DAILY_REPORT_UTC; catches
            # up on wake-up if the backend was asleep at send time).
            report = maybe_send_daily_report(db, store)
        except Exception as exc:
            db.rollback()
            logger.exception("Daily report failed")
            report = {"status": "error", "detail": str(exc)[:300]}

        last_run = {
            "status": "success",
            "daily_report": report.get("status"),
            "sync_days": BACKFILL_DAYS if backfill else 2,
            "orders": result["orders"],
            "quilt_alarm": quilt.get("status"),
            "cvr_alarm": cvr.get("status"),
            "smart_alerts": smart,
            "clarity": clarity.get("status"),
        }
        logger.info("Scheduler run: %s", last_run)
    except Exception as exc:
        db.rollback()
        logger.exception("Scheduler run failed")
        last_run = {"status": "error", "detail": str(exc)[:300]}
    finally:
        db.close()
    return last_run


def _loop():
    while not _stop_event.is_set():
        run_once()
        _stop_event.wait(INTERVAL_MINUTES * 60)


def start_scheduler():
    global _thread
    if os.getenv("ENABLE_SCHEDULER", "true").lower() != "true":
        logger.info("Scheduler disabled (ENABLE_SCHEDULER != true)")
        return
    if _thread and _thread.is_alive():
        return
    _stop_event.clear()
    _thread = threading.Thread(target=_loop, name="cro-scheduler", daemon=True)
    _thread.start()
    logger.info("Scheduler started: every %s minutes for %s", INTERVAL_MINUTES, SHOP)


def stop_scheduler():
    _stop_event.set()
