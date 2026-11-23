"""
Landing pages: week-on-week / month-on-month comparison and a deep dive for
each landing page.

Windows (store time zone, complete days only, today is left out):
  This week   = last 7 complete days      vs  Last week   = the 7 days before
  This month  = last 30 complete days     vs  Last month  = the 30 days before

All numbers come from Shopify Analytics (ShopifyQL), human sessions only -
the same source and bot filter as the rest of the Landing Pages page.
Revenue per page = total sales of orders whose visit started on that page
(Shopify's `order_landing_page_path`).

Deep dive for one page adds: a 60-day daily trend, traffic source / device /
country splits for each window, Microsoft Clarity product-page views (when
the page is a product page and Clarity is connected) and plain-language
"what changed" notes.

Read-only. Results are cached for 10 minutes.
"""

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from landing import HUMAN_SESSIONS_FILTER, SESSION_METRICS, _f, _i, _run, _since, norm_path
from overview import _tz

logger = logging.getLogger("landing_compare")

CACHE_SECONDS = 600
_base_cache: dict = {}
_deep_cache: dict = {}

MIN_WEEK = 50     # a page needs this many sessions in BOTH weeks to call a change
MIN_MONTH = 100   # ... and this many in BOTH 30-day windows
MAX_PAGES = 300

WINDOWS = ("week", "prev_week", "month", "prev_month")


# --------------------------------------------------------------------------- helpers

def compare_windows(store: models.Store) -> dict[str, tuple[date, date]]:
    y = datetime.now(_tz(store)).date() - timedelta(days=1)
    return {
        "week": (y - timedelta(days=6), y),
        "prev_week": (y - timedelta(days=13), y - timedelta(days=7)),
        "month": (y - timedelta(days=29), y),
        "prev_month": (y - timedelta(days=59), y - timedelta(days=30)),
    }


def _label(a: date, b: date) -> str:
    return f"{a.strftime('%d %b')} - {b.strftime('%d %b')}"


def _acc() -> dict:
    return {"sessions": 0, "_b": 0.0, "_a": 0.0, "_c": 0.0}


def _add(acc: dict, row: dict) -> None:
    s = _i(row.get("sessions"))
    acc["sessions"] += s
    acc["_b"] += (_f(row.get("bounce_rate")) or 0.0) * s
    acc["_a"] += (_f(row.get("added_to_cart_rate")) or 0.0) * s
    acc["_c"] += (_f(row.get("conversion_rate")) or 0.0) * s


def _rates(acc: dict | None) -> dict:
    """Session-weighted rates in %, like the rest of the page."""
    if not acc or not acc["sessions"]:
        return {"sessions": 0, "bounce_rate": None, "added_to_cart_rate": None, "conversion_rate": None}
    s = acc["sessions"]
    return {
        "sessions": s,
        "bounce_rate": round(acc["_b"] / s * 100, 2),
        "added_to_cart_rate": round(acc["_a"] / s * 100, 2),
        "conversion_rate": round(acc["_c"] / s * 100, 2),
    }


def _with_sales(m: dict, sale: dict | None, sales_ok: bool) -> dict:
    revenue = round(sale["revenue"], 2) if sale else (0.0 if sales_ok else None)
    orders = sale["orders"] if sale else (0 if sales_ok else None)
    s = m["sessions"]
    return {
        **m,
        "orders": orders,
        "revenue": revenue,
        "revenue_per_session": round(revenue / s, 2) if revenue is not None and s else None,
        "aov": round(revenue / orders, 2) if revenue is not None and orders else None,
    }


def _parallel(store: models.Store, queries: dict[str, str]):
    results: dict[str, list[dict] | None] = {}
    errors: dict[str, str] = {}

    def run(item):
        name, q = item
        try:
            return name, _run(store, q), None
        except Exception as exc:  # one failing query mustn't blank the page
            logger.warning("Landing compare query %s failed: %s", name, exc)
            return name, None, str(exc)[:300]

    with ThreadPoolExecutor(max_workers=4) as pool:
        for name, rows, err in pool.map(run, queries.items()):
            results[name] = rows
            if err:
                errors[name] = err
    return results, errors


# --------------------------------------------------------------------------- shared base

def _base(store: models.Store) -> dict:
    """Per-page metrics for the 4 windows + sales, shared by the table and the deep dive."""
    today = datetime.now(_tz(store)).date().isoformat()
    key = (store.store_url, today)
    hit = _base_cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]

    w = compare_windows(store)
    H = HUMAN_SESSIONS_FILTER
    queries = {}
    for name, (a, b) in w.items():
        group = "landing_page_path, landing_page_type" if name in ("week", "month") else "landing_page_path"
        queries[f"s_{name}"] = (
            f"FROM sessions SHOW {SESSION_METRICS} {H}GROUP BY {group} {_since(a, b)} ORDER BY sessions DESC LIMIT 1000"
        )
        queries[f"o_{name}"] = (
            f"FROM sales SHOW total_sales, orders GROUP BY order_landing_page_path {_since(a, b)} ORDER BY total_sales DESC LIMIT 1000"
        )
    results, errors = _parallel(store, queries)
    if results.get("s_month") is None and results.get("s_week") is None:
        raise RuntimeError(errors.get("s_month") or "Shopify landing page query failed")

    page_type: dict[str, str] = {}
    raw_path: dict[str, tuple[str, int]] = {}   # normalised path -> (raw path with most sessions, sessions)
    raw_sales_path: dict[str, tuple[str, float]] = {}  # same for the sales table's order landing page
    sessions: dict[str, dict[str, dict]] = {}
    sales: dict[str, dict[str, dict]] = {}
    sales_ok: dict[str, bool] = {}

    for name in WINDOWS:
        accs: dict[str, dict] = {}
        for r in results.get(f"s_{name}") or []:
            raw = r.get("landing_page_path")
            if raw is None:
                continue  # totals row
            path = norm_path(raw)
            _add(accs.setdefault(path, _acc()), r)
            if r.get("landing_page_type") is not None:
                page_type.setdefault(path, str(r.get("landing_page_type") or "Other").strip() or "Other")
            s = _i(r.get("sessions"))
            if s > raw_path.get(path, ("", -1))[1]:
                raw_path[path] = (str(raw), s)
        sessions[name] = {p: _rates(a) for p, a in accs.items()}

        sales_ok[name] = results.get(f"o_{name}") is not None
        sw: dict[str, dict] = {}
        for r in results.get(f"o_{name}") or []:
            if r.get("order_landing_page_path") is None:
                continue
            np_ = norm_path(r["order_landing_page_path"])
            s = sw.setdefault(np_, {"revenue": 0.0, "orders": 0})
            rev = _f(r.get("total_sales")) or 0.0
            s["revenue"] += rev
            if rev > raw_sales_path.get(np_, ("", -1.0))[1]:
                raw_sales_path[np_] = (str(r["order_landing_page_path"]), rev)
            s["orders"] += _i(r.get("orders"))
        sales[name] = sw

    base = {
        "windows": w,
        "page_type": page_type,
        "raw_path": {p: v[0] for p, v in raw_path.items()},
        "raw_sales_path": {p: v[0] for p, v in raw_sales_path.items()},
        "sessions": sessions,
        "sales": sales,
        "sales_ok": sales_ok,
        "errors": errors,
    }
    _base_cache[key] = (time.time() + CACHE_SECONDS, base)
    return base


def _page_metrics(base: dict, path: str) -> dict[str, dict]:
    empty = _rates(None)
    return {
        name: _with_sales(base["sessions"][name].get(path, empty), base["sales"][name].get(path), base["sales_ok"][name])
        for name in WINDOWS
    }


def _window_meta(w: dict) -> dict:
    return {name: {"first": a.isoformat(), "last": b.isoformat(), "label": _label(a, b)} for name, (a, b) in w.items()}


# --------------------------------------------------------------------------- WoW / MoM table

def fetch_landing_compare(store: models.Store) -> dict:
    """Every landing page with this week vs last week and last 30 days vs the 30 before."""
    base = _base(store)
    paths = set()
    for name in WINDOWS:
        paths.update(base["sessions"][name].keys())
    ranked = sorted(
        paths,
        key=lambda p: -(base["sessions"]["month"].get(p, {}).get("sessions", 0) * 10
                        + base["sessions"]["week"].get(p, {}).get("sessions", 0)),
    )[:MAX_PAGES]

    rows = []
    for p in ranked:
        m = _page_metrics(base, p)
        rows.append({
            "path": p,
            "page_type": base["page_type"].get(p, "Other"),
            **m,
            "week_enough": m["week"]["sessions"] >= MIN_WEEK and m["prev_week"]["sessions"] >= MIN_WEEK,
            "month_enough": m["month"]["sessions"] >= MIN_MONTH and m["prev_month"]["sessions"] >= MIN_MONTH,
        })

    w = base["windows"]
    return {
        "windows": _window_meta(w),
        "wow_label": f"{_label(*w['week'])} vs {_label(*w['prev_week'])}",
        "mom_label": f"{_label(*w['month'])} vs {_label(*w['prev_month'])}",
        "min_week": MIN_WEEK,
        "min_month": MIN_MONTH,
        "revenue_available": all(base["sales_ok"].values()),
        "pages": rows,
        "errors": base["errors"],
    }


# --------------------------------------------------------------------------- deep dive

def _q(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'")


def _split_rows(results: dict, prefix: str, key: str, windows) -> list[dict]:
    """{label: {window: rates}} rows sorted by this-month sessions."""
    by: dict[str, dict[str, dict]] = {}
    for name in windows:
        accs: dict[str, dict] = {}
        for r in results.get(f"{prefix}_{name}") or []:
            raw = r.get(key)
            if raw is None:
                continue
            _add(accs.setdefault(str(raw).strip() or "Unknown", _acc()), r)
        for label, a in accs.items():
            by.setdefault(label, {})[name] = _rates(a)
    empty = _rates(None)
    out = []
    for label, v in by.items():
        out.append({"label": label, **{n: v.get(n, empty) for n in windows}})
    out.sort(key=lambda r: -r["month"]["sessions"])
    return out


def _clarity(db: Session, store: models.Store, path: str, w: dict) -> dict | None:
    m = re.search(r"/products/([^/?#]+)", path)
    if not m:
        return None
    handle = m.group(1).lower()
    rows = (
        db.query(models.ClarityProductDay.day, func.sum(models.ClarityProductDay.sessions))
        .filter(
            models.ClarityProductDay.store_id == store.id,
            models.ClarityProductDay.handle == handle,
            models.ClarityProductDay.day >= w["prev_month"][0],
            models.ClarityProductDay.day <= w["month"][1],
        )
        .group_by(models.ClarityProductDay.day)
        .all()
    )
    any_saved = (
        db.query(func.count(models.ClarityProductDay.id))
        .filter(models.ClarityProductDay.store_id == store.id, models.ClarityProductDay.day >= w["prev_month"][0])
        .scalar()
    )
    if not any_saved:
        return {"available": False, "handle": handle}
    by_day = {d: int(s or 0) for d, s in rows}
    out = {"available": True, "handle": handle}
    for name, (a, b) in w.items():
        out[name] = sum(v for d, v in by_day.items() if a <= d <= b)
    return out


def _insights(m: dict, sources: list[dict], devices: list[dict]) -> list[dict]:
    """Short plain-language notes: what moved week on week / month on month."""
    notes: list[dict] = []

    def rate_note(metric, label, cur_w, prev_w, lower_better, min_s, period):
        c, p = m[cur_w], m[prev_w]
        if c["sessions"] < min_s or p["sessions"] < min_s or c[metric] is None or p[metric] is None:
            return
        d = round(c[metric] - p[metric], 2)
        if abs(d) < (2.0 if metric == "bounce_rate" else 0.3):
            return
        good = d < 0 if lower_better else d > 0
        notes.append({
            "tone": "good" if good else "bad",
            "text": f"{label} {'up' if d > 0 else 'down'} {abs(d)} pts {period} ({p[metric]}% -> {c[metric]}%).",
        })

    rate_note("conversion_rate", "Conversion", "week", "prev_week", False, MIN_WEEK, "week on week")
    rate_note("bounce_rate", "Bounce rate", "week", "prev_week", True, MIN_WEEK, "week on week")
    rate_note("added_to_cart_rate", "Add-to-cart", "week", "prev_week", False, MIN_WEEK, "week on week")
    rate_note("conversion_rate", "Conversion", "month", "prev_month", False, MIN_MONTH, "month on month")
    rate_note("bounce_rate", "Bounce rate", "month", "prev_month", True, MIN_MONTH, "month on month")

    for cur_w, prev_w, period in (("week", "prev_week", "WoW"), ("month", "prev_month", "MoM")):
        c, p = m[cur_w]["sessions"], m[prev_w]["sessions"]
        if p >= 50 and c and abs(c - p) / p >= 0.2:
            pct = round((c - p) / p * 100)
            notes.append({"tone": "good" if pct > 0 else "bad",
                          "text": f"Sessions {'+' if pct > 0 else ''}{pct}% {period} ({p:,} -> {c:,})."})
        rc, rp = m[cur_w]["revenue"], m[prev_w]["revenue"]
        if rc is not None and rp and abs(rc - rp) / rp >= 0.2:
            pct = round((rc - rp) / rp * 100)
            notes.append({"tone": "good" if pct > 0 else "bad",
                          "text": f"Revenue {'+' if pct > 0 else ''}{pct}% {period}."})

    def seg_notes(rows, kind):
        best = None
        for r in rows:
            c, p = r["week"], r["prev_week"]
            if c["sessions"] < 30 or p["sessions"] < 30 or c["conversion_rate"] is None or p["conversion_rate"] is None:
                continue
            d = c["conversion_rate"] - p["conversion_rate"]
            if best is None or abs(d) > abs(best[1]):
                best = (r["label"], d, p["conversion_rate"], c["conversion_rate"])
        if best and abs(best[1]) >= 0.5:
            notes.append({"tone": "good" if best[1] > 0 else "bad",
                          "text": f"{kind} '{best[0]}': conversion {best[2]}% -> {best[3]}% week on week."})
        grow = None
        for r in rows:
            c, p = r["week"]["sessions"], r["prev_week"]["sessions"]
            if max(c, p) < 30:
                continue
            if grow is None or abs(c - p) > abs(grow[1] - grow[2]):
                grow = (r["label"], c, p)
        if grow and abs(grow[1] - grow[2]) >= 30:
            notes.append({"tone": "info",
                          "text": f"Biggest traffic shift: {kind.lower()} '{grow[0]}' {grow[2]:,} -> {grow[1]:,} sessions week on week."})

    seg_notes(sources, "Source")
    seg_notes(devices, "Device")
    return notes


def fetch_landing_deep_dive(db: Session, store: models.Store, path: str) -> dict:
    path = norm_path(path)
    today = datetime.now(_tz(store)).date().isoformat()
    key = (store.store_url, path, today)
    hit = _deep_cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]

    base = _base(store)
    w = base["windows"]
    raw = base["raw_path"].get(path, path)
    H = HUMAN_SESSIONS_FILTER
    where = f"{H}AND landing_page_path = '{_q(raw)}' "

    queries = {
        "daily": f"FROM sessions SHOW {SESSION_METRICS} {where}TIMESERIES day {_since(w['prev_month'][0], w['month'][1])} ORDER BY day ASC",
    }
    for name, (a, b) in w.items():
        queries[f"src_{name}"] = f"FROM sessions SHOW {SESSION_METRICS} {where}GROUP BY referrer_source {_since(a, b)} ORDER BY sessions DESC LIMIT 50"
        queries[f"dev_{name}"] = f"FROM sessions SHOW {SESSION_METRICS} {where}GROUP BY session_device_type {_since(a, b)} ORDER BY sessions DESC LIMIT 20"
    for name in ("month", "prev_month"):
        a, b = w[name]
        queries[f"geo_{name}"] = f"FROM sessions SHOW {SESSION_METRICS} {where}GROUP BY session_country_code {_since(a, b)} ORDER BY sessions DESC LIMIT 50"
    results, errors = _parallel(store, queries)

    daily = []
    for r in results.get("daily") or []:
        d = str(r.get("day") or "")[:10]
        if not d:
            continue
        acc = _acc()
        _add(acc, r)
        rates = _rates(acc)
        daily.append({"date": d, **rates})

    metrics = _page_metrics(base, path)
    sources = _split_rows(results, "src", "referrer_source", WINDOWS)
    devices = _split_rows(results, "dev", "session_device_type", WINDOWS)
    countries = _split_rows(results, "geo", "session_country_code", ("month", "prev_month"))[:10]

    try:
        clarity = _clarity(db, store, path, w)
    except Exception as exc:
        logger.warning("Clarity lookup failed for %s: %s", path, exc)
        clarity = None

    result = {
        "path": path,
        "page_type": base["page_type"].get(path, "Other"),
        "windows": _window_meta(w),
        "min_week": MIN_WEEK,
        "min_month": MIN_MONTH,
        "revenue_available": all(base["sales_ok"].values()),
        "metrics": metrics,
        "daily": daily,
        "sources": sources[:12],
        "devices": devices,
        "countries": countries,
        "clarity": clarity,
        "insights": _insights(metrics, sources, devices),
        "errors": {**base["errors"], **errors},
    }
    _deep_cache[key] = (time.time() + CACHE_SECONDS, result)
    return result


# --------------------------------------------------------------------------- date-wise grid

DAILY_DAYS = 60       # always pull 60 complete days per page, then slice
MAX_DAILY_PAGES = 15
_daily_cache: dict = {}


def _page_daily(store: models.Store, base: dict, path: str, first: date, last: date) -> tuple[dict[str, dict], dict]:
    """{date: metrics} for one page, 60 days, cached per page per day."""
    key = (store.store_url, path, last.isoformat())
    hit = _daily_cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    H = HUMAN_SESSIONS_FILTER
    raw = base["raw_path"].get(path, path)
    queries = {
        "s": f"FROM sessions SHOW {SESSION_METRICS} {H}AND landing_page_path = '{_q(raw)}' TIMESERIES day {_since(first, last)} ORDER BY day ASC",
    }
    raw_sales = base["raw_sales_path"].get(path)
    if raw_sales:
        queries["o"] = (
            f"FROM sales SHOW total_sales, orders WHERE order_landing_page_path = '{_q(raw_sales)}' "
            f"TIMESERIES day {_since(first, last)} ORDER BY day ASC"
        )
    errors = {}
    rows = {}
    for name, q in queries.items():
        try:
            rows[name] = _run(store, q)
        except Exception as exc:
            logger.warning("Landing daily %s %s failed: %s", path, name, exc)
            errors[f"{path} ({'sessions' if name == 's' else 'sales'})"] = str(exc)[:200]
            rows[name] = None
    sales_ok = rows.get("o") is not None or not raw_sales  # no orders ever = 0 revenue, not unknown

    by_day: dict[str, dict] = {}
    for r in rows.get("s") or []:
        d = str(r.get("day") or "")[:10]
        if d:
            acc = _acc()
            _add(acc, r)
            by_day[d] = _rates(acc)
    sales_by_day: dict[str, dict] = {}
    for r in rows.get("o") or []:
        d = str(r.get("day") or "")[:10]
        if d:
            s = sales_by_day.setdefault(d, {"revenue": 0.0, "orders": 0})
            s["revenue"] += _f(r.get("total_sales")) or 0.0
            s["orders"] += _i(r.get("orders"))
    out = {}
    d = first
    while d <= last:
        k = d.isoformat()
        out[k] = _with_sales(by_day.get(k, _rates(None)), sales_by_day.get(k), sales_ok and rows.get("s") is not None)
        d += timedelta(days=1)
    val = (out, errors)
    # don't keep a failed load for 10 minutes
    _daily_cache[key] = (time.time() + (CACHE_SECONDS if not errors else 60), val)
    return val


def fetch_landing_daily(store: models.Store, paths: list[str] | None, days: int = 30) -> dict:
    """
    Excel-style grid: one row per date, one column per landing page.
    paths None/empty -> the top pages by last-30-day sessions.
    """
    base = _base(store)
    days = max(1, min(days, DAILY_DAYS))
    last = datetime.now(_tz(store)).date() - timedelta(days=1)
    first60 = last - timedelta(days=DAILY_DAYS - 1)
    first = last - timedelta(days=days - 1)

    ranked = sorted(base["sessions"]["month"].items(), key=lambda kv: -kv[1]["sessions"])
    if paths:
        wanted = []
        for p in paths:
            n = norm_path(p)
            if n not in wanted:
                wanted.append(n)
        wanted = wanted[:MAX_DAILY_PAGES]
    else:
        wanted = [p for p, _ in ranked[:8]]

    errors: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        res = list(pool.map(lambda p: _page_daily(store, base, p, first60, last), wanted))

    dates = []
    d = last
    while d >= first:
        dates.append(d.isoformat())
        d -= timedelta(days=1)

    columns = []
    for p, (daily, errs) in zip(wanted, res):
        errors.update(errs)
        columns.append({
            "path": p,
            "page_type": base["page_type"].get(p, "Other"),
            "days": {k: daily[k] for k in dates if k in daily},
        })

    return {
        "first": first.isoformat(),
        "last": last.isoformat(),
        "days": days,
        "dates": dates,  # newest first
        "pages": columns,
        "available_pages": [
            {"path": p, "page_type": base["page_type"].get(p, "Other"), "sessions_30d": v["sessions"]}
            for p, v in ranked[:MAX_PAGES]
        ],
        "max_pages": MAX_DAILY_PAGES,
        "revenue_available": all(base["sales_ok"].values()),
        "errors": errors,
    }
