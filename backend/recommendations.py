"""
CRO Recommendations (manager checklist, section 8, P2).

One list, ranked by estimated impact, pulling the flagged items from every
page of the dashboard:

  Landing Pages      - pages that convert far below the store, pages whose
                       bounce jumped, pages / traffic sources worth promoting
  Conversion         - device or traffic source converting below the store,
                       store conversion rate falling vs the period before
  Cart & Checkout    - payment methods failing more than the rest
  Product Analytics  - "leaky" products (many views, few buyers; needs Clarity)
  Overview           - refund rate

Estimated impact (checklist formula) = sessions x conversion gap x AOV:
  the extra sales in the chosen dates if that segment converted like the
  store average (or, for "promote", what its above-average visits add).
It's an estimate to rank the list, not a promise.

Every item ends in an action - fix, promote or test - and the team can mark
it in progress, done or ignored (saved per store, by a stable key).

Only real data: an item appears only when the numbers behind it are there.
Read-only towards Shopify.
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from sqlalchemy.orm import Session

import models
from landing import fetch_landing_pages, period_windows

logger = logging.getLogger("recommendations")

STATUSES = ("open", "in_progress", "done", "ignored")

EFFORT = {
    "landing_fix": "Medium",
    "landing_bounce": "Medium",
    "landing_promote": "Low",
    "device_gap": "High",
    "source_test": "Medium",
    "source_promote": "Low",
    "cvr_drop": "Medium",
    "payment_method": "Low",
    "product_leak": "Medium",
    "refunds": "Medium",
}


def _money(v: float) -> str:
    return f"${v:,.0f}"


def _store_money(store: models.Store, first, last) -> tuple[float | None, int]:
    """(AOV, orders) from Shopify's sales report: (gross - discounts) / orders,
    the same AOV definition Shopify Analytics uses."""
    from shopify_sales import add, daily_sales

    days = daily_sales(store, first, last)
    t = add(list(days.values()))
    aov = (t["gross"] - t["discounts"]) / t["orders"] if t["orders"] else None
    return (round(aov, 2) if aov else None), int(t["orders"])


def _weighted_cvr(rows: list[dict], key: str = "conversion_rate", sess: str = "sessions") -> tuple[float | None, int]:
    s = sum(r.get(sess) or 0 for r in rows if r.get(key) is not None)
    if not s:
        return None, 0
    return sum((r.get(sess) or 0) * r[key] for r in rows if r.get(key) is not None) / s, s


def _gap_impact(sessions: int, gap_pts: float, aov: float) -> float:
    return round(sessions * gap_pts / 100 * aov, 2)


def _formula(sessions: int, gap_pts: float, aov: float) -> str:
    return f"{sessions:,} sessions × {gap_pts:.2f} pts conversion gap × {_money(aov)} AOV"


def build_recommendations(db: Session, store: models.Store, days: int = 30, period: str | None = None) -> dict:
    """period: None (last `days` complete days) or "yesterday"."""
    period = "yesterday" if period == "yesterday" else None
    first, last, p_first, p_last, window_label, compare_label = period_windows(store, days, period)
    errors: list[str] = []

    # Every source is loaded in parallel; one failing source drops only its items.
    def lp():
        return fetch_landing_pages(store, days=days, period=period)

    def money():
        return _store_money(store, first, last)

    def cart():
        from cart_extras import fetch_cart_extras
        return fetch_cart_extras(db, store, days=days, period=period)

    def health():
        from order_health import fetch_order_health
        return fetch_order_health(db, store, days=days, period=period)

    def products():
        if period:  # product groups need several days of views
            return None
        from product_groups import fetch_product_analytics
        return fetch_product_analytics(db, store, days=min(max(days, 7), 60))

    jobs = {"landing": lp, "money": money, "cart": cart, "health": health, "products": products}
    got: dict = {}
    # The DB-backed jobs share one Session, so they run here one after the
    # other; only the pure Shopify calls go to threads.
    with ThreadPoolExecutor(max_workers=2) as pool:
        futs = {k: pool.submit(jobs[k]) for k in ("landing", "money")}
        for k in ("cart", "health", "products"):
            try:
                got[k] = jobs[k]()
            except Exception as exc:
                logger.warning("Recommendations source %s failed: %s", k, exc)
                errors.append(f"{k}: {str(exc)[:200]}")
                got[k] = None
        for k, f in futs.items():
            try:
                got[k] = f.result()
            except Exception as exc:
                logger.warning("Recommendations source %s failed: %s", k, exc)
                errors.append(f"{k}: {str(exc)[:200]}")
                got[k] = None

    landing = got.get("landing")
    aov, orders = got.get("money") or (None, 0)
    if aov is None and landing:
        rev = sum(p.get("revenue") or 0 for p in landing["pages"])
        o = sum(p.get("orders") or 0 for p in landing["pages"])
        aov = round(rev / o, 2) if o else None

    recs: list[dict] = []
    store_cvr = None
    sessions_total = 0
    if landing:
        store_cvr, sessions_total = _weighted_cvr(landing["by_device"])
    min_s = landing["min_sessions"] if landing else 100

    def add(key, kind, action, title, page, segment, evidence, impact, formula):
        recs.append({
            "key": key,
            "kind": kind,
            "action": action,
            "title": title,
            "page": page,
            "segment": segment,
            "evidence": evidence,
            "impact": round(impact, 2) if impact is not None else None,
            "impact_formula": formula,
            "effort": EFFORT[kind],
        })

    if landing and store_cvr and aov:
        flagged_pages = set()
        # 1. Landing pages converting well below the store (fix).
        for p in landing["pages"]:
            cvr = p.get("conversion_rate")
            if p["too_few_sessions"] or cvr is None or cvr >= store_cvr * 0.7:
                continue
            gap = store_cvr - cvr
            flagged_pages.add(p["path"])
            ev = [
                f"{p['sessions']:,} sessions, conversion {cvr:.2f}% vs store {store_cvr:.2f}%",
                f"Bounce rate {p['bounce_rate']:.1f}%, add to cart {p['added_to_cart_rate']:.1f}%"
                if p.get("bounce_rate") is not None and p.get("added_to_cart_rate") is not None else None,
                f"Main traffic: {p['top_source']} ({p['top_source_share']}% of visits)" if p.get("top_source") else None,
            ]
            add(f"landing_fix:{p['path']}", "landing_fix", "fix",
                f"Fix landing page {p['path']}: converts {cvr:.2f}% vs {store_cvr:.2f}% store",
                "Landing Pages", f"{p['page_type']} · {p['path']}", [e for e in ev if e],
                _gap_impact(p["sessions"], gap, aov), _formula(p["sessions"], gap, aov))

        # 2. Bounce jumped and conversion fell vs the period before (fix).
        for p in landing["pages"]:
            b, c = p.get("bounce_change_pts"), p.get("conversion_change_pts")
            if p["path"] in flagged_pages or b is None or c is None or b < landing["bounce_flag_pts"] or c >= 0:
                continue
            add(f"landing_bounce:{p['path']}", "landing_bounce", "fix",
                f"Bounce jumped on {p['path']} (+{b:.1f} pts) and conversion fell",
                "Landing Pages", f"{p['page_type']} · {p['path']}",
                [f"Bounce {p['previous_bounce_rate']:.1f}% → {p['bounce_rate']:.1f}% ({compare_label} → now)",
                 f"Conversion {p['previous_conversion_rate']:.2f}% → {p['conversion_rate']:.2f}% on {p['sessions']:,} sessions",
                 "Check the change log for what changed on this page"],
                _gap_impact(p["sessions"], -c, aov), _formula(p["sessions"], -c, aov))

        # 3. Pages converting far above the store with modest traffic (promote).
        ranked = sorted(landing["pages"], key=lambda x: -x["sessions"])
        median_s = ranked[len(ranked) // 2]["sessions"] if ranked else 0
        for p in landing["pages"]:
            cvr = p.get("conversion_rate")
            if p["too_few_sessions"] or cvr is None or cvr < store_cvr * 1.5 or p["sessions"] > max(median_s, min_s) * 4:
                continue
            gap = cvr - store_cvr
            add(f"landing_promote:{p['path']}", "landing_promote", "promote",
                f"Send more traffic to {p['path']}: converts {cvr:.2f}% vs {store_cvr:.2f}% store",
                "Landing Pages", f"{p['page_type']} · {p['path']}",
                [f"{p['sessions']:,} sessions, conversion {cvr:.2f}%",
                 f"Revenue {_money(p['revenue'])} from {p['orders']} orders" if p.get("revenue") else None],
                _gap_impact(p["sessions"], gap, aov),
                _formula(p["sessions"], gap, aov) + " (extra earned by these visits vs an average page)")

        # 4. Device converting below the store (fix).
        for d in landing["by_device"]:
            cvr = d.get("conversion_rate")
            if d["too_few_sessions"] or cvr is None or cvr >= store_cvr * 0.85:
                continue
            gap = store_cvr - cvr
            add(f"device_gap:{d['label']}", "device_gap", "fix",
                f"{d['label']} converts {cvr:.2f}% vs {store_cvr:.2f}% store",
                "Conversion Analytics", f"Device · {d['label']}",
                [f"{d['sessions']:,} sessions ({d['sessions'] / sessions_total * 100:.0f}% of visits)",
                 f"Add to cart {d['added_to_cart_rate']:.1f}%, bounce {d['bounce_rate']:.1f}%"
                 if d.get("added_to_cart_rate") is not None and d.get("bounce_rate") is not None else "",
                 "Check page speed, sticky add-to-cart and checkout on this device"],
                _gap_impact(d["sessions"], gap, aov), _formula(d["sessions"], gap, aov))

        # 5. Traffic sources: very low converters (test) and strong ones (promote).
        for s in landing["by_source"]:
            cvr = s.get("conversion_rate")
            if s["too_few_sessions"] or cvr is None:
                continue
            if cvr < store_cvr * 0.6:
                gap = store_cvr - cvr
                add(f"source_test:{s['label']}", "source_test", "test",
                    f"Test a better landing page / offer for {s['label']} traffic ({cvr:.2f}% conversion)",
                    "Landing Pages", f"Traffic source · {s['label']}",
                    [f"{s['sessions']:,} sessions, conversion {cvr:.2f}% vs store {store_cvr:.2f}%",
                     f"Bounce {s['bounce_rate']:.1f}%" if s.get("bounce_rate") is not None else ""],
                    _gap_impact(s["sessions"], gap, aov), _formula(s["sessions"], gap, aov))
            elif cvr > store_cvr * 1.5:
                gap = cvr - store_cvr
                add(f"source_promote:{s['label']}", "source_promote", "promote",
                    f"Grow {s['label']} traffic: converts {cvr:.2f}% vs {store_cvr:.2f}% store",
                    "Landing Pages", f"Traffic source · {s['label']}",
                    [f"{s['sessions']:,} sessions, conversion {cvr:.2f}%"],
                    _gap_impact(s["sessions"], gap, aov),
                    _formula(s["sessions"], gap, aov) + " (extra earned by these visits vs average traffic)")

        # 6. Store conversion fell vs the period before (fix).
        prev_cvr, prev_s = _weighted_cvr(
            [{"sessions": d.get("previous_sessions") or 0, "conversion_rate": d.get("previous_conversion_rate")}
             for d in landing["by_device"]])
        if prev_cvr and prev_s >= min_s and store_cvr < prev_cvr * 0.9:
            gap = prev_cvr - store_cvr
            add("cvr_drop:store", "cvr_drop", "fix",
                f"Store conversion fell to {store_cvr:.2f}% from {prev_cvr:.2f}%",
                "Conversion Analytics", "Whole store",
                [f"{compare_label}: {prev_cvr:.2f}% on {prev_s:,} sessions",
                 f"Now: {store_cvr:.2f}% on {sessions_total:,} sessions",
                 "Check the change log and the device / source items below"],
                _gap_impact(sessions_total, gap, aov), _formula(sessions_total, gap, aov))

    # 7. Payment methods failing more than the rest (fix).
    cart = got.get("cart")
    pay = cart.get("payments") if cart else None
    if pay and pay.get("authorization_rate") and aov:
        overall = pay["authorization_rate"]
        for m in pay["methods"] + pay.get("wallets", []):
            rate = m.get("authorization_rate")
            if rate is None or m["attempts"] < (10 if period else 30) or rate >= overall - 3:
                continue
            lost = m["attempts"] * (overall - rate) / 100
            add(f"payment_method:{m['label']}", "payment_method", "fix",
                f"Payments via {m['label']} succeed only {rate}% (store {overall}%)",
                "Cart & Checkout", f"Payment · {m['label']}",
                [f"{m['attempts']:,} purchase attempts, {m['failed_attempts']:,} failed attempts",
                 "Check the gateway / wallet setup and its error messages"],
                round(lost * aov, 2),
                f"{m['attempts']:,} attempts × {overall - rate:.1f} pts success gap × {_money(aov)} AOV")

    # 8. Leaky products from Product Analytics (fix) - needs Clarity views.
    prod = got.get("products")
    if prod and prod.get("views_available"):
        for p in (prod.get("fix_first") or [])[:5]:
            add(f"product_leak:{p['name']}", "product_leak", "fix",
                f"Fix product page: {p['name']} (many views, few buyers)",
                "Product Analytics", f"Product · {p.get('category') or ''}".strip(" ·"),
                [f"{p.get('views', 0):,} views, view-to-purchase {p.get('view_to_purchase_rate')}% vs category {p.get('category_rate')}%",
                 "Check price, photos, reviews and stock on this page"],
                p["revenue_left_on_table"],
                f"{p.get('views', 0):,} views × {(p.get('category_rate') or 0) - (p.get('view_to_purchase_rate') or 0):.2f} pts gap × product price"
                + (f" ({prod.get('views_window_label')})" if prod.get("views_window_label") else ""))

    # 9. Refund rate (fix).
    h = got.get("health")
    if h and h.get("total_orders", 0) >= 20 and aov:
        any_ref = h.get("any_refund", {})
        pct = any_ref.get("pct") or 0
        if pct >= 5:
            extra = any_ref["count"] - h["total_orders"] * 0.03
            add("refunds:store", "refunds", "fix",
                f"{pct}% of orders were refunded",
                "Overview", "Orders · refunds",
                [f"{any_ref['count']:,} of {h['total_orders']:,} orders refunded (fully or partly)",
                 "Check refund reasons: sizing, quality, shipping damage"],
                round(max(extra, 0) * aov, 2),
                f"{max(extra, 0):.0f} refunds above a 3% norm × {_money(aov)} AOV")

    # Clean evidence, attach saved status, rank by impact.
    saved = {
        r.rec_key: r
        for r in db.query(models.RecommendationStatus).filter(models.RecommendationStatus.store_id == store.id)
    }
    for r in recs:
        r["evidence"] = [e for e in r["evidence"] if e]
        s = saved.get(r["key"])
        r["status"] = s.status if s else "open"
        r["status_updated_at"] = s.updated_at.isoformat() if s and s.updated_at else None
    recs.sort(key=lambda r: -(r["impact"] or 0))
    for i, r in enumerate(recs, 1):
        r["rank"] = i

    active = [r for r in recs if r["status"] not in ("done", "ignored")]
    return {
        "days": days,
        "period": period or f"last{days}",
        "window_label": window_label,
        "compare_label": compare_label,
        "store_conversion_rate": round(store_cvr, 2) if store_cvr else None,
        "sessions": sessions_total,
        "aov": aov,
        "orders": orders,
        "total_impact": round(sum(r["impact"] or 0 for r in active), 2),
        "recommendations": recs,
        "errors": errors,
    }


def set_status(db: Session, store: models.Store, key: str, status: str) -> dict:
    if status not in STATUSES:
        raise ValueError(f"status must be one of {STATUSES}")
    row = (
        db.query(models.RecommendationStatus)
        .filter(models.RecommendationStatus.store_id == store.id, models.RecommendationStatus.rec_key == key)
        .first()
    )
    if not row:
        row = models.RecommendationStatus(store_id=store.id, rec_key=key[:300])
        db.add(row)
    row.status = status
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"key": key, "status": status}
