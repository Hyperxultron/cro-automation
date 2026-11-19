"""
Change log (manager checklist, section 8, P1): "Change log: date, change,
area (theme, app, price, promo, ad), owner" + markers on every trend chart.

This is a manually-kept log, not an auto-detected feed - Shopify doesn't
expose a generic "a theme/price/promo/ad changed" event we can sync, so the
team types in what they changed. The API exists so the frontend can both
record entries and ask "which dates had a change" to draw markers on a chart.
"""

from datetime import date, timedelta

from sqlalchemy.orm import Session

import models

VALID_AREAS = {"theme", "app", "price", "promo", "ad", "other"}


def list_change_log(db: Session, store: models.Store, days: int = 90) -> list[dict]:
    since = date.today() - timedelta(days=days)
    rows = (
        db.query(models.ChangeLogEntry)
        .filter(models.ChangeLogEntry.store_id == store.id, models.ChangeLogEntry.entry_date >= since)
        .order_by(models.ChangeLogEntry.entry_date.desc(), models.ChangeLogEntry.id.desc())
        .all()
    )
    return [_serialize(r) for r in rows]


def create_change_log_entry(
    db: Session, store: models.Store, entry_date: date, change: str, area: str, owner: str | None
) -> dict:
    area = area if area in VALID_AREAS else "other"
    entry = models.ChangeLogEntry(
        store_id=store.id,
        entry_date=entry_date,
        change=change.strip(),
        area=area,
        owner=(owner or "").strip() or None,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _serialize(entry)


def delete_change_log_entry(db: Session, store: models.Store, entry_id: int) -> bool:
    entry = (
        db.query(models.ChangeLogEntry)
        .filter(models.ChangeLogEntry.id == entry_id, models.ChangeLogEntry.store_id == store.id)
        .first()
    )
    if not entry:
        return False
    db.delete(entry)
    db.commit()
    return True


def _serialize(entry: models.ChangeLogEntry) -> dict:
    return {
        "id": entry.id,
        "date": entry.entry_date.isoformat(),
        "change": entry.change,
        "area": entry.area,
        "owner": entry.owner,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
    }
