"""
Experiment log (manager checklist, section 8, P3): "hypothesis, start and end
dates, metric, result, confidence".

The team writes the hypothesis, dates, metric and (optionally) one landing
page. The result is worked out from Shopify, not typed in:

  before = the same number of days just before the start date
  during = start date .. end date (or yesterday, while it's still running)

Rates (conversion, add to cart, bounce) come from ShopifyQL sessions with bots
excluded; AOV from Shopify's sales report ((gross - discounts) / orders).
Confidence for rates = two-proportion z-test on the session counts (how sure
we are the change isn't just day-to-day noise). AOV has no confidence because
Shopify doesn't give per-order values in that report.

A before/after comparison isn't a true A/B test: anything else that changed in
the same dates (ads, season, a sale) also moves the number - the change log
sits next to it on the page for that reason.

Read-only towards Shopify.
"""

import logging
import math
import time
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

import models
from landing import _f, _i, _run, _since, norm_path
from overview import _tz
from shopify_client import HUMAN_SESSIONS_FILTER

logger = logging.getLogger("experiments")

METRICS = {
    "conversion_rate": {"label": "Conversion rate", "unit": "%", "better": "up"},
    "added_to_cart_rate": {"label": "Add-to-cart rate", "unit": "%", "better": "up"},
    "bounce_rate": {"label": "Bounce rate", "unit": "%", "better": "down"},
    "aov": {"label": "Average order value", "unit": "$", "better": "up"},
}
MIN_SESSIONS = 200     # per side, before we call a rate result
WIN_CONFIDENCE = 95.0  # % confidence needed to call it a win / loss

_cache: dict = {}


def _sessions(store: models.Store, first: date, last: date, page: str | None) -> dict:
    """{sessions, conversion_rate, added_to_cart_rate, bounce_rate} (rates as fractions)."""
    H = HUMAN_SESSIONS_FILTER
    metrics = "sessions, conversion_rate, added_to_cart_rate, bounce_rate"
    if page:
        # Group by page and match after normalising, so "/products/x?variant=1"
        # and "/products/x" count as the same page (same as the Landing Pages tab).
        rows = _run(store, f"FROM sessions SHOW {metrics} {H}GROUP BY landing_page_path {_since(first, last)} "
                           "ORDER BY sessions DESC LIMIT 1000")
        want = norm_path(page)
        rows = [r for r in rows if r.get("landing_page_path") is not None and norm_path(r["landing_page_path"]) == want]
    else:
        rows = _run(store, f"FROM sessions SHOW {metrics} {H}{_since(first, last)}")
    s = sum(_i(r.get("sessions")) for r in rows)
    out = {"sessions": s}
    for k in ("conversion_rate", "added_to_cart_rate", "bounce_rate"):
        out[k] = (sum((_f(r.get(k)) or 0.0) * _i(r.get("sessions")) for r in rows) / s) if s else None
    return out


def _aov(store: models.Store, first: date, last: date) -> tuple[float | None, int]:
    from shopify_sales import add, daily_sales

    t = add(list(daily_sales(store, first, last).values()))
    return ((t["gross"] - t["discounts"]) / t["orders"] if t["orders"] else None), int(t["orders"])


def _confidence(p1: float, n1: int, p2: float, n2: int) -> float | None:
    """Two-sided two-proportion z-test -> confidence in % that the rates differ."""
    if n1 <= 0 or n2 <= 0:
        return None
    p = (p1 * n1 + p2 * n2) / (n1 + n2)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
    if se == 0:
        return None
    z = abs(p2 - p1) / se
    pval = 2 * (1 - 0.5 * (1 + math.erf(z / math.sqrt(2))))
    return round((1 - pval) * 100, 1)


def _result(exp: models.Experiment, store: models.Store) -> dict:
    today = datetime.now(_tz(store)).date()
    yesterday = today - timedelta(days=1)
    if exp.start_date > yesterday:
        return {"state": "planned", "verdict": "not_started", "summary": f"Starts {exp.start_date.strftime('%d %b')}"}
    last = min(exp.end_date or yesterday, yesterday)
    n = (last - exp.start_date).days + 1
    b_last = exp.start_date - timedelta(days=1)
    b_first = b_last - timedelta(days=n - 1)
    state = "finished" if exp.end_date and exp.end_date <= yesterday else "running"

    key = (store.store_url, exp.id, exp.metric, exp.page_path, exp.start_date, last)
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]

    meta = METRICS[exp.metric]
    res = {
        "state": state,
        "days_measured": n,
        "before_label": f"{b_first.strftime('%d %b')} - {b_last.strftime('%d %b')}",
        "during_label": f"{exp.start_date.strftime('%d %b')} - {last.strftime('%d %b')}",
    }
    if exp.metric == "aov":
        before, bo = _aov(store, b_first, b_last)
        during, do = _aov(store, exp.start_date, last)
        res.update({
            "before": round(before, 2) if before else None, "during": round(during, 2) if during else None,
            "before_n": bo, "during_n": do, "n_unit": "orders", "confidence": None,
        })
        if before and during:
            ch = (during - before) / before * 100
            res["change"] = round(ch, 1)
            res["change_unit"] = "%"
            res["verdict"] = "early" if state == "running" else ("better" if ch > 0 else "worse" if ch < 0 else "flat")
        else:
            res["verdict"] = "no_data"
    else:
        b = _sessions(store, b_first, b_last, exp.page_path)
        d = _sessions(store, exp.start_date, last, exp.page_path)
        pb, pd = b[exp.metric], d[exp.metric]
        res.update({
            "before": round(pb * 100, 2) if pb is not None else None,
            "during": round(pd * 100, 2) if pd is not None else None,
            "before_n": b["sessions"], "during_n": d["sessions"], "n_unit": "sessions",
        })
        if pb is None or pd is None:
            res.update(verdict="no_data", confidence=None)
        else:
            res["change"] = round((pd - pb) * 100, 2)
            res["change_unit"] = "pts"
            conf = _confidence(pb, b["sessions"], pd, d["sessions"])
            res["confidence"] = conf
            good = (pd > pb) if meta["better"] == "up" else (pd < pb)
            if min(b["sessions"], d["sessions"]) < MIN_SESSIONS:
                res["verdict"] = "too_few"
            elif conf is not None and conf >= WIN_CONFIDENCE:
                res["verdict"] = "win" if good else "loss"
            else:
                res["verdict"] = "running" if state == "running" else "no_clear_result"
    _cache[key] = (time.time() + (300 if state == "running" else 3600), res)
    return res


def _serialize(exp: models.Experiment, store: models.Store, with_result: bool = True) -> dict:
    out = {
        "id": exp.id,
        "name": exp.name,
        "hypothesis": exp.hypothesis,
        "metric": exp.metric,
        "metric_label": METRICS[exp.metric]["label"],
        "better": METRICS[exp.metric]["better"],
        "page_path": exp.page_path,
        "start_date": exp.start_date.isoformat(),
        "end_date": exp.end_date.isoformat() if exp.end_date else None,
        "owner": exp.owner,
        "rec_key": exp.rec_key,
        "created_at": exp.created_at.isoformat() if exp.created_at else None,
    }
    if with_result:
        try:
            out["result"] = _result(exp, store)
        except Exception as exc:
            logger.warning("Experiment %s result failed: %s", exp.id, exc)
            out["result"] = {"state": "error", "verdict": "error", "error": str(exc)[:200]}
    return out


def list_experiments(db: Session, store: models.Store) -> list[dict]:
    rows = (
        db.query(models.Experiment)
        .filter(models.Experiment.store_id == store.id)
        .order_by(models.Experiment.start_date.desc(), models.Experiment.id.desc())
        .all()
    )
    return [_serialize(r, store) for r in rows]


def save_experiment(db: Session, store: models.Store, data: dict, exp_id: int | None = None) -> dict:
    if data.get("metric") not in METRICS:
        raise ValueError(f"metric must be one of {', '.join(METRICS)}")
    if not (data.get("name") or "").strip() or not (data.get("hypothesis") or "").strip():
        raise ValueError("name and hypothesis are required")
    if data.get("end_date") and data["end_date"] < data["start_date"]:
        raise ValueError("end date is before the start date")
    if exp_id is None:
        exp = models.Experiment(store_id=store.id)
        db.add(exp)
    else:
        exp = db.query(models.Experiment).filter(models.Experiment.id == exp_id, models.Experiment.store_id == store.id).first()
        if not exp:
            raise LookupError("experiment not found")
    exp.name = data["name"].strip()[:200]
    exp.hypothesis = data["hypothesis"].strip()
    exp.metric = data["metric"]
    exp.page_path = (data.get("page_path") or "").strip() or None
    exp.start_date = data["start_date"]
    exp.end_date = data.get("end_date")
    exp.owner = (data.get("owner") or "").strip() or None
    exp.rec_key = (data.get("rec_key") or "").strip()[:300] or None
    db.commit()
    db.refresh(exp)
    return _serialize(exp, store)


def delete_experiment(db: Session, store: models.Store, exp_id: int) -> bool:
    exp = db.query(models.Experiment).filter(models.Experiment.id == exp_id, models.Experiment.store_id == store.id).first()
    if not exp:
        return False
    db.delete(exp)
    db.commit()
    return True
