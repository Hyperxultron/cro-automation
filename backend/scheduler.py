"""
Background scheduler (simple, no extra package).

Har SYNC_INTERVAL_MINUTES (default 15) minute mein:
  1. Shopify se pichhle 2 din ke orders sync
  2. Quilt alarm check
  3. CVR alarm check

.env settings (optional):
  ENABLE_SCHEDULER=true / false
  SYNC_INTERVAL_MINUTES=15
"""

import logging
import os
import threading

from cvr_alarm import check_cvr_alarm
from database import SessionLocal
from quilt_alarm import check_quilt_alarm
from shopify_sync import sync_store
import models

logger = logging.getLogger("scheduler")
logging.basicConfig(level=logging.INFO)

SHOP = os.getenv("SHOPIFY_SHOP", "guz0he-21.myshopify.com")
INTERVAL_MINUTES = max(5, int(os.getenv("SYNC_INTERVAL_MINUTES", "15")))

_stop_event = threading.Event()
_thread: threading.Thread | None = None
last_run: dict = {"status": "not_run_yet"}


def run_once() -> dict:
    """Ek baar sync + dono alarms. Error aaye toh log karo, scheduler band mat karo."""
    global last_run
    db = SessionLocal()
    try:
        result = sync_store(db, SHOP, days=2)
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

        last_run = {
            "status": "success",
            "orders": result["orders"],
            "quilt_alarm": quilt.get("status"),
            "cvr_alarm": cvr.get("status"),
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
