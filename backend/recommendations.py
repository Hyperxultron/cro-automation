"""
CRO Recommendations engine (manager checklist, section 8) - v2, "deep dive".

v1 listed segments that converted below the store with one generic line of
advice. v2 reads every data source the dashboard already has and, for each
problem it finds, writes a full playbook:

  diagnosis   what is happening, in numbers (this period vs the period before,
              vs the store average, vs the best segment, vs a cited benchmark)
  metrics     the numbers behind it, as a small table
  causes      the most likely reasons, picked from the data pattern
              (e.g. high bounce + slow mobile LCP -> speed; high bounce + 70%
              Facebook traffic -> ad / landing page mismatch; normal bounce but
              low add-to-cart -> the offer, price or page doesn't sell)
  steps       concrete things to do, naming the products / pages / search
              terms / codes involved
  test        an A/B test plan: hypothesis, success metric, sessions needed
              per variant and how many days that takes at current traffic
  impact      estimated extra sales per month, with the formula and any
              assumption written out; confidence from the sample size
  priority    impact x confidence / effort, used for the ranking

Sources (all read-only):
  Shopify Analytics (ShopifyQL): funnel by device (sessions -> cart ->
      checkout -> purchase), landing pages, traffic sources, geo, page speed
      (Core Web Vitals), site search, payment attempts, sales / AOV.
  Shopify orders (Admin API): discount codes, bought-together pairs, new vs
      returning customers, repeat purchase, items per order, refunds.
  Microsoft Clarity: product page views -> per-product view-to-purchase.

Only real data: an item appears only when the numbers behind it are there.
Every estimate is labelled as an estimate. Fix items assume the team closes
HALF the gap (a realistic target, not the full theoretical upside).
"""

from __future__ import annotations

import logging
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from sqlalchemy.orm import Session

import models

logger = logging.getLogger("recommendations")

STATUSES = ("open", "in_progress", "done", "ignored")

BAYMARD_CART_ABANDONMENT = 70.0     # % of carts not bought (Baymard, widely cited)
INDUSTRY_CVR = 2.5                  # % commonly cited e-commerce average
CLOSE_GAP = 0.5                     # fix items: assume half the gap is closed

CONF_WEIGHT = {"High": 1.0, "Medium": 0.7, "Low": 0.4}
EFFORT_WEIGHT = {"Low": 1.0, "Medium": 1.6, "High": 2.5}

AREAS = (
    "Funnel", "Mobile", "Landing pages", "Traffic", "Products", "Checkout",
    "Product pages", "Trust & offers", "Delivery", "Order value", "Retention", "Speed", "Search",
    "Geography", "Refunds",
)


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------

def _money(v: float | None) -> str:
    return "—" if v is None else f"${v:,.0f}"


def _pct(v: float | None, d: int = 2) -> str:
    return "—" if v is None else f"{v:.{d}f}%"


def _rate(num, den) -> float | None:
    return num / den * 100 if num is not None and den else None


def _conf(n: int, high: int = 3000, medium: int = 800) -> str:
    return "High" if n >= high else ("Medium" if n >= medium else "Low")


def _label(s) -> str:
    s = str(s or "").strip()
    return s[:1].upper() + s[1:] if s else "Unknown"


def _weighted(rows: list[dict], key: str, w: str = "sessions") -> tuple[float | None, int]:
    s = sum(r.get(w) or 0 for r in rows if r.get(key) is not None)
    if not s:
        return None, 0
    return sum((r.get(w) or 0) * r[key] for r in rows if r.get(key) is not None) / s, s


def _metric(label: str, value: str, compare: str | None = None, compare_label: str | None = None,
            gap: str | None = None, bad: bool | None = None) -> dict:
    return {"label": label, "value": value, "compare": compare, "compare_label": compare_label,
            "gap": gap, "bad": bad}


def test_plan(hypothesis: str, metric: str, base_rate_pct: float | None, rel_lift: float,
              daily_sessions: float | None, metric_key: str = "conversion_rate") -> dict:
    """
    A/B sample size for a two-sided test at 95% confidence and 80% power
    (Lehr's rule: n per variant ~= 16 * p(1-p) / delta^2).
    """
    plan = {"hypothesis": hypothesis, "metric": metric, "metric_key": metric_key,
            "target_lift_pct": round(rel_lift * 100), "sessions_per_variant": None,
            "days_needed": None, "note": None}
    if not base_rate_pct or base_rate_pct <= 0 or base_rate_pct >= 100:
        return plan
    p = base_rate_pct / 100
    delta = p * rel_lift
    n = math.ceil(16 * p * (1 - p) / (delta * delta))
    plan["sessions_per_variant"] = n
    if daily_sessions and daily_sessions > 0:
        days = math.ceil(2 * n / daily_sessions)
        plan["days_needed"] = days
        if days > 42:
            plan["note"] = (f"At current traffic a clean A/B test would take ~{days} days. "
                            "Ship the change to everyone and compare 2 weeks before vs 2 weeks after instead.")
        elif days < 7:
            plan["days_needed"] = 7
            plan["note"] = "Run at least one full week so every weekday is included."
    return plan


class _Builder:
    """Collects recommendations with a uniform shape."""

    def __init__(self, ctx: dict):
        self.ctx = ctx
        self.items: list[dict] = []

    def add(self, *, key: str, kind: str, area: str, action: str, title: str, segment: str, page: str,
            diagnosis: str, metrics: list[dict], causes: list[str], steps: list[str],
            impact: float | None, formula: str, window_days: int, confidence: str, effort: str,
            test: dict | None = None, assumption: str | None = None, page_path: str | None = None,
            window_label: str | None = None):
        impact = round(impact, 2) if impact is not None and impact > 0 else None
        monthly = round(impact * 30 / max(window_days, 1), 2) if impact else None
        self.items.append({
            "key": key[:300],
            "kind": kind,
            "area": area,
            "action": action,
            "title": title,
            "segment": segment,
            "page": page,
            "page_path": page_path,
            "diagnosis": diagnosis,
            "metrics": metrics,
            "causes": [c for c in causes if c],
            "steps": [s for s in steps if s],
            "test": test,
            "impact": impact,
            "monthly_impact": monthly,
            "impact_formula": formula,
            "assumption": assumption,
            "window_days": window_days,
            "window_label": window_label or self.ctx["window_label"],
            "confidence": confidence,
            "effort": effort,
            # v1 field, kept for anything that still reads it (daily email etc.)
            "evidence": [f"{m['label']}: {m['value']}" + (f" vs {m['compare']} {m['compare_label'] or ''}".rstrip() if m.get("compare") else "")
                         for m in metrics],
        })


# ---------------------------------------------------------------------------
# data gathering
# ---------------------------------------------------------------------------

FUNNEL_SHOW = ("sessions, sessions_with_cart_additions, sessions_that_reached_checkout, "
               "sessions_that_completed_checkout")


def _device_funnel(store: models.Store, first, last) -> dict[str, dict]:
    from landing import _i, _run, _since
    from shopify_client import HUMAN_SESSIONS_FILTER

    rows = _run(store, f"FROM sessions SHOW {FUNNEL_SHOW} {HUMAN_SESSIONS_FILTER}"
                       f"GROUP BY session_device_type {_since(first, last)} ORDER BY sessions DESC")
    out: dict[str, dict] = {}
    for r in rows:
        if r.get("session_device_type") is None:
            continue
        d = out.setdefault(_label(r["session_device_type"]), {"sessions": 0, "cart": 0, "checkout": 0, "purchase": 0})
        d["sessions"] += _i(r.get("sessions"))
        d["cart"] += _i(r.get("sessions_with_cart_additions"))
        d["checkout"] += _i(r.get("sessions_that_reached_checkout"))
        d["purchase"] += _i(r.get("sessions_that_completed_checkout"))
    return out


def _sum_funnel(devs: dict[str, dict] | None) -> dict | None:
    if not devs:
        return None
    t = {"sessions": 0, "cart": 0, "checkout": 0, "purchase": 0}
    for d in devs.values():
        for k in t:
            t[k] += d[k]
    return t if t["sessions"] else None


def _store_money(store: models.Store, first, last) -> tuple[float | None, int, float]:
    """(AOV, orders, net sales) from Shopify's sales report, AOV = (gross - discounts) / orders."""
    from shopify_sales import add, daily_sales

    t = add(list(daily_sales(store, first, last).values()))
    aov = (t["gross"] - t["discounts"]) / t["orders"] if t["orders"] else None
    return (round(aov, 2) if aov else None), int(t["orders"]), float(t.get("net") or 0)


def gather(db: Session, store: models.Store, days: int, period: str | None) -> dict:
    from landing import period_windows

    first, last, p_first, p_last, window_label, compare_label = period_windows(store, days, period)
    # Merchandising / retention / product items need several weeks of orders,
    # so for "Yesterday" they use the last 30 days (and say so on the card).
    struct_days = 30 if period else days
    s_first, s_last, _, _, struct_label, _ = period_windows(store, struct_days, None)
    window_days = 1 if period else days

    errors: list[str] = []
    got: dict = {}

    def run(name, fn):
        try:
            return fn()
        except Exception as exc:  # one failing source drops only its items
            logger.warning("Recommendations source %s failed: %s", name, exc)
            errors.append(f"{name}: {str(exc)[:200]}")
            return None

    def landing():
        from landing import fetch_landing_pages
        return fetch_landing_pages(store, days=days, period=period)

    def site():
        from site_health import fetch_site_health
        return fetch_site_health(store, days=days, period=period)

    def geo():
        from geo import fetch_geo
        return fetch_geo(store, period="yesterday" if period else "days", days=days)

    def catalog():
        from catalog_audit import fetch_catalog
        return fetch_catalog(store)

    def variant_sales():
        from catalog_audit import fetch_variant_sales
        return fetch_variant_sales(store, s_first, s_last)

    def delivery():
        from catalog_audit import fetch_delivery
        return fetch_delivery(store)

    shopify_jobs = {
        "landing": landing,
        "funnel": lambda: _device_funnel(store, first, last),
        "funnel_prev": lambda: _device_funnel(store, p_first, p_last),
        "money": lambda: _store_money(store, first, last),
        "money_struct": (lambda: _store_money(store, s_first, s_last)) if period else (lambda: None),
        "site": site,
        "geo": geo,
        "catalog": catalog,
        "variant_sales": variant_sales,
        "delivery": delivery,
    }

    def cart():
        from cart_extras import fetch_cart_extras
        return fetch_cart_extras(db, store, days=days, period=period)

    def cart_struct():
        if not period:
            return None
        from cart_extras import fetch_cart_extras
        return fetch_cart_extras(db, store, days=struct_days, period=None)

    def health():
        from order_health import fetch_order_health
        return fetch_order_health(db, store, days=struct_days, period=None)

    def products():
        from product_groups import fetch_product_analytics
        return fetch_product_analytics(db, store, days=min(max(struct_days, 7), 60))

    def deeper():
        from deeper import fetch_deeper
        return fetch_deeper(db, store, days=min(max(struct_days, 7), 60))

    # DB-backed jobs share one Session, so they run here one after the other;
    # the pure Shopify calls go to threads meanwhile.
    with ThreadPoolExecutor(max_workers=4) as pool:
        futs = {k: pool.submit(run, k, fn) for k, fn in shopify_jobs.items()}
        for k, fn in (("cart", cart), ("cart_struct", cart_struct), ("order_health", health),
                      ("products", products), ("deeper", deeper)):
            got[k] = run(k, fn)
        for k, f in futs.items():
            got[k] = f.result()

    aov, orders, net = got.get("money") or (None, 0, 0.0)
    aov_s, orders_s, _ = got.get("money_struct") or (aov, orders, net)
    lp = got.get("landing")
    if aov is None and lp:
        rev = sum(p.get("revenue") or 0 for p in lp["pages"])
        o = sum(p.get("orders") or 0 for p in lp["pages"])
        aov = round(rev / o, 2) if o else None
    if aov_s is None:
        aov_s = aov

    store_cvr = store_bounce = store_atc = None
    sessions_total = 0
    if lp:
        store_cvr, sessions_total = _weighted(lp["by_device"], "conversion_rate")
        store_bounce, _ = _weighted(lp["by_device"], "bounce_rate")
        store_atc, _ = _weighted(lp["by_device"], "added_to_cart_rate")
    fun = _sum_funnel(got.get("funnel"))
    if fun and not store_cvr:
        store_cvr, sessions_total = _rate(fun["purchase"], fun["sessions"]), fun["sessions"]

    return {
        **got,
        "days": days,
        "period": period,
        "window_label": window_label,
        "compare_label": compare_label,
        "window_days": window_days,
        "struct_days": struct_days,
        "struct_label": struct_label if period else window_label,
        "aov": aov,
        # Impact maths uses a stable AOV: for "Yesterday" the 30-day one.
        "aov_calc": aov_s if period else aov,
        "orders": orders,
        "store_cvr": store_cvr,
        "store_bounce": store_bounce,
        "store_atc": store_atc,
        "sessions_total": sessions_total,
        "daily_sessions": (sessions_total / window_days) if sessions_total else None,
        "funnel_total": fun,
        "funnel_prev_total": _sum_funnel(got.get("funnel_prev")),
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# rules
# ---------------------------------------------------------------------------

STEP_INFO = {
    "cart": {
        "name": "Visit → Add to cart",
        "area": "Funnel",
        "causes": [
            "Product pages don't answer the buying questions above the fold: price, delivery date, size/dimensions, returns.",
            "Too little social proof next to the Add to cart button (review stars, number of reviews, UGC photos).",
            "Traffic quality: visitors from broad ads land on pages that don't match the ad.",
            "Popular variants (sizes/colours) out of stock, so visitors can't add the one they want.",
        ],
        "steps": [
            "Open the 5 landing pages with the most sessions (Landing Pages page) and check each on a phone: is price, delivery estimate and the Add to cart button visible without scrolling?",
            "Add review stars + review count directly under the product title, and 3-4 customer photos in the gallery.",
            "Add a sticky Add to cart bar on mobile product pages.",
            "Show 'Free shipping over $X' and 'Easy 30-day returns' as icons right under the button.",
            "Check the Products page for leaky products (many views, few buyers) and fix those first.",
        ],
        "metric": "Add-to-cart rate", "metric_key": "added_to_cart_rate", "effort": "Medium",
    },
    "checkout": {
        "name": "Add to cart → Checkout",
        "area": "Funnel",
        "causes": [
            "Shipping cost appears for the first time in the cart (sticker shock).",
            "No express checkout (Shop Pay / Apple Pay / PayPal) buttons in the cart drawer.",
            "Discount code box in the cart sends people off to search for codes.",
            "Cart drawer is cluttered (upsells/popups) and the Checkout button is below the fold on mobile.",
        ],
        "steps": [
            "Show a free-shipping progress bar in the cart: 'You're $X away from free shipping'.",
            "Add express checkout buttons (Shop Pay, Apple Pay, PayPal) to the cart drawer and cart page.",
            "Show estimated delivery date and shipping cost on the product page so the cart holds no surprises.",
            "Make the Checkout button sticky at the bottom of the mobile cart drawer.",
            "Turn on abandoned-cart emails/SMS if not on (1h, 24h, 72h).",
        ],
        "metric": "Cart-to-checkout rate", "metric_key": "conversion_rate", "effort": "Low",
    },
    "purchase": {
        "name": "Checkout → Purchase",
        "area": "Checkout",
        "causes": [
            "Unexpected costs at the shipping step (shipping, tax, duties).",
            "Payment failures for some methods or wallets (see Cart & Checkout page).",
            "Slow or long delivery estimates shown at checkout.",
            "Trust: no security badges, unclear returns policy, forced account creation.",
        ],
        "steps": [
            "Check the Cart & Checkout page for payment methods with a low success rate and fix those first.",
            "Review shipping rates: test a flat or free rate and show the delivery date at the shipping step.",
            "Make sure guest checkout is on and Shop Pay / PayPal / Apple Pay are enabled.",
            "Set up the abandoned checkout email series (1h, 24h with reviews, 72h with a small incentive).",
            "Add a short 'Free returns · Secure payment · Ships in X days' line in the checkout header/footer.",
        ],
        "metric": "Checkout completion rate", "metric_key": "conversion_rate", "effort": "Medium",
    },
}


def _step_rates(f: dict) -> dict:
    return {
        "cart": _rate(f["cart"], f["sessions"]),
        "checkout": _rate(f["checkout"], f["cart"]),
        "purchase": _rate(f["purchase"], f["checkout"]),
    }


def rule_funnel(b: _Builder):
    """Biggest leak in the store funnel, step by step, vs the period before."""
    ctx = b.ctx
    cur, prev, aov = ctx.get("funnel_total"), ctx.get("funnel_prev_total"), ctx["aov_calc"]
    if not cur or not aov or cur["sessions"] < 200:
        return
    r, pr = _step_rates(cur), (_step_rates(prev) if prev and prev["sessions"] >= 200 else None)
    entrants = {"cart": cur["sessions"], "checkout": cur["cart"], "purchase": cur["checkout"]}
    downstream = {  # share of people past this step who go on to buy
        "cart": _rate(cur["purchase"], cur["cart"]),
        "checkout": _rate(cur["purchase"], cur["checkout"]),
        "purchase": 100.0,
    }
    cart_to_buy = _rate(cur["purchase"], cur["cart"])
    candidates = []
    if pr:
        for step in ("cart", "checkout", "purchase"):
            if r[step] is None or pr[step] is None or not downstream[step]:
                continue
            drop = pr[step] - r[step]
            if drop <= 0 or drop / pr[step] < 0.05:   # needs a 5%+ relative drop
                continue
            lost_orders = entrants[step] * drop / 100 * downstream[step] / 100
            candidates.append((lost_orders * aov, step, drop))
    metrics_all = []
    for step in ("cart", "checkout", "purchase"):
        metrics_all.append(_metric(STEP_INFO[step]["name"], _pct(r[step]),
                                   _pct(pr[step]) if pr else None, ctx["compare_label"] if pr else None,
                                   f"{r[step] - pr[step]:+.2f} pts" if pr and r[step] is not None and pr[step] is not None else None,
                                   bool(pr and r[step] is not None and pr[step] is not None and r[step] < pr[step])))
    metrics_all.append(_metric("Cart → purchase", _pct(cart_to_buy), _pct(100 - BAYMARD_CART_ABANDONMENT),
                               "benchmark (Baymard: 70% of carts abandoned)",
                               f"{(cart_to_buy or 0) - (100 - BAYMARD_CART_ABANDONMENT):+.1f} pts",
                               (cart_to_buy or 0) < 100 - BAYMARD_CART_ABANDONMENT))
    if candidates:
        impact, step, drop = max(candidates)
        info = STEP_INFO[step]
        b.add(
            key=f"funnel_leak:{step}", kind="funnel_leak", area=info["area"], action="fix",
            title=f"Biggest funnel leak: '{info['name']}' fell to {_pct(r[step])} from {_pct(pr[step])}",
            segment="Whole store · funnel", page="Conversion Analytics",
            diagnosis=(f"Of {entrants[step]:,} sessions that reached this step, {_pct(r[step])} moved on, "
                       f"down {drop:.2f} pts vs {ctx['compare_label']}. At today's downstream conversion that is "
                       f"~{impact / aov:,.0f} lost orders ({_money(impact)}) in {ctx['window_label']}. "
                       "This is the step losing the most money right now, so fix it before anything else."),
            metrics=metrics_all, causes=info["causes"], steps=info["steps"],
            test=test_plan(f"If we fix the top cause at '{info['name']}', its rate goes from {_pct(r[step])} back towards {_pct(pr[step])}.",
                           info["metric"], r[step], 0.10, entrants[step] / ctx["window_days"], info["metric_key"]),
            impact=impact * CLOSE_GAP,
            formula=f"{entrants[step]:,} sessions at step × {drop:.2f} pts drop × {_pct(downstream[step], 1)} go on to buy × {_money(aov)} AOV × 50%",
            assumption="Assumes you win back half of the drop.",
            window_days=ctx["window_days"], confidence=_conf(entrants[step], 2000, 500), effort=info["effort"],
        )
    elif cart_to_buy is not None and cart_to_buy < 100 - BAYMARD_CART_ABANDONMENT and cur["cart"] >= 100:
        gap = (100 - BAYMARD_CART_ABANDONMENT) - cart_to_buy
        info = STEP_INFO["checkout"]
        impact = cur["cart"] * gap / 100 * aov
        b.add(
            key="funnel_leak:cart_benchmark", kind="funnel_leak", area="Funnel", action="fix",
            title=f"Only {_pct(cart_to_buy, 1)} of carts turn into orders (benchmark ~30%)",
            segment="Whole store · cart", page="Cart & Checkout",
            diagnosis=(f"{cur['cart']:,} sessions added to cart but only {cur['purchase']:,} bought. "
                       f"Industry carts convert ~30% (Baymard's 70% abandonment), so the cart and checkout leak more than average."),
            metrics=metrics_all, causes=info["causes"] + STEP_INFO["purchase"]["causes"][:2],
            steps=info["steps"],
            test=test_plan("A free-shipping progress bar + express checkout buttons in the cart raise cart-to-order rate by 10%.",
                           "Cart-to-order rate", cart_to_buy, 0.10, cur["cart"] / ctx["window_days"]),
            impact=impact * CLOSE_GAP,
            formula=f"{cur['cart']:,} carts × {gap:.1f} pts gap to benchmark × {_money(aov)} AOV × 50%",
            assumption="Assumes half the gap to the industry benchmark is closed.",
            window_days=ctx["window_days"], confidence=_conf(cur["cart"], 1000, 300), effort="Medium",
        )


def rule_mobile(b: _Builder):
    """Mobile vs desktop, step by step: where exactly mobile loses buyers."""
    ctx = b.ctx
    devs, aov = ctx.get("funnel") or {}, ctx["aov_calc"]
    mob, desk = devs.get("Mobile"), devs.get("Desktop")
    if not mob or not desk or not aov or mob["sessions"] < 300 or desk["sessions"] < 150:
        return
    rm, rd = _step_rates(mob), _step_rates(desk)
    entrants = {"cart": mob["sessions"], "checkout": mob["cart"], "purchase": mob["checkout"]}
    downstream = {"cart": _rate(mob["purchase"], mob["cart"]), "checkout": _rate(mob["purchase"], mob["checkout"]), "purchase": 100.0}
    best = None
    for step in ("cart", "checkout", "purchase"):
        if rm[step] is None or rd[step] is None or rd[step] <= rm[step] or not downstream[step]:
            continue
        lost = entrants[step] * (rd[step] - rm[step]) / 100 * downstream[step] / 100 * aov
        if not best or lost > best[0]:
            best = (lost, step)
    if not best:
        return
    lost, step = best
    cvr_m, cvr_d = _rate(mob["purchase"], mob["sessions"]), _rate(desk["purchase"], desk["sessions"])
    share = mob["sessions"] / sum(d["sessions"] for d in devs.values()) * 100
    site = ctx.get("site") or {}
    lcp = ((site.get("devices") or {}).get("mobile") or (site.get("devices") or {}).get("Mobile") or {}).get("lcp") or {}
    metrics = [
        _metric("Share of sessions on mobile", _pct(share, 0)),
        _metric("Conversion rate", _pct(cvr_m), _pct(cvr_d), "desktop", f"{(cvr_m or 0) - (cvr_d or 0):+.2f} pts", True),
    ] + [
        _metric(f"{STEP_INFO[s]['name']}", _pct(rm[s]), _pct(rd[s]), "desktop",
                f"{(rm[s] or 0) - (rd[s] or 0):+.2f} pts", (rm[s] or 0) < (rd[s] or 0))
        for s in ("cart", "checkout", "purchase")
    ]
    causes = []
    if lcp.get("p75"):
        metrics.append(_metric("Mobile page load (LCP p75)", f"{lcp['p75'] / 1000:.1f}s", "2.5s", "Google 'good' limit",
                               None, lcp["p75"] > 2500))
        if lcp["p75"] > 2500:
            causes.append(f"Mobile pages load slowly (LCP {lcp['p75'] / 1000:.1f}s; Google's good limit is 2.5s).")
    steps_by = {
        "cart": [
            "Add a sticky Add to cart bar on mobile product pages.",
            "Move price, review stars and delivery date above the fold on mobile; shrink the image gallery height.",
            "Make variant pickers (size/colour) big tap targets; pre-select the best-selling variant.",
            "Test the top 3 product pages on a real phone over 4G and fix anything that jumps or loads late.",
        ],
        "checkout": [
            "Put Shop Pay / Apple Pay / Google Pay buttons in the mobile cart drawer.",
            "Make the Checkout button sticky at the bottom of the mobile cart drawer; remove upsell carousels that push it down.",
            "Show the shipping cost/free-shipping progress in the drawer so there's no surprise.",
        ],
        "purchase": [
            "Turn on Shop Pay and Apple Pay / Google Pay so mobile buyers don't type card details.",
            "Check mobile payment failures on the Cart & Checkout page.",
            "Enable address autocomplete and keep checkout to one page if your plan allows.",
        ],
    }
    causes += {
        "cart": ["Product info and Add to cart button sit below the fold on phones.",
                 "Variant selectors and image galleries are hard to use with a thumb."],
        "checkout": ["The cart drawer on mobile hides the Checkout button or lacks express pay buttons."],
        "purchase": ["Typing card and address details on a phone is painful without wallets/autofill."],
    }[step]
    b.add(
        key=f"mobile_gap:{step}", kind="mobile_gap", area="Mobile", action="fix",
        title=f"Mobile loses buyers at '{STEP_INFO[step]['name']}': {_pct(rm[step])} vs {_pct(rd[step])} on desktop",
        segment="Device · Mobile", page="Conversion Analytics",
        diagnosis=(f"Mobile is {share:.0f}% of sessions but converts {_pct(cvr_m)} vs {_pct(cvr_d)} on desktop. "
                   f"The widest gap is at '{STEP_INFO[step]['name']}' ({_pct(rm[step])} vs {_pct(rd[step])}), "
                   f"so that is where mobile buyers are lost - fix this step, not the whole site."),
        metrics=metrics, causes=causes, steps=steps_by[step],
        test=test_plan(f"Changing the mobile '{STEP_INFO[step]['name']}' step lifts its rate by 10% on mobile.",
                       f"Mobile {STEP_INFO[step]['metric'].lower()}", rm[step], 0.10, entrants[step] / ctx["window_days"],
                       STEP_INFO[step]["metric_key"]),
        impact=lost * CLOSE_GAP,
        formula=(f"{entrants[step]:,} mobile sessions at step × {(rd[step] - rm[step]):.2f} pts gap to desktop × "
                 f"{_pct(downstream[step], 1)} go on to buy × {_money(aov)} AOV × 50%"),
        assumption="Assumes mobile closes half its gap to desktop at this step (desktop usually stays a bit higher).",
        window_days=ctx["window_days"], confidence=_conf(entrants[step], 3000, 800), effort="Medium",
    )


PAID_SOCIAL = ("facebook", "instagram", "meta", "tiktok", "pinterest", "snapchat")


def _page_lcp(ctx: dict) -> dict[str, float]:
    site = ctx.get("site") or {}
    return {p["path"]: p["lcp"]["p75"] for p in site.get("pages") or [] if (p.get("lcp") or {}).get("p75")}


def rule_landing(b: _Builder):
    ctx = b.ctx
    lp, aov, store_cvr = ctx.get("landing"), ctx["aov_calc"], ctx["store_cvr"]
    if not lp or not aov or not store_cvr:
        return
    s_bounce, s_atc = ctx["store_bounce"], ctx["store_atc"]
    lcp_by_path = _page_lcp(ctx)
    flagged = set()
    fixes = []
    for p in lp["pages"]:
        cvr = p.get("conversion_rate")
        if p["too_few_sessions"] or cvr is None or cvr >= store_cvr * 0.7:
            continue
        fixes.append(p)
    fixes.sort(key=lambda p: -p["sessions"] * (store_cvr - p["conversion_rate"]))
    for p in fixes[:6]:
        cvr, path = p["conversion_rate"], p["path"]
        gap = store_cvr - cvr
        flagged.add(path)
        bounce, atc = p.get("bounce_rate"), p.get("added_to_cart_rate")
        src, src_share = p.get("top_source"), p.get("top_source_share") or 0
        lcp = lcp_by_path.get(path)
        ptype = (p.get("page_type") or "Other")
        is_product = "product" in ptype.lower()
        metrics = [
            _metric("Sessions", f"{p['sessions']:,}"),
            _metric("Conversion rate", _pct(cvr), _pct(store_cvr), "store average", f"{cvr - store_cvr:+.2f} pts", True),
        ]
        if bounce is not None and s_bounce is not None:
            metrics.append(_metric("Bounce rate", _pct(bounce, 1), _pct(s_bounce, 1), "store average",
                                   f"{bounce - s_bounce:+.1f} pts", bounce > s_bounce + 5))
        if atc is not None and s_atc is not None:
            metrics.append(_metric("Add-to-cart rate", _pct(atc, 1), _pct(s_atc, 1), "store average",
                                   f"{atc - s_atc:+.1f} pts", atc < s_atc * 0.8))
        if src:
            metrics.append(_metric("Main traffic source", f"{_label(src)} ({src_share:.0f}%)"))
        if lcp:
            metrics.append(_metric("Mobile load (LCP p75)", f"{lcp / 1000:.1f}s", "2.5s", "Google limit", None, lcp > 2500))
        if p.get("revenue_per_session") is not None:
            metrics.append(_metric("Revenue per session", f"${p['revenue_per_session']:.2f}"))

        causes, steps = [], []
        high_bounce = bounce is not None and s_bounce is not None and bounce >= s_bounce + 8
        low_atc = atc is not None and s_atc is not None and atc < s_atc * 0.7
        if high_bounce:
            pattern = "Visitors leave without seeing a second page"
            if lcp and lcp > 2500:
                causes.append(f"The page is slow on mobile (LCP {lcp / 1000:.1f}s), many leave before it shows.")
                steps.append("Compress/convert the hero image to WebP, preload it, and remove app scripts not needed on this page.")
            if src and any(k in src.lower() for k in PAID_SOCIAL) and src_share >= 40:
                causes.append(f"{src_share:.0f}% of visits come from {src}: the ad's promise probably doesn't match what the page shows first.")
                steps.append(f"Open the {src} ads pointing here and make the first screen repeat the ad's product, price and offer.")
            causes.append("The first screen doesn't show what the visitor came for (product, price, offer).")
            steps.append("Put the main product/offer, price and a clear button in the first screen on mobile.")
        elif low_atc:
            pattern = "Visitors browse but don't add to cart"
            causes.append("The page engages (normal bounce) but doesn't convince: price, photos, reviews or delivery info.")
            if is_product:
                steps += ["Add review stars + count under the title, and customer photos in the gallery.",
                          "Show delivery date and returns policy right under the Add to cart button."]
            else:
                steps += ["Sort the collection by best sellers and show price + review stars on every product card.",
                          "Add quick-add buttons on collection cards and a filter for size/colour."]
        else:
            pattern = "Visitors add to cart but don't buy"
            causes.append("Add-to-cart is fine, so the drop happens in the cart/checkout: shipping cost or delivery time surprise.")
            steps += ["Show shipping cost/free-shipping threshold on this page so the cart has no surprise.",
                      "Check that the products on this page aren't hit by payment failures or stock issues at checkout."]
        steps.append(f"Use Clarity recordings filtered to {path} to watch 10 sessions and note where people stop.")
        b.add(
            key=f"landing_fix:{path}", kind="landing_fix", area="Landing pages", action="fix",
            title=f"Fix {path}: {pattern.lower()} ({_pct(cvr)} vs {_pct(store_cvr)} store)",
            segment=f"{ptype} · {path}", page="Landing Pages", page_path=path,
            diagnosis=(f"{p['sessions']:,} sessions started on this {ptype.lower()} page but it converts {_pct(cvr)}, "
                       f"{(1 - cvr / store_cvr) * 100:.0f}% below the store. Pattern: {pattern.lower()}."),
            metrics=metrics, causes=causes, steps=steps,
            test=test_plan(f"If we fix '{pattern.lower()}' on {path}, conversion rises from {_pct(cvr)} towards {_pct(store_cvr)}.",
                           "Conversion rate (this page)", cvr, 0.20, p["sessions"] / ctx["window_days"]),
            impact=p["sessions"] * gap / 100 * aov * CLOSE_GAP,
            formula=f"{p['sessions']:,} sessions × {gap:.2f} pts gap to store × {_money(aov)} AOV × 50%",
            assumption="Assumes the page closes half its gap to the store average.",
            window_days=ctx["window_days"], confidence=_conf(p["sessions"], 2000, 400), effort="Medium",
        )

    # Bounce jumped and conversion fell vs the period before.
    for p in lp["pages"]:
        bj, c = p.get("bounce_change_pts"), p.get("conversion_change_pts")
        if p["path"] in flagged or bj is None or c is None or bj < lp["bounce_flag_pts"] or c >= 0:
            continue
        b.add(
            key=f"landing_bounce:{p['path']}", kind="landing_bounce", area="Landing pages", action="fix",
            title=f"Something changed on {p['path']}: bounce +{bj:.1f} pts and conversion {c:+.2f} pts",
            segment=f"{p['page_type']} · {p['path']}", page="Landing Pages", page_path=p["path"],
            diagnosis=(f"Bounce went {p['previous_bounce_rate']:.1f}% → {p['bounce_rate']:.1f}% and conversion "
                       f"{p['previous_conversion_rate']:.2f}% → {p['conversion_rate']:.2f}% ({ctx['compare_label']} → now) "
                       f"on {p['sessions']:,} sessions. A sudden change like this usually has one cause you can find."),
            metrics=[
                _metric("Bounce rate", _pct(p["bounce_rate"], 1), _pct(p["previous_bounce_rate"], 1), "before", f"{bj:+.1f} pts", True),
                _metric("Conversion rate", _pct(p["conversion_rate"]), _pct(p["previous_conversion_rate"]), "before", f"{c:+.2f} pts", True),
                _metric("Sessions", f"{p['sessions']:,}", f"{p['previous_sessions']:,}" if p.get("previous_sessions") else None, "before"),
            ],
            causes=["A theme/app/price change on this page (check the Change Log).",
                    "A new ad or email now sends a different audience here.",
                    "A product on the page went out of stock or its price changed."],
            steps=["Check the Change Log and theme publish history for this page's dates.",
                   f"Compare traffic sources to {p['path']} now vs before on the Landing Pages page.",
                   "Revert the change or fix the page; then watch bounce for 3 days."],
            test=None,
            impact=p["sessions"] * (-c) / 100 * aov,
            formula=f"{p['sessions']:,} sessions × {-c:.2f} pts conversion lost × {_money(aov)} AOV",
            window_days=ctx["window_days"], confidence=_conf(p["sessions"], 1500, 300), effort="Low",
        )

    # Pages converting far above the store with modest traffic -> promote.
    ranked = sorted(lp["pages"], key=lambda x: -x["sessions"])
    median_s = ranked[len(ranked) // 2]["sessions"] if ranked else 0
    for p in lp["pages"]:
        cvr = p.get("conversion_rate")
        if p["too_few_sessions"] or cvr is None or cvr < store_cvr * 1.5 or p["sessions"] > max(median_s, lp["min_sessions"]) * 4:
            continue
        b.add(
            key=f"landing_promote:{p['path']}", kind="landing_promote", area="Landing pages", action="promote",
            title=f"Send more traffic to {p['path']}: it converts {_pct(cvr)} ({cvr / store_cvr:.1f}× the store)",
            segment=f"{p['page_type']} · {p['path']}", page="Landing Pages", page_path=p["path"],
            diagnosis=(f"Only {p['sessions']:,} sessions landed here, yet it converts {cvr / store_cvr:.1f}× the store average"
                       + (f" and earns ${p['revenue_per_session']:.2f} per session" if p.get("revenue_per_session") else "") + "."),
            metrics=[_metric("Conversion rate", _pct(cvr), _pct(store_cvr), "store average", f"{cvr - store_cvr:+.2f} pts", False),
                     _metric("Sessions", f"{p['sessions']:,}"),
                     _metric("Revenue", _money(p.get("revenue")), None, None, None)],
            causes=["Strong product-offer fit: the people who find this page are ready to buy."],
            steps=[f"Use {p['path']} as the destination for your best-performing ads instead of the home page.",
                   "Link it from the home page hero or main menu.",
                   "Feature it in the next email campaign.",
                   "Copy its layout (hero, proof, offer) to similar pages that convert worse."],
            test=None,
            impact=p["sessions"] * (cvr - store_cvr) / 100 * aov,
            formula=f"{p['sessions']:,} extra sessions × {cvr - store_cvr:.2f} pts above store × {_money(aov)} AOV",
            assumption="If this page's traffic doubled and it kept converting the same.",
            window_days=ctx["window_days"], confidence=_conf(p["sessions"], 1500, 300), effort="Low",
        )


def rule_sources(b: _Builder):
    ctx = b.ctx
    lp, aov, store_cvr = ctx.get("landing"), ctx["aov_calc"], ctx["store_cvr"]
    if not lp or not aov or not store_cvr:
        return
    total = sum(s["sessions"] for s in lp["by_source"]) or 1
    for s in lp["by_source"]:
        cvr = s.get("conversion_rate")
        if s["too_few_sessions"] or cvr is None:
            continue
        share = s["sessions"] / total * 100
        metrics = [_metric("Sessions", f"{s['sessions']:,} ({share:.0f}% of traffic)"),
                   _metric("Conversion rate", _pct(cvr), _pct(store_cvr), "store average", f"{cvr - store_cvr:+.2f} pts", cvr < store_cvr)]
        if s.get("bounce_rate") is not None and ctx["store_bounce"] is not None:
            metrics.append(_metric("Bounce rate", _pct(s["bounce_rate"], 1), _pct(ctx["store_bounce"], 1), "store average",
                                   f"{s['bounce_rate'] - ctx['store_bounce']:+.1f} pts", s["bounce_rate"] > ctx["store_bounce"] + 5))
        if s.get("added_to_cart_rate") is not None and ctx["store_atc"] is not None:
            metrics.append(_metric("Add-to-cart rate", _pct(s["added_to_cart_rate"], 1), _pct(ctx["store_atc"], 1), "store average"))
        if s.get("conversion_change_pts") is not None:
            metrics.append(_metric("Conversion change", f"{s['conversion_change_pts']:+.2f} pts", None, ctx["compare_label"]))
        top_pages = sorted((p for p in lp["pages"] if p.get("top_source") == s["label"]), key=lambda p: -p["sessions"])[:3]
        pages_txt = ", ".join(p["path"] for p in top_pages)
        raw, label = s["label"], _label(s["label"])
        if cvr < store_cvr * 0.6 and share >= 3:
            gap = store_cvr - cvr
            paid = any(k in label.lower() for k in PAID_SOCIAL)
            b.add(
                key=f"source_test:{raw}", kind="source_test", area="Traffic", action="test",
                title=f"{label} traffic converts only {_pct(cvr)} ({share:.0f}% of visits) - test a matching landing page",
                segment=f"Traffic source · {label}", page="Landing Pages",
                diagnosis=(f"{s['sessions']:,} sessions from {label} convert {_pct(cvr)} vs {_pct(store_cvr)} store. "
                           + (f"They mostly land on {pages_txt}. " if pages_txt else "")
                           + "The traffic is arriving but the page it lands on doesn't continue the story."),
                metrics=metrics,
                causes=(["Ads send people to generic pages (home/collection) instead of the product in the ad.",
                         "Audience is broad / top-of-funnel: they need proof and an offer, not a catalogue."] if paid else
                        ["Visitors from this source arrive with a different intent than the page serves."]),
                steps=([f"Build a dedicated landing page per top {label} ad: same product photo, headline and offer as the ad.",
                        "Add reviews/UGC and a first-order offer (email capture) to that page.",
                        f"Split {label} traffic 50/50 between the current page and the new one."] if paid else
                       [f"Check which pages {label} visitors land on ({pages_txt or 'see Landing Pages'}) and match the page to their intent.",
                        "Add a clear next step on those pages (best sellers, offer, email capture)."]),
                test=test_plan(f"A landing page that matches the {label} ad lifts {label} conversion by 25%.",
                               f"{label} conversion rate", cvr, 0.25, s["sessions"] / ctx["window_days"]),
                impact=s["sessions"] * gap / 100 * aov * CLOSE_GAP,
                formula=f"{s['sessions']:,} sessions × {gap:.2f} pts gap to store × {_money(aov)} AOV × 50%",
                assumption="Assumes the new page closes half the gap to the store average.",
                window_days=ctx["window_days"], confidence=_conf(s["sessions"], 2000, 500), effort="Medium",
            )
        elif cvr > store_cvr * 1.5 and share < 25:
            b.add(
                key=f"source_promote:{raw}", kind="source_promote", area="Traffic", action="promote",
                title=f"Grow {label}: it converts {_pct(cvr)}, {cvr / store_cvr:.1f}× the store, but is only {share:.0f}% of traffic",
                segment=f"Traffic source · {label}", page="Landing Pages",
                diagnosis=f"{label} brings {s['sessions']:,} sessions that convert {cvr / store_cvr:.1f}× better than average. More of this traffic is the cheapest growth available.",
                metrics=metrics,
                causes=["High-intent channel (people who already know the brand or searched for the product)."],
                steps=(["Grow the email/SMS list: add a signup popup with a first-order offer and a footer form.",
                        "Send 1-2 more campaigns a week to engaged subscribers."] if "email" in label.lower() else
                       ["Shift budget towards this channel and its best landing pages.",
                        "Check the Landing Pages page for which pages this source lands on and create more like them."]),
                test=None,
                impact=s["sessions"] * 0.2 * cvr / 100 * aov,
                formula=f"{s['sessions']:,} sessions × 20% more traffic × {_pct(cvr)} conversion × {_money(aov)} AOV",
                assumption="If this channel grew by 20% and kept converting the same.",
                window_days=ctx["window_days"], confidence=_conf(s["sessions"], 1500, 300), effort="Medium",
            )


def rule_cvr_drop(b: _Builder):
    """Store conversion fell: split the drop by device to say where it came from."""
    ctx = b.ctx
    lp, aov, store_cvr = ctx.get("landing"), ctx["aov_calc"], ctx["store_cvr"]
    if not lp or not aov or not store_cvr:
        return
    prev_cvr, prev_s = _weighted([{"sessions": d.get("previous_sessions") or 0, "conversion_rate": d.get("previous_conversion_rate")}
                                  for d in lp["by_device"]], "conversion_rate")
    if not prev_cvr or prev_s < lp["min_sessions"] or store_cvr >= prev_cvr * 0.9:
        return
    gap = prev_cvr - store_cvr
    contrib = []
    for d in lp["by_device"] + lp["by_source"]:
        if d.get("previous_conversion_rate") is None or d.get("conversion_rate") is None or d["too_few_sessions"]:
            continue
        loss = d["sessions"] * (d["previous_conversion_rate"] - d["conversion_rate"]) / 100
        if loss > 0:
            contrib.append((loss, d))
    contrib.sort(key=lambda x: -x[0])
    metrics = [_metric("Store conversion", _pct(store_cvr), _pct(prev_cvr), ctx["compare_label"], f"{store_cvr - prev_cvr:+.2f} pts", True),
               _metric("Sessions", f"{ctx['sessions_total']:,}", f"{prev_s:,}", ctx["compare_label"])]
    for loss, d in contrib[:3]:
        metrics.append(_metric(f"{_label(d['label'])} conversion", _pct(d["conversion_rate"]), _pct(d["previous_conversion_rate"]),
                               "before", f"≈{loss:,.0f} orders lost", True))
    who = ", ".join(_label(d["label"]) for _, d in contrib[:2]) or "several segments"
    b.add(
        key="cvr_drop:store", kind="cvr_drop", area="Funnel", action="fix",
        title=f"Store conversion fell to {_pct(store_cvr)} from {_pct(prev_cvr)} - mostly from {who}",
        segment="Whole store", page="Conversion Analytics",
        diagnosis=(f"Conversion dropped {gap:.2f} pts vs {ctx['compare_label']}. Splitting the drop by device and source, "
                   f"most of the lost orders come from {who}. Start there, not with a site-wide change."),
        metrics=metrics,
        causes=["A site change in this period (theme, app, price, shipping rates) - check the Change Log.",
                "Traffic mix: a new campaign brought lower-intent visitors.",
                "Stock-outs on best sellers."],
        steps=[f"Open Conversion Analytics and filter to {who}; compare the funnel steps with the period before.",
               "Check the Change Log for changes in this window and undo anything suspicious.",
               "Check that the top 10 best sellers are in stock in all popular variants."],
        test=None,
        impact=ctx["sessions_total"] * gap / 100 * aov * CLOSE_GAP,
        formula=f"{ctx['sessions_total']:,} sessions × {gap:.2f} pts drop × {_money(aov)} AOV × 50%",
        assumption="Assumes half the drop is recovered.",
        window_days=ctx["window_days"], confidence=_conf(ctx["sessions_total"], 5000, 1000), effort="Medium",
    )


def rule_payments(b: _Builder):
    ctx = b.ctx
    cart, aov = ctx.get("cart"), ctx["aov_calc"]
    pay = cart.get("payments") if cart else None
    if not pay or not pay.get("authorization_rate") or not aov:
        return
    overall = pay["authorization_rate"]
    for m in pay["methods"] + pay.get("wallets", []):
        rate = m.get("authorization_rate")
        if rate is None or m["attempts"] < (10 if ctx["period"] else 30) or rate >= overall - 3:
            continue
        lost = m["attempts"] * (overall - rate) / 100
        b.add(
            key=f"payment_method:{m['label']}", kind="payment_method", area="Checkout", action="fix",
            title=f"{m['label']} payments succeed only {rate}% vs {overall}% for the store - ~{lost:,.0f} lost orders",
            segment=f"Payment · {m['label']}", page="Cart & Checkout",
            diagnosis=(f"{m['attempts']:,} buyers tried to pay with {m['label']} and {m['failed_attempts']:,} attempts failed. "
                       "These people already decided to buy - this is the cheapest revenue to win back."),
            metrics=[_metric("Success rate", f"{rate}%", f"{overall}%", "all methods", f"{rate - overall:+.1f} pts", True),
                     _metric("Purchase attempts", f"{m['attempts']:,}"),
                     _metric("Failed attempts", f"{m['failed_attempts']:,}")],
            causes=["Gateway/wallet set-up issue (e.g. 3-D Secure, wrong domain verification for Apple Pay).",
                    "Fraud filter too strict for this method.",
                    "Card type or currency not supported."],
            steps=[f"Open Shopify → Settings → Payments and check {m['label']}'s error codes for failed transactions.",
                   "Ask the payment provider for the decline reasons breakdown for this period.",
                   "If failures are fraud blocks, loosen the rule for low-risk orders.",
                   "Make sure an alternative (Shop Pay / PayPal) is shown next to it."],
            test=None,
            impact=lost * aov * CLOSE_GAP,
            formula=f"{m['attempts']:,} attempts × {overall - rate:.1f} pts success gap × {_money(aov)} AOV × 50%",
            assumption="Assumes half the failed buyers would complete once fixed.",
            window_days=ctx["window_days"], confidence=_conf(m["attempts"], 300, 80), effort="Low",
        )


def rule_products(b: _Builder):
    ctx = b.ctx
    prod = ctx.get("products")
    if not prod:
        return
    wd = min(max(ctx["struct_days"], 7), 60)
    wl = prod.get("window_label")
    items = prod.get("products") or []
    if prod.get("views_available"):
        stars_by_cat: dict[str, dict] = {}
        for p in items:
            if p.get("group") == "star" and (p.get("view_to_purchase_rate") or 0) > (stars_by_cat.get(p["category"], {}).get("view_to_purchase_rate") or 0):
                stars_by_cat[p["category"]] = p
        for p in (prod.get("fix_first") or [])[:5]:
            star = stars_by_cat.get(p["category"])
            gap = (p.get("category_rate") or 0) - (p.get("view_to_purchase_rate") or 0)
            metrics = [_metric("Product page views", f"{p.get('views', 0):,}"),
                       _metric("View → purchase", _pct(p.get("view_to_purchase_rate")), _pct(p.get("category_rate")),
                               f"{p['category']} average", f"{-gap:+.2f} pts", True),
                       _metric("Price", _money(p.get("price")) if p.get("price") else "—"),
                       _metric("Net sales", _money(p.get("revenue")))]
            if star:
                metrics.append(_metric(f"Best in {p['category']}", f"{star['name'][:40]}", _pct(star.get("view_to_purchase_rate")), "view → purchase"))
            cinfo = _catalog_by_title(ctx).get(p["name"].strip().lower())
            if cinfo:
                metrics += _content_metrics(cinfo)
            steps = ["Compare this page with the best seller in its category side by side: photos, title, price, reviews, description length.",
                     "Add/refresh photos: lifestyle shot first, then close-ups and a size/scale photo.",
                     "Show review stars and 3+ reviews; ask recent buyers for photo reviews.",
                     "Check every variant is in stock and the price is in line with similar products."]
            if star:
                steps.insert(0, f"Copy what works on '{star['name']}' ({_pct(star.get('view_to_purchase_rate'))} view-to-purchase) to this page.")
            b.add(
                key=f"product_leak:{p['name']}", kind="product_leak", area="Products", action="fix",
                title=f"Fix product page '{p['name']}': {p.get('views', 0):,} views but only {_pct(p.get('view_to_purchase_rate'))} buy",
                segment=f"Product · {p.get('category') or ''}".strip(" ·"), page="Product Analytics",
                diagnosis=(f"This product gets a lot of attention ({p.get('views', 0):,} views) but converts {gap:.2f} pts below the "
                           f"{p['category']} average. Every visitor here is already interested - the page is losing them."),
                metrics=metrics,
                causes=["Price looks high compared with similar products in the same collection.",
                        "Photos/description don't show quality or size well enough.",
                        "Few or no reviews; or a popular variant is out of stock."],
                steps=steps,
                test=test_plan(f"New photos + reviews on '{p['name']}' lift view-to-purchase by 20%.",
                               "View → purchase rate", p.get("view_to_purchase_rate"), 0.20, (p.get("views") or 0) / max(prod.get("views_days") or wd, 1)),
                impact=(p.get("revenue_left_on_table") or 0) * CLOSE_GAP,
                formula=f"{p.get('views', 0):,} views × {gap:.2f} pts gap to category × product price × 50%"
                        + (f" ({prod.get('views_window_label')})" if prod.get("views_window_label") else ""),
                assumption="Assumes half the gap to the category average is closed.",
                window_days=max(prod.get("views_days") or wd, 1), window_label=prod.get("views_window_label") or wl,
                confidence=_conf(p.get("views") or 0, 1500, 300), effort="Medium",
            )
        gems = sorted((p for p in items if p.get("group") == "hidden_gem" and (p.get("views") or 0) >= 30 and p.get("price")),
                      key=lambda p: -(p.get("adjusted_rate") or 0) * (p.get("price") or 0))[:3]
        for p in gems:
            rate = p.get("view_to_purchase_rate") or 0
            vdays = max(prod.get("views_days") or wd, 1)
            b.add(
                key=f"product_gem:{p['name']}", kind="product_gem", area="Products", action="promote",
                title=f"Promote hidden gem '{p['name']}': converts {_pct(rate)} of viewers vs {_pct(p.get('category_rate'))} category",
                segment=f"Product · {p['category']}", page="Product Analytics",
                diagnosis=f"Few people see this product ({p.get('views', 0):,} views) but those who do buy it more than similar products. More visibility = more sales without fixing anything.",
                metrics=[_metric("Views", f"{p.get('views', 0):,}"),
                         _metric("View → purchase", _pct(rate), _pct(p.get("category_rate")), f"{p['category']} average",
                                 f"{rate - (p.get('category_rate') or 0):+.2f} pts", False),
                         _metric("Price", _money(p.get("price")))],
                causes=["Good product-market fit but buried in collections / not in ads."],
                steps=["Move it to the first row of its collection and onto the home page.",
                       "Add it to 'You may also like' / cart upsell on related products.",
                       "Test it as the hero product in one ad set and one email."],
                test=None,
                impact=(p.get("views") or 0) * rate / 100 * (p.get("price") or 0),
                formula=f"{p.get('views', 0):,} more views × {_pct(rate)} buy × {_money(p.get('price'))} price",
                assumption="If its views doubled and it kept converting the same.",
                window_days=vdays, window_label=prod.get("views_window_label") or wl,
                confidence=_conf(p.get("views") or 0, 800, 150), effort="Low",
            )

    # Products whose sales dropped sharply vs the period before.
    for m in (prod.get("movers") or {}).get("down", [])[:3]:
        if m["prior_revenue"] < 300 or (m.get("change_pct") is not None and m["change_pct"] > -30):
            continue
        b.add(
            key=f"product_drop:{m['name']}", kind="product_drop", area="Products", action="fix",
            title=f"Sales of '{m['name']}' fell {_money(-m['change'])} ({m['change_pct']:+.0f}%) - find out why",
            segment=f"Product · {m['category']}", page="Product Analytics",
            diagnosis=(f"{_money(m['prior_revenue'])} → {_money(m['revenue'])} ({prod.get('prior_window_label')} → {wl}); "
                       f"units {m['prior_quantity']} → {m['quantity']}. A big drop on a known seller usually has a single cause."),
            metrics=[_metric("Net sales", _money(m["revenue"]), _money(m["prior_revenue"]), "period before", f"{m['change_pct']:+.0f}%", True),
                     _metric("Units", str(m["quantity"]), str(m["prior_quantity"]), "period before")],
            causes=["Out of stock (fully or in popular variants).", "Price or compare-at price changed.",
                    "An ad or email that drove it was paused.", "Seasonality - check last year."],
            steps=["Check inventory for every variant.", "Check the Change Log and price history.",
                   "Check if the ad/email that featured it is still running.",
                   "If it's seasonal, swap in the next seasonal best seller on the same placements."],
            test=None,
            impact=-m["change"] * CLOSE_GAP,
            formula=f"{_money(-m['change'])} lost sales × 50% recovered",
            assumption="Assumes half the lost sales come back once the cause is fixed.",
            window_days=min(max(ctx["struct_days"], 7), 60), window_label=wl,
            confidence="Medium" if m["prior_revenue"] >= 1000 else "Low", effort="Low",
        )

    # Refunds per product.
    ref = prod.get("refunds")
    if ref and ref.get("store_refund_rate"):
        sr = ref["store_refund_rate"]
        for r in ref.get("by_amount", [])[:5]:
            if r["refund_rate"] < max(sr * 2, 8) or r["refunded"] < 150:
                continue
            excess = r["refunded"] - r["gross_sales"] * sr / 100
            b.add(
                key=f"product_refund:{r['name']}", kind="product_refund", area="Refunds", action="fix",
                title=f"'{r['name']}' is refunded {r['refund_rate']}% of sales vs {sr}% store - fix the listing",
                segment=f"Product · {r['category']}", page="Product Analytics",
                diagnosis=f"{_money(r['refunded'])} refunded on {_money(r['gross_sales'])} gross sales. A refund rate this far above the store means the page sets the wrong expectation or there's a quality issue.",
                metrics=[_metric("Refund rate", f"{r['refund_rate']}%", f"{sr}%", "store", f"{r['refund_rate'] - sr:+.1f} pts", True),
                         _metric("Refunded", _money(r["refunded"]))],
                causes=["Size/dimensions or colour not clear in photos/description.", "Quality or damage in shipping."],
                steps=["Read the refund/return reasons for this product in Shopify orders.",
                       "Add exact dimensions, a size/scale photo and true-colour photos.",
                       "If damage: change packaging; if quality: talk to the supplier."],
                test=None,
                impact=excess * CLOSE_GAP,
                formula=f"{_money(r['refunded'])} refunded − {sr}% store norm × {_money(r['gross_sales'])} gross, × 50%",
                assumption="Assumes half the excess refunds are avoided.",
                window_days=min(max(ctx["struct_days"], 7), 60), window_label=wl,
                confidence="Medium" if r["gross_sales"] >= 1000 else "Low", effort="Medium",
            )


def rule_order_value(b: _Builder):
    ctx = b.ctx
    cart = ctx.get("cart_struct") or ctx.get("cart")
    deeper = ctx.get("deeper") or {}
    aov = ctx["aov_calc"]
    wd, wl = ctx["struct_days"], ctx["struct_label"]
    if not aov:
        return
    prices = {p["name"]: p.get("price") for p in (ctx.get("products") or {}).get("products") or [] if p.get("price")}

    hist = (cart or {}).get("order_values") or {}
    thr = hist.get("threshold")
    if thr and hist.get("near_threshold_orders") and (hist.get("near_threshold_share") or 0) >= 8:
        near, share, lo = hist["near_threshold_orders"], hist["near_threshold_share"], hist["near_threshold_from"]
        avg_gap = (thr - lo) / 2
        add_ons = sorted(((n, pr) for n, pr in prices.items() if pr and avg_gap * 0.5 <= pr <= (thr - lo) * 1.2),
                         key=lambda x: x[1])[:4]
        b.add(
            key="aov_threshold", kind="aov_threshold", area="Order value", action="test",
            title=f"{share}% of orders stop just below free shipping (${lo:,.0f}-${thr:,.0f}) - nudge them over",
            segment="Orders · free-shipping threshold", page="Cart & Checkout",
            diagnosis=(f"{near:,} orders were within 20% of the ${thr:,.0f} free-shipping line but didn't reach it. "
                       "These buyers are close - a progress bar and a cheap add-on usually gets a third of them over."),
            metrics=[_metric("Orders just below threshold", f"{near:,} ({share}%)"),
                     _metric("Free-shipping threshold", f"${thr:,.0f}"),
                     _metric("Median order value", _money(hist.get("median"))),
                     _metric("Orders at/above threshold", f"{hist.get('at_or_above_threshold_share')}%")],
            causes=["Buyers don't see how close they are to free shipping.", "No easy, cheap add-on to bridge the gap."],
            steps=["Add a 'You're $X away from free shipping' progress bar in the cart drawer.",
                   ("Offer these as one-click add-ons in the cart: " + ", ".join(f"{n} ({_money(pr)})" for n, pr in add_ons))
                   if add_ons else f"Add 3-4 one-click add-ons priced ${avg_gap * 0.5:,.0f}-${thr - lo:,.0f} in the cart.",
                   "Show the threshold on product pages too ('Free shipping over $X')."],
            test=test_plan("A free-shipping progress bar + add-ons in the cart lifts AOV by 5%.", "Average order value", None, 0.05,
                           None, "aov"),
            impact=near * 0.33 * avg_gap,
            formula=f"{near:,} near-threshold orders × 33% move over × ${avg_gap:,.0f} average extra spend",
            assumption="Assumes a third of near-threshold buyers add enough to qualify (typical for progress bars).",
            window_days=wd, window_label=wl, confidence=_conf(hist.get("orders") or 0, 1000, 200), effort="Low",
        )

    items = (cart or {}).get("items_per_order") or {}
    pairs = (deeper.get("bought_together") or {}).get("rows") or []
    good_pairs = [p for p in pairs if (p.get("lift") or 0) >= 2 and p["orders_together"] >= 5][:3]
    for p in good_pairs:
        price_b = prices.get(p["b"]) or (aov / max(items.get("average_items") or 1, 1))
        a_orders, attach = p["a_orders"], p.get("pct_of_a") or 0
        extra = a_orders * min(attach, 10) / 100
        b.add(
            key=f"bundle:{p['a']}|{p['b']}", kind="bundle", area="Order value", action="test",
            title=f"Bundle '{p['a']}' + '{p['b']}': bought together {p['lift']}× more than chance",
            segment="Orders · bought together", page="Deeper Analyses",
            diagnosis=(f"{p['orders_together']} orders had both. {attach}% of '{p['a']}' buyers also took '{p['b']}' "
                       f"without any prompt. Offering it on the page should raise that attach rate."),
            metrics=[_metric("Orders with both", str(p["orders_together"])),
                     _metric(f"'{p['a'][:30]}' buyers who add the other", f"{attach}%"),
                     _metric("Lift vs chance", f"{p['lift']}×"),
                     _metric(f"Price of '{p['b'][:30]}'", _money(price_b))],
            causes=["Customers naturally buy these together (same room / set)."],
            steps=[f"Add a 'Frequently bought together' block on '{p['a']}' with '{p['b']}' pre-ticked.",
                   "Create a bundle product at 10% off both.",
                   f"Show '{p['b']}' as the first upsell in the cart when '{p['a']}' is added."],
            test=test_plan(f"An FBT block on '{p['a']}' raises the attach rate of '{p['b']}' from {attach}% by 30%.",
                           "Attach rate", attach, 0.30, None, "aov"),
            impact=extra * price_b,
            formula=f"{a_orders:,} '{p['a'][:25]}' orders × +{min(attach, 10):.0f} pts attach × {_money(price_b)} price",
            assumption="Assumes the attach rate grows by up to 10 points (or doubles, if lower).",
            window_days=wd, window_label=wl, confidence=_conf(a_orders, 200, 50), effort="Low",
        )

    if items.get("single_item_share") and items["single_item_share"] >= 65 and items.get("orders", 0) >= 50:
        item_price = aov / max(items.get("average_items") or 1, 1)
        orders_n = items["orders"]
        b.add(
            key="cross_sell", kind="cross_sell", area="Order value", action="test",
            title=f"{items['single_item_share']}% of orders have just 1 item - add cross-sells",
            segment="Orders · items per order", page="Cart & Checkout",
            diagnosis=(f"Average {items.get('average_items')} items per order. Most buyers take one piece and leave; "
                       "each 5-point move to 2+ item orders adds roughly one item's value per order moved."),
            metrics=[_metric("Single-item orders", f"{items['single_item_share']}%"),
                     _metric("Average items per order", str(items.get("average_items"))),
                     _metric("Average item value", _money(item_price))],
            causes=["No 'complete the set' or 'pairs well with' offers on product pages and in cart.",
                    "No multi-buy incentive (e.g. 2 for 10% off)."],
            steps=["Add 'Complete the look' with 2-3 matching items on every product page.",
                   "Add a cart upsell with the top bought-together items (Deeper Analyses page).",
                   "Test a 'Buy 2, save 10%' offer on the top collections."],
            test=test_plan("Cart and product-page cross-sells cut single-item orders by 5 points.", "Items per order",
                           items["single_item_share"], 0.08, None, "aov"),
            impact=orders_n * 0.05 * item_price,
            formula=f"{orders_n:,} orders × 5% become 2-item orders × {_money(item_price)} item value",
            assumption="Assumes 5% of single-item orders add one more item.",
            window_days=wd, window_label=wl, confidence=_conf(orders_n, 1000, 200), effort="Low",
        )

    disc = deeper.get("discounts")
    if disc and disc.get("total_orders", 0) >= 50:
        w, wo = disc["with_code"], disc["without_code"]
        if (w.get("share_of_orders") or 0) >= 30 and (w.get("discount_pct") or 0) >= 12:
            top = disc["codes"][:3]
            b.add(
                key="discount_leak", kind="discount_leak", area="Order value", action="test",
                title=f"{w['share_of_orders']}% of orders use a code ({w['discount_pct']}% off on average) - protect margin",
                segment="Orders · discount codes", page="Deeper Analyses",
                diagnosis=(f"{_money(w['discount_given'])} given away on {w['orders']:,} orders. Code orders AOV {_money(w['aov'])} vs "
                           f"{_money(wo['aov'])} without. Top codes: " + ", ".join(f"{c['code']} ({c['orders']})" for c in top) + "."),
                metrics=[_metric("Orders with a code", f"{w['share_of_orders']}%"),
                         _metric("Average discount", f"{w['discount_pct']}%"),
                         _metric("AOV with code", _money(w["aov"]), _money(wo["aov"]), "without code"),
                         _metric("Discount given", _money(w["discount_given"]))],
                causes=["Codes leaked to coupon sites/browser extensions.", "Sitewide code used by people who would have bought anyway."],
                steps=[f"Check where {top[0]['code'] if top else 'the top code'} is shared (search it on Google/coupon sites); expire leaked codes.",
                       "Replace a flat sitewide % with a minimum-spend code (e.g. 15% off over the current AOV).",
                       "Use unique single-use codes for email/SMS welcome offers."],
                test=test_plan("A minimum-spend requirement on the main code keeps conversion and lifts AOV 8%.", "Average order value",
                               None, 0.08, None, "aov"),
                impact=w["discount_given"] * 0.2,
                formula=f"{_money(w['discount_given'])} discounts × 20% saved",
                assumption="Assumes a fifth of the discount spend is saved with minimum-spend and unique codes.",
                window_days=wd, window_label=wl, confidence=_conf(w["orders"], 500, 100), effort="Low",
            )


def rule_retention(b: _Builder):
    ctx = b.ctx
    deeper = ctx.get("deeper") or {}
    nvr, rep = deeper.get("new_vs_returning"), deeper.get("repeat_purchase")
    wd, wl = ctx["struct_days"], ctx["struct_label"]
    if nvr and nvr.get("orders_with_journey", 0) >= 50:
        new, ret = nvr["new"], nvr["returning"]
        ret_share = ret.get("share_of_orders") or 0
        if ret_share < 30:
            ret_aov = ret.get("aov") or ctx["aov_calc"] or 0
            rep_rate = (rep or {}).get("repeat_rate")
            best = [r for r in (rep or {}).get("rows", [])[:3]]
            metrics = [_metric("Returning customers' share of orders", f"{ret_share}%", "25-40%", "typical for home goods", None, True),
                       _metric("AOV new / returning", f"{_money(new.get('aov'))} / {_money(ret.get('aov'))}")]
            if rep_rate is not None:
                metrics.append(_metric("First-time buyers who ordered again", f"{rep_rate}%"))
            fo = nvr.get("first_order") or {}
            if fo.get("median_visits"):
                metrics.append(_metric("Visits before first order (median)", str(fo["median_visits"])))
            steps = ["Set up a post-purchase email flow: thank you → care tips (day 3) → review ask (day 10) → 'complete the set' (day 21) → winback (day 60).",
                     "Add a returning-customer offer (e.g. free shipping on 2nd order) in the order confirmation email.",
                     "Build a 'bought once, 60+ days ago' segment and send a new-arrivals campaign."]
            if best:
                steps.append("Lead acquisition ads with the products whose first buyers come back most: "
                             + ", ".join(f"{r['product']} ({r['repeat_rate']}%)" for r in best) + ".")
            b.add(
                key="retention", kind="retention", area="Retention", action="fix",
                title=f"Only {ret_share}% of orders come from returning customers - build the repeat-purchase engine",
                segment="Customers · new vs returning", page="Deeper Analyses",
                diagnosis=(f"{new['orders']:,} orders from new customers vs {ret['orders']:,} from returning ones. "
                           "Repeat buyers cost nothing to acquire, so even a small lift here goes straight to profit."),
                metrics=metrics,
                causes=["No automated post-purchase / winback flows.", "No reason to come back (new arrivals, loyalty, offer)."],
                steps=steps,
                test=None,
                impact=new["orders"] * 0.05 * ret_aov,
                formula=f"{new['orders']:,} new customers × 5% more come back × {_money(ret_aov)} returning AOV",
                assumption="Assumes flows bring back 5% more first-time buyers (a typical result for post-purchase flows).",
                window_days=wd, window_label=wl, confidence=_conf(nvr["orders_with_journey"], 1000, 200), effort="Medium",
            )
        fo = nvr.get("first_order") or {}
        multi = next((h for h in fo.get("visits", []) if h["label"] == "1 visit"), None)
        if multi is not None and fo.get("with_visits", 0) >= 50 and multi["share"] < 50:
            later = 100 - multi["share"]
            b.add(
                key="capture_intent", kind="capture_intent", area="Retention", action="test",
                title=f"{later:.0f}% of first-time buyers needed 2+ visits - capture emails on the first visit",
                segment="Customers · journey to first order", page="Deeper Analyses",
                diagnosis=(f"Median {fo.get('median_visits')} visits and {fo.get('median_days')} days before a first order. "
                           "Most new buyers leave and come back, so every first visit without an email or retargeting is a lost lead."),
                metrics=[_metric("First orders after 2+ visits", f"{later:.0f}%"),
                         _metric("Median days to first order", str(fo.get("median_days")))],
                causes=["No email/SMS capture offer for first-time visitors.", "No browse-abandonment flow."],
                steps=["Add an email/SMS popup with a first-order offer (show after 10s or 50% scroll; not instantly on mobile).",
                       "Set up browse-abandonment and cart-abandonment flows.",
                       "Retarget product-page viewers for the median days-to-order window."],
                test=test_plan("A welcome-offer popup captures 4%+ of new visitors without hurting conversion.", "Email signup rate",
                               2.0, 0.5, ctx.get("daily_sessions"), "conversion_rate"),
                impact=None, formula="Not estimated: depends on signup rate and email performance.",
                window_days=wd, window_label=wl, confidence=_conf(fo.get("with_visits", 0), 500, 100), effort="Low",
            )


def rule_speed(b: _Builder):
    ctx = b.ctx
    site, aov = ctx.get("site") or {}, ctx["aov_calc"]
    if not site.get("cwv_available"):
        return
    devs = site.get("devices") or {}
    mob = devs.get("mobile") or devs.get("Mobile")
    if not mob:
        return
    lcp, inp = mob.get("lcp") or {}, mob.get("inp") or {}
    slow_lcp = lcp.get("p75") and lcp["p75"] > 2500
    slow_inp = inp.get("p75") and inp["p75"] > 200
    if not (slow_lcp or slow_inp):
        return
    funnel = (ctx.get("funnel") or {}).get("Mobile")
    pages = sorted((p for p in site.get("pages") or [] if (p.get("lcp") or {}).get("p75", 0) > 2500),
                   key=lambda p: -p["page_loads"])[:5]
    ptypes = sorted((t for t in site.get("page_types") or [] if (t.get("lcp") or {}).get("p75", 0) > 2500),
                    key=lambda t: -t["page_loads"])[:3]
    metrics = []
    if lcp.get("p75"):
        metrics.append(_metric("Mobile LCP (p75)", f"{lcp['p75'] / 1000:.1f}s", "2.5s", "Google 'good'",
                               f"{(lcp['p75'] - 2500) / 1000:+.1f}s", slow_lcp))
        if lcp.get("poor_share") is not None:
            metrics.append(_metric("Mobile loads rated poor", f"{lcp['poor_share']}%"))
    if inp.get("p75"):
        metrics.append(_metric("Mobile INP (p75)", f"{inp['p75']:.0f} ms", "200 ms", "Google 'good'", None, slow_inp))
    for t in ptypes:
        metrics.append(_metric(f"{t['label']} pages LCP", f"{t['lcp']['p75'] / 1000:.1f}s", None, f"{t['page_loads']:,} loads", None, True))
    steps = []
    if pages:
        steps.append("Start with these slow, busy pages: " + ", ".join(f"{p['path']} ({p['lcp']['p75'] / 1000:.1f}s)" for p in pages) + ".")
    if slow_lcp:
        steps += ["Serve the hero/first product image as WebP at the right size and preload it; don't lazy-load the first image.",
                  "Remove or delay apps that inject scripts on every page (reviews, popups, chat) - check Shopify's theme speed report.",
                  "Limit web fonts to 2 weights and use font-display: swap."]
    if slow_inp:
        steps.append("Slow taps (INP): reduce third-party JavaScript on product pages; defer chat widgets until user interaction.")
    impact = None
    formula = "Not estimated."
    assumption = None
    if funnel and aov and funnel["sessions"]:
        impact = funnel["purchase"] * 0.05 * aov
        formula = f"{funnel['purchase']:,} mobile orders × 5% lift × {_money(aov)} AOV"
        assumption = "Assumes a 5% relative lift in mobile conversion from passing Core Web Vitals (a conservative figure)."
    b.add(
        key="speed:mobile", kind="speed", area="Speed", action="fix",
        title=(f"Mobile pages load in {lcp['p75'] / 1000:.1f}s (Google's limit 2.5s) - speed up the busiest pages" if slow_lcp
               else f"Mobile taps respond in {inp['p75']:.0f} ms (limit 200 ms) - cut heavy scripts"),
        segment="Device · Mobile · page speed", page="Site Health",
        diagnosis=(f"Real visitors' page loads (Shopify web performance, {site.get('speed_window_label') or ctx['window_label']}): "
                   "the slowest quarter of mobile visits wait this long before the main content shows. "
                   "Slow pages raise bounce first, then lower add-to-cart."),
        metrics=metrics,
        causes=["Large, unoptimised hero/product images.", "Too many app scripts loading on every page.", "Heavy theme sections (videos, sliders) above the fold."],
        steps=steps,
        test=None,
        impact=impact, formula=formula, assumption=assumption,
        window_days=ctx["window_days"], confidence="Medium" if (mob.get("page_loads") or 0) >= 2000 else "Low", effort="Medium",
    )


def rule_search(b: _Builder):
    ctx = b.ctx
    s, aov = (ctx.get("site") or {}).get("search"), ctx["aov_calc"]
    if not s or not aov:
        return
    zero = s.get("zero_result_terms") or []
    scvr, ncvr = s.get("searcher_conversion_rate"), s.get("non_searcher_conversion_rate")
    if s.get("zero_result_searches") and (s.get("zero_result_share") or 0) >= 5 and zero:
        top = zero[:8]
        impact = s["zero_result_searches"] * (scvr or 0) / 100 * aov * 0.5 if scvr else None
        b.add(
            key="search_zero", kind="search_zero", area="Search", action="fix",
            title=f"{s['zero_result_share']}% of searches find nothing - fix '{top[0]['term']}' and {len(top) - 1} more terms",
            segment="Site search · zero results", page="Site Health",
            diagnosis=(f"{s['zero_result_searches']:,} searches returned no products. People who search are telling you exactly "
                       f"what they want{f' and convert {_pct(scvr)}' if scvr else ''} - a blank results page throws that away."),
            metrics=[_metric("Searches with no results", f"{s['zero_result_searches']:,} ({s['zero_result_share']}%)"),
                     _metric("Searcher conversion", _pct(scvr), _pct(ncvr), "non-searchers")]
            + [_metric(f"“{t['term']}”", f"{t['searches']} searches", None, None, None, True) for t in top[:5]],
            causes=["Customers use different words than product titles (synonyms, plurals, typos).",
                    "Products they want aren't stocked (demand signal)."],
            steps=["In Shopify Search & Discovery add synonyms for these terms: " + ", ".join(f"'{t['term']}'" for t in top) + ".",
                   "Add product tags so these words match existing products.",
                   "For terms with no matching product, set a redirect to the closest collection and pass the list to buying.",
                   "Show best sellers on the no-results page instead of an empty page."],
            test=None, impact=impact,
            formula=f"{s['zero_result_searches']:,} failed searches × {_pct(scvr)} searcher conversion × {_money(aov)} AOV × 50%" if impact else "Not estimated.",
            assumption="Assumes half of these searches would convert like other searches once they return products.",
            window_days=ctx["window_days"], window_label=s and (ctx.get("site") or {}).get("search_window_label"),
            confidence=_conf(s["zero_result_searches"], 500, 100), effort="Low",
        )
    low_click = [t for t in s.get("top_terms") or [] if t.get("click_rate") is not None and t["click_rate"] < 35 and t["searches"] >= 20][:5]
    if low_click:
        b.add(
            key="search_relevance", kind="search_relevance", area="Search", action="fix",
            title=f"Popular searches with poor results: '{low_click[0]['term']}' gets only {low_click[0]['click_rate']}% clicks",
            segment="Site search · relevance", page="Site Health",
            diagnosis="These terms return products, but few searchers click any of them - the results don't match what they meant.",
            metrics=[_metric(f"“{t['term']}”", f"{t['searches']} searches", f"{t['click_rate']}%", "click rate", None, True) for t in low_click],
            causes=["Irrelevant products ranked first.", "Missing product type/colour words in titles and tags."],
            steps=["Search each term yourself on mobile and pin the right products to the top (Search & Discovery → boosts).",
                   "Add the missing words to product titles/tags.", "Re-check click rate after 2 weeks."],
            test=None, impact=None, formula="Not estimated.",
            window_days=ctx["window_days"], window_label=(ctx.get("site") or {}).get("search_window_label"),
            confidence="Medium", effort="Low",
        )
    if scvr and ncvr and scvr >= ncvr * 2 and (s.get("share_of_sessions") or 100) < 8 and ctx.get("sessions_total"):
        extra = ctx["sessions_total"] * 0.02
        b.add(
            key="search_visibility", kind="search_visibility", area="Search", action="test",
            title=f"Searchers convert {scvr / ncvr:.1f}× better but only {s['share_of_sessions']}% search - make search visible",
            segment="Site search · usage", page="Site Health",
            diagnosis=f"Searchers convert {_pct(scvr)} vs {_pct(ncvr)} for everyone else, yet few visitors use search (often it's a hidden icon on mobile).",
            metrics=[_metric("Searcher conversion", _pct(scvr), _pct(ncvr), "non-searchers", None, False),
                     _metric("Sessions that search", f"{s['share_of_sessions']}%")],
            causes=["Search is a small icon on mobile, not a visible box."],
            steps=["Show a full search bar in the mobile header (not just an icon).", "Add predictive search with product images.",
                   "Add popular searches as chips under the search box."],
            test=test_plan("A visible mobile search bar increases the share of sessions that search by 30%.", "Share of sessions with a search",
                           s["share_of_sessions"], 0.30, ctx.get("daily_sessions")),
            impact=extra * (scvr - ncvr) / 100 * aov * 0.5,
            formula=f"{extra:,.0f} more searching sessions (+2 pts) × {scvr - ncvr:.2f} pts conversion difference × {_money(aov)} AOV × 50%",
            assumption="Assumes 2% more sessions search and half the conversion difference holds (searchers are partly self-selected).",
            window_days=ctx["window_days"], confidence="Low", effort="Low",
        )


def rule_geo(b: _Builder):
    ctx = b.ctx
    geo, aov, store_cvr = ctx.get("geo") or {}, ctx["aov_calc"], ctx["store_cvr"]
    if not aov or not store_cvr:
        return
    found = []
    for kind, rows in (("country", geo.get("countries") or []), ("state", geo.get("states") or [])):
        for r in rows:
            cvr = r.get("conversion_rate")
            if not r.get("enough_data") or cvr is None or cvr >= store_cvr * 0.6 or (r.get("share_of_sessions") or 0) < 3:
                continue
            found.append((r["sessions"] * (store_cvr - cvr), kind, r))
    found.sort(key=lambda x: -x[0])
    for _, kind, r in found[:3]:
        cvr, gap = r["conversion_rate"], store_cvr - r["conversion_rate"]
        intl = kind == "country" and r["label"] not in ("United States", "US")
        b.add(
            key=f"geo:{kind}:{r['label']}", kind="geo", area="Geography", action="test" if intl else "fix",
            title=f"Visitors from {r['label']} convert {_pct(cvr)} vs {_pct(store_cvr)} store ({r['share_of_sessions']}% of traffic)",
            segment=f"{'Country' if kind == 'country' else 'US state'} · {r['label']}", page="Conversion Analytics",
            diagnosis=(f"{r['sessions']:,} sessions from {r['label']} with add-to-cart {_pct(r.get('added_to_cart_rate'))}. "
                       + ("International visitors usually drop at shipping cost, delivery time or currency." if intl else
                          "A region converting far below the rest usually sees higher shipping cost or slower delivery.")),
            metrics=[_metric("Conversion rate", _pct(cvr), _pct(store_cvr), "store", f"{-gap:+.2f} pts", True),
                     _metric("Add-to-cart rate", _pct(r.get("added_to_cart_rate"))),
                     _metric("Share of sessions", f"{r['share_of_sessions']}%")],
            causes=(["Prices shown in USD; shipping/duties unclear until checkout.", "Long delivery times or no shipping to this country."] if intl else
                    ["Shipping cost or delivery time to this region is worse.", "Ads targeting this region bring lower-intent traffic."]),
            steps=(["Turn on Shopify Markets local currency and show duties-included prices for this country.",
                    "State delivery time and cost for this country on product pages.",
                    "If you don't ship there profitably, exclude it from ad targeting."] if intl else
                   ["Check shipping rates and delivery estimates for this state.",
                    "Show the estimated delivery date by ZIP on product pages.",
                    "Check ad targeting for this state; lower bids if conversion stays low."]),
            test=None,
            impact=r["sessions"] * gap / 100 * aov * CLOSE_GAP,
            formula=f"{r['sessions']:,} sessions × {gap:.2f} pts gap × {_money(aov)} AOV × 50%",
            assumption="Assumes half the gap to the store is closed.",
            window_days=ctx["window_days"], confidence=_conf(r["sessions"], 2000, 500), effort="Medium",
        )


def rule_refunds_store(b: _Builder):
    ctx = b.ctx
    h, aov = ctx.get("order_health"), ctx["aov_calc"]
    if not h or h.get("total_orders", 0) < 20 or not aov:
        return
    ar = h.get("any_refund", {})
    pct = ar.get("pct") or 0
    if pct < 5:
        return
    extra = ar["count"] - h["total_orders"] * 0.03
    b.add(
        key="refunds:store", kind="refunds", area="Refunds", action="fix",
        title=f"{pct}% of orders were refunded - find the top 3 reasons",
        segment="Orders · refunds", page="Overview",
        diagnosis=f"{ar['count']:,} of {h['total_orders']:,} orders were refunded fully or partly. Check the product-level refund items for which products drive it.",
        metrics=[_metric("Orders refunded", f"{pct}%", "≈3%", "healthy norm", f"{pct - 3:+.1f} pts", True)],
        causes=["Size/colour expectations not met.", "Shipping damage.", "Quality issues on specific products."],
        steps=["Export refunded orders and tag each with a reason.", "Fix listings for the top-refunded products (size photo, dimensions).",
               "Review packaging for breakable items."],
        test=None,
        impact=max(extra, 0) * aov * CLOSE_GAP,
        formula=f"{max(extra, 0):.0f} refunds above a 3% norm × {_money(aov)} AOV × 50%",
        assumption="Assumes half the excess refunds are avoided.",
        window_days=ctx["struct_days"], window_label=ctx["struct_label"], confidence=_conf(h["total_orders"], 500, 100), effort="Medium",
    )


# ---------------------------------------------------------------------------
# product pages, stock, sizes, offers, delivery (catalog audit) and the live
# site review
# ---------------------------------------------------------------------------

def _catalog_by_title(ctx: dict) -> dict[str, dict]:
    return {c["title"].strip().lower(): c for c in ctx.get("catalog") or []}


def _content_issues(c: dict, price: float | None) -> list[str]:
    issues = []
    if c["images"] <= 2:
        issues.append(f"only {c['images']} photo{'s' if c['images'] != 1 else ''}")
    if c["words"] < 80:
        issues.append(f"description is {c['words']} words")
    if c.get("review_count") is not None and c["review_count"] < 5:
        issues.append(f"{c['review_count']} reviews")
    if c.get("rating") is not None and c["rating"] < 4.4 and (c.get("review_count") or 0) >= 5:
        issues.append(f"rating {c['rating']:.1f}")
    if not c["videos"] and (price or 0) >= 80:
        issues.append("no video")
    if not c["product_type"]:
        issues.append("no product type (hurts search filters)")
    return issues


def _content_metrics(c: dict) -> list[dict]:
    out = [_metric("Photos on the page", str(c["images"]), "6+", "good practice", None, c["images"] <= 2),
           _metric("Description length", f"{c['words']} words", "120+", "good practice", None, c["words"] < 80)]
    if c.get("review_count") is not None:
        out.append(_metric("Reviews", str(c["review_count"]) + (f" (avg {c['rating']:.1f}★)" if c.get("rating") else ""),
                           "10+", "to look trusted", None, c["review_count"] < 5))
    out.append(_metric("Video", "yes" if c["videos"] else "no"))
    return out


def rule_product_pages(b: _Builder):
    """Busy / best-selling product pages with weak content, named one by one."""
    ctx = b.ctx
    cat = _catalog_by_title(ctx)
    prod = ctx.get("products") or {}
    if not cat or not prod.get("products"):
        return
    leaky = {p["name"] for p in prod.get("fix_first") or []}
    views_ok = bool(prod.get("views_available"))
    vdays = max(prod.get("views_days") or 1, 1)
    pdays = min(max(ctx["struct_days"], 7), 60)
    ranked = sorted(prod["products"], key=lambda p: -((p.get("views") or 0) * (p.get("price") or 0) if views_ok else p.get("revenue") or 0))
    found = 0
    for p in ranked[:40]:
        c = cat.get(p["name"].strip().lower())
        if not c or p["name"] in leaky:
            continue
        issues = _content_issues(c, p.get("price"))
        if len(issues) < 2:
            continue
        found += 1
        rev = p.get("revenue") or 0
        if views_ok and p.get("views"):
            impact = p["views"] * (p.get("view_to_purchase_rate") or 0) / 100 * (p.get("price") or 0) * 0.10
            formula = f"{p['views']:,} views × {_pct(p.get('view_to_purchase_rate'))} buy × {_money(p.get('price'))} × 10% lift"
            wd, wl = vdays, prod.get("views_window_label")
        else:
            impact = rev * 0.10
            formula = f"{_money(rev)} sales × 10% lift"
            wd, wl = pdays, prod.get("window_label")
        metrics = []
        if p.get("views"):
            metrics.append(_metric("Product page views", f"{p['views']:,}"))
        if p.get("view_to_purchase_rate") is not None:
            metrics.append(_metric("View → purchase", _pct(p["view_to_purchase_rate"]), _pct(p.get("category_rate")), f"{p['category']} average"))
        metrics.append(_metric("Net sales", _money(rev)))
        metrics += _content_metrics(c)
        steps = []
        if c["images"] <= 2:
            steps.append(f"Shoot {6 - c['images']} more photos: on a bed/table in a real room, close-up of the block print, folded stack, size-scale shot (with a person or furniture), and the back/border.")
        if c["words"] < 80:
            steps.append("Rewrite the description: 3 benefit bullets, exact dimensions per size, fabric/GSM, care, and 'what's in the box'.")
        if c.get("review_count") is not None and c["review_count"] < 5:
            steps.append("Email the last 60 days of buyers of this product for a photo review (offer 10% off next order); pin the best photo review under the title.")
        if not c["videos"] and (p.get("price") or 0) >= 80:
            steps.append("Add a 10-15s vertical video (unfolding / on the bed) as the 2nd gallery item.")
        if not c["product_type"]:
            steps.append("Set the product type so it shows up in collection filters and search.")
        b.add(
            key=f"product_page:{p['name']}", kind="product_page", area="Product pages", action="fix",
            title=f"Upgrade the '{p['name']}' page: " + ", ".join(issues[:3]),
            segment=f"Product · {p['category']}", page="Product Analytics", page_path=f"/products/{c['handle']}",
            diagnosis=(f"This is one of your most important products ({_money(rev)} sales"
                       + (f", {p['views']:,} page views" if p.get("views") else "") + ") but its page is thin: "
                       + ", ".join(issues) + ". Buyers of $" + f"{(p.get('price') or 0):.0f}"
                       + " home textiles want to see texture, scale and proof before they add to cart."),
            metrics=metrics,
            causes=["Shoppers can't judge size, texture and colour from the current photos/text.",
                    "Too little social proof on the page itself."],
            steps=steps,
            test=test_plan(f"A fuller page (photos, dimensions, reviews) lifts '{p['name']}' view-to-purchase by 15%.",
                           "Conversion rate (this page)", p.get("view_to_purchase_rate"), 0.15,
                           (p.get("views") or 0) / vdays if p.get("views") else None),
            impact=impact, formula=formula,
            assumption="Assumes a 10% lift in this product's sales from a complete page (conservative).",
            window_days=wd, window_label=wl, confidence="Medium" if (p.get("views") or rev) else "Low", effort="Medium",
        )
        if found >= 6:
            break

    # Catalogue-wide content gaps among products that actually sell.
    selling = [cat[p["name"].strip().lower()] for p in prod["products"]
               if (p.get("revenue") or 0) > 0 and p["name"].strip().lower() in cat]
    if len(selling) >= 20:
        few = [c for c in selling if c["images"] <= 2]
        thin = [c for c in selling if c["words"] < 60]
        no_rev = [c for c in selling if c.get("review_count") is not None and c["review_count"] == 0]
        if len(few) + len(thin) + len(no_rev) >= max(5, len(selling) * 0.15):
            metrics = [_metric("Selling products with ≤2 photos", f"{len(few)} of {len(selling)}", None, None, None, bool(few)),
                       _metric("Selling products with <60-word descriptions", f"{len(thin)} of {len(selling)}", None, None, None, bool(thin))]
            if any(c.get("review_count") is not None for c in selling):
                metrics.append(_metric("Selling products with 0 reviews", f"{len(no_rev)} of {len(selling)}", None, None, None, bool(no_rev)))
            names = ", ".join(c["title"] for c in few[:6])
            b.add(
                key="catalog_content", kind="catalog_content", area="Product pages", action="fix",
                title=f"{len(few)} selling products have 2 photos or fewer, {len(thin)} have thin descriptions",
                segment="Catalogue · content", page="Product Analytics",
                diagnosis="Across products that sold in this window, many pages miss the basics buyers use to decide. Fixing them in a batch (one shoot, one copy template) is cheaper than page by page.",
                metrics=metrics,
                causes=["Products were listed quickly with a single studio/lifestyle shot.", "No content template for new listings."],
                steps=[(f"Start with: {names}." if names else "Start with the best sellers in the list."),
                       "Create one listing template: 6 photos (room, close-up, scale, folded, detail, back), dimensions table per size, fabric/care, 3 benefit bullets.",
                       "Turn on an automatic review-request email 10 days after delivery (Judge.me) with a photo-review incentive.",
                       "Make 'ready to publish' require the template for every new product."],
                test=None, impact=None, formula="Not estimated: covered product by product in the items above.",
                window_days=pdays, window_label=prod.get("window_label"), confidence="Medium", effort="Medium",
            )


def rule_stock(b: _Builder):
    """Best-selling variants about to run out (or already out)."""
    ctx = b.ctx
    cat, vs = _catalog_by_title(ctx), ctx.get("variant_sales") or {}
    if not cat or not vs:
        return
    days = ctx["struct_days"]
    risks = []
    for title, variants in vs.items():
        c = cat.get(title.strip().lower())
        if not c or not c["tracks_inventory"]:
            continue
        for v in c["variants"]:
            sold = variants.get(v["title"]) or (variants.get("Default Title") if len(c["variants"]) == 1 else None)
            if not sold or v.get("inventory") is None:
                continue
            per_day = sold / days
            if per_day < 0.1:
                continue
            inv = max(v["inventory"], 0)
            cover = inv / per_day if per_day else None
            if inv == 0 or (cover is not None and cover < 21):
                lost_days = max(0.0, 30 - (cover or 0))
                risks.append((per_day * lost_days * (v.get("price") or 0), title, v, sold, per_day, inv, cover))
    risks.sort(key=lambda x: -x[0])
    for value, title, v, sold, per_day, inv, cover in risks[:5]:
        out = inv == 0
        b.add(
            key=f"stock:{title}|{v['title']}", kind="stock", area="Products", action="fix",
            title=(f"'{title}' ({v['title']}) is out of stock - it sold {sold} in {days} days" if out else
                   f"Restock '{title}' ({v['title']}): {inv} left, ~{cover:.0f} days of stock"),
            segment=f"Product · {title}", page="Product Analytics",
            diagnosis=(f"This variant sells ~{per_day:.1f} a day. " + ("Every day it stays out of stock loses those sales, and the visitors who wanted it often leave instead of picking another size."
                       if out else f"At that pace it runs out in about {cover:.0f} days - reorder now so it never shows 'Sold out'.")),
            metrics=[_metric("Units sold", f"{sold} in {days} days ({per_day:.1f}/day)"),
                     _metric("In stock", str(inv), None, None, None, True),
                     _metric("Days of stock left", "0" if out else f"{cover:.0f}", "21+", "safe level", None, True),
                     _metric("Price", _money(v.get("price")))],
            causes=["Reorder point not set for best-selling sizes."],
            steps=["Place the reorder / production run today; set a reorder alert at 21 days of cover.",
                   ("Until it's back: turn on 'Notify me when available' and show the restock date on the page." if out else
                    "Keep it out of paid ads only if cover falls under 7 days."),
                   "Check the same design in other sizes and matching items (pillow covers, napkins) for the same risk."],
            test=None,
            impact=value * CLOSE_GAP,
            formula=f"{per_day:.1f}/day × {max(0.0, 30 - (cover or 0)):.0f} days without stock in the next month × {_money(v.get('price'))} × 50%",
            assumption="Assumes half the buyers would not switch to another size or product.",
            window_days=30, window_label="next 30 days", confidence="High" if sold >= 20 else "Medium", effort="Low",
        )


def rule_size_price(b: _Builder):
    """Cards show the cheapest size; most buyers pick a pricier one -> sticker shock."""
    ctx = b.ctx
    cat, vs = _catalog_by_title(ctx), ctx.get("variant_sales") or {}
    if not cat or not vs:
        return
    rows = []
    for title, variants in vs.items():
        c = cat.get(title.strip().lower())
        if not c or len(c["variants"]) < 2 or sum(variants.values()) < 5:
            continue
        first = c["variants"][0]
        top_title, top_n = max(variants.items(), key=lambda kv: kv[1])
        top = next((v for v in c["variants"] if v["title"] == top_title), None)
        if not top or not first.get("price") or not top.get("price") or top["title"] == first["title"]:
            continue
        jump = (top["price"] - first["price"]) / first["price"] * 100
        if jump >= 25:
            rows.append((top_n, title, first, top, jump, top_n / sum(variants.values()) * 100))
    if len(rows) < 3:
        return
    rows.sort(key=lambda r: -r[0])
    ex = rows[0]
    min_jump = min(r[4] for r in rows)
    b.add(
        key="size_price_jump", kind="size_price_jump", area="Product pages", action="test",
        title=(f"On {len(rows)} best sellers the size people buy costs {min_jump:.0f}%+ more than the price on the card "
               f"(e.g. '{ex[1]}': {ex[2]['title']} {_money(ex[2]['price'])} vs {ex[3]['title']} {_money(ex[3]['price'])})"),
        segment="Catalogue · size pricing", page="Product Analytics",
        diagnosis=("Collection cards and the product page open on the smallest size, so the first price a shopper sees is the lowest. "
                   "Most buyers then pick a bigger size and the price jumps - a classic add-to-cart drop-off point."),
        metrics=[_metric(r[1][:40], f"{r[2]['title'].split(' -')[0]} {_money(r[2]['price'])}",
                         f"{r[3]['title'].split(' -')[0]} {_money(r[3]['price'])}", f"bought most ({r[5]:.0f}% of units)",
                         f"+{r[4]:.0f}%", True) for r in rows[:6]],
        causes=["The default (first) variant is the cheapest, not the most popular.",
                "Card price doesn't say 'From'."],
        steps=["Make the most-bought size the default selected variant on these products (move it to position 1 or preselect it in the theme).",
               "Show 'From $X' on collection cards and a size-price list ('Twin $X · Queen $Y · King $Z') under the title.",
               "Show the extra 10% / bundle saving on the size they pick, so the bigger number comes with a reason."],
        test=test_plan("Defaulting to the most-bought size (with 'From' pricing on cards) keeps add-to-cart flat and lifts AOV 5%.",
                       "Average order value", None, 0.05, None, "aov"),
        impact=None, formula="Not estimated: measure add-to-cart rate and AOV before/after.",
        window_days=ctx["struct_days"], window_label=ctx["struct_label"], confidence="Medium", effort="Low",
    )


def rule_offers(b: _Builder):
    """Permanent 'sale' prices on almost everything erode trust."""
    ctx = b.ctx
    cat = ctx.get("catalog") or []
    if len(cat) < 20:
        return
    disc = []
    for c in cat:
        v = c["variants"][0] if c["variants"] else None
        if v and v.get("compare_at") and v.get("price") and v["compare_at"] > v["price"]:
            disc.append((v["compare_at"] - v["price"]) / v["compare_at"] * 100)
    share = len(disc) / len(cat) * 100
    if share < 70:
        return
    med = sorted(disc)[len(disc) // 2]
    b.add(
        key="offers_always_on_sale", kind="offers", area="Trust & offers", action="test",
        title=f"{share:.0f}% of products are permanently 'on sale' (median {med:.0f}% off) - the discount no longer persuades",
        segment="Catalogue · compare-at prices", page="Overview",
        diagnosis=(f"{len(disc)} of {len(cat)} active products show a crossed-out price, median {med:.0f}% off, on top of site-wide "
                   "extra-% offers, bundle offers and countdown timers. When everything is always 50% off, shoppers stop believing the "
                   "'regular' price and wait for the next deal; in the US, permanent 'was' prices and resetting timers can also break FTC pricing rules."),
        metrics=[_metric("Products with a compare-at price", f"{share:.0f}%", None, None, None, True),
                 _metric("Median discount shown", f"{med:.0f}%")],
        causes=["Compare-at prices set once at launch and never removed.", "Several offers stacked on the same page."],
        steps=["Pick ONE offer message per season (e.g. 'Black Friday: extra 10% on quilts') and remove the others from the same page.",
               "Remove countdown timers that reset on reload; only show a timer for a real end date.",
               "Test removing compare-at prices on one collection (e.g. napkins) for 2 weeks and compare conversion and AOV.",
               "Use the saving story you can defend: 'handmade in Jaipur, direct from the makers'."],
        test=test_plan("Honest pricing (no permanent compare-at, one clear offer) keeps conversion within 5% and raises full-price share.",
                       "Conversion rate", ctx.get("store_cvr"), 0.10, ctx.get("daily_sessions")),
        impact=None, formula="Not estimated: protects margin and trust; measure conversion and discount spend.",
        window_days=ctx["struct_days"], window_label="current catalogue", confidence="Medium", effort="Low",
    )


def rule_delivery(b: _Builder):
    ctx = b.ctx
    d = ctx.get("delivery")
    if not d or (d.get("deliver_orders") or 0) < 20 or d.get("deliver_p75") is None:
        return
    if d["deliver_p75"] <= 10:
        return
    aov = ctx["aov_calc"]
    fun = ctx.get("funnel_total")
    impact = fun["purchase"] * 0.03 * aov if fun and aov else None
    b.add(
        key="delivery_promise", kind="delivery", area="Delivery", action="fix",
        title=(f"Half of orders take {d['deliver_median']:.0f}+ days to arrive ({d['deliver_over_21_share']}% over 3 weeks) "
               "- the delivery promise doesn't match"),
        segment=f"Orders · delivery ({d['deliver_scope']})", page="Overview",
        diagnosis=(f"For {d['deliver_orders']:,} delivered {d['deliver_scope']} ({d['window_label']}): median {d['deliver_median']} days, "
                   f"75% within {d['deliver_p75']} days, 90% within {d['deliver_p90']} days. Orders wait a median {d['ship_median']} days "
                   "before they even ship. Slow delivery that isn't stated up front shows up later as 'took 6 weeks' reviews, "
                   "refund requests and lower repeat purchase."),
        metrics=[_metric("Order → delivered (median)", f"{d['deliver_median']} days"),
                 _metric("Order → delivered (75%)", f"{d['deliver_p75']} days", "≤10 days", "what the site promises", None, True),
                 _metric("Delivered after 3 weeks", f"{d['deliver_over_21_share']}%", None, None, None, (d.get("deliver_over_21_share") or 0) > 10),
                 _metric("Order → shipped (median / 90%)", f"{d['ship_median']} / {d['ship_p90']} days"),
                 _metric("Still not shipped after 14 days", f"{d['unfulfilled_after_14d']} of {d['orders']}")],
        causes=["Made-to-order / international shipping time isn't shown before purchase.",
                "Processing time before dispatch is long."],
        steps=[f"Show an honest 'Arrives by <date>' (today + {int(round(d['deliver_p75']))} days) right under Add to cart and in the cart.",
               "Change the header promise ('Free Shipping 3-10 days US') to the real range, or ship best sellers from US stock so it becomes true.",
               "Keep a US buffer stock of the top 20 variants (see stock items) to cut delivery to under a week.",
               "Send a 'your order is being handmade' email with tracking ETA on day 2 to cut 'where is my order' tickets and refunds."],
        test=None, impact=impact,
        formula=(f"{fun['purchase']:,} orders × 3% fewer refunds/lost repeat × {_money(aov)} AOV" if impact else "Not estimated."),
        assumption="Assumes clear delivery dates and faster shipping protect ~3% of orders (refunds, cancellations, repeat).",
        window_days=ctx["window_days"], confidence="High" if d["deliver_orders"] >= 200 else "Medium", effort="High",
    )


# Findings from a hands-on review of ridhiblockprint.com (mobile 375px,
# 23 Nov 2026). Each one carries the observed fact and a size estimate from
# the store's live numbers. Update or remove an item once it's fixed.
SITE_REVIEW_DATE = "23 Nov 2026"


def rule_site_review(b: _Builder):
    ctx = b.ctx
    aov, fun = ctx["aov_calc"], ctx.get("funnel_total")
    mob = (ctx.get("funnel") or {}).get("Mobile")
    wl = f"site review {SITE_REVIEW_DATE} + {ctx['window_label']}"
    if mob and aov:
        atc = _rate(mob["cart"], mob["sessions"])
        down = _rate(mob["purchase"], mob["cart"])
        b.add(
            key="site:pdp_mobile_atc", kind="site_review", area="Product pages", action="fix",
            title="On mobile, Add to cart is 2 screens down on product pages and there's no sticky button",
            segment="Live site · product page · mobile", page="Conversion Analytics",
            diagnosis=("On the Dark Salmon Pink Quilt page (a best seller) at phone size, the Add to cart button sits ~1,640px down - "
                       "below the gallery, a '50,000+ customers' badge, the title, size picker, a bundle box and a countdown. "
                       "There is no sticky Add to cart and no Shop Pay / Apple Pay button on the page. "
                       f"Mobile add-to-cart is {_pct(atc)} on {mob['sessions']:,} sessions."),
            metrics=[_metric("Add to cart position (mobile)", "≈1,640px (2 screens)", "< 812px", "first screen", None, True),
                     _metric("Sticky Add to cart", "No", None, None, None, True),
                     _metric("Express pay on product page", "No", None, None, None, True),
                     _metric("Mobile add-to-cart rate", _pct(atc))],
            causes=["Badges, bundle box and timer push the buy button down.", "Gallery thumbnails 3-4 load blank at first view."],
            steps=["Add a sticky bottom bar on mobile product pages: size + price + ADD TO CART (appears after the gallery scrolls away).",
                   "Order the first screen: image → title + product rating → price → size buttons → Add to cart. Move the '50,000+ customers' badge and the bundle box below the button.",
                   "Turn on the dynamic checkout button (Shop Pay / Apple Pay) under Add to cart.",
                   "Don't lazy-load the first 4 gallery thumbnails."],
            test=test_plan("A sticky mobile Add to cart lifts mobile add-to-cart rate by 8%.", "Mobile add-to-cart rate", atc, 0.08,
                           mob["sessions"] / ctx["window_days"], "added_to_cart_rate"),
            impact=mob["cart"] * 0.08 * (down or 0) / 100 * aov,
            formula=f"{mob['cart']:,} mobile carts × 8% more × {_pct(down, 1)} cart → order × {_money(aov)} AOV",
            assumption="Assumes +8% mobile add-to-cart, a typical result for sticky buy buttons.",
            window_days=ctx["window_days"], window_label=wl, confidence="Medium", effort="Low",
        )
    if fun and aov:
        c2c = _rate(fun["checkout"], fun["cart"])
        down = _rate(fun["purchase"], fun["checkout"])
        b.add(
            key="site:cart_page", kind="site_review", area="Checkout", action="fix",
            title="Cart page: the Checkout button is under a shipping calculator - and shipping is free anyway",
            segment="Live site · cart · mobile", page="Cart & Checkout",
            diagnosis=("On mobile the cart shows 'You got free shipping', then a full 'Get estimate shipping' form (country, state, ZIP), "
                       "and only then CHECKOUT at ~1,450px. The free-shipping bar is always full because everything ships free, "
                       "and the recommended-products block below has the placeholder title 'Heading'. "
                       f"Cart → checkout is {_pct(c2c)}."),
            metrics=[_metric("Checkout button position (mobile)", "≈1,450px", "< 812px", "first screen", None, True),
                     _metric("Shipping estimator", "Shown (shipping is free)", None, None, None, True),
                     _metric("Cart → checkout", _pct(c2c)),
                     _metric("Upsell block title", "'Heading' (placeholder)", None, None, None, True)],
            causes=["A theme section that isn't needed for a free-shipping store.", "Unfinished upsell section."],
            steps=["Remove the shipping estimator from the cart page and drawer.",
                   "Put subtotal, the applied 'extra 10%' saving, CHECKOUT and express-pay buttons right after the items.",
                   "Replace the always-full free-shipping bar with a bundle nudge: 'Add the matching pillow cover - save 10%'.",
                   "Rename 'Heading' to 'Complete the set' and show items matching the cart's print."],
            test=test_plan("Moving Checkout + express pay to the first screen of the cart lifts cart → checkout by 5%.",
                           "Cart-to-checkout rate", c2c, 0.05, fun["cart"] / ctx["window_days"]),
            impact=fun["cart"] * 0.05 * (c2c or 0) / 100 * (down or 0) / 100 * aov,
            formula=f"{fun['cart']:,} carts × {_pct(c2c, 1)} reach checkout × 5% more × {_pct(down, 1)} complete × {_money(aov)} AOV",
            assumption="Assumes +5% cart-to-checkout.",
            window_days=ctx["window_days"], window_label=wl, confidence="Medium", effort="Low",
        )
    b.add(
        key="site:offer_clutter", kind="site_review", area="Trust & offers", action="test",
        title="Three offers and two different countdowns on the same journey - pick one clear deal",
        segment="Live site · offers", page="Overview",
        diagnosis=("Collection page: 'Pre Black Friday, extra 10% on Quilts, ends in 00h 31m'. Product page: 47% off, a 'Bundle & save 51%' "
                   "box and 'Hurry! Offer expires in 14:52'. Cart: an automatic HOLIDAY10% line. The two timers show different end "
                   "times, and the product page never mentions the extra 10% that the cart then applies."),
        metrics=[_metric("Offers seen before checkout", "47% off + extra 10% + bundle 51%", None, None, None, True),
                 _metric("Countdown timers", "2, with different end times", None, None, None, True)],
        causes=["Offers added by different apps/campaigns over time."],
        steps=["Show the extra 10% on the product page price ('$97.99 → $88.19 in cart') so the deal is visible before Add to cart.",
               "Keep one timer tied to the real sale end date (e.g. Black Friday end) everywhere, or none.",
               "Keep the bundle box but collapse it under Add to cart."],
        test=test_plan("Showing the cart discount on the product page lifts add-to-cart by 5%.", "Add-to-cart rate", ctx.get("store_atc"), 0.05,
                       ctx.get("daily_sessions"), "added_to_cart_rate"),
        impact=None, formula="Not estimated.", window_days=ctx["window_days"], window_label=wl, confidence="Medium", effort="Low",
    )
    b.add(
        key="site:reviews_on_pdp", kind="site_review", area="Product pages", action="fix",
        title="Product pages show the store's 4.9★, not the product's own rating, and feature a '6-7 weeks to arrive' review",
        segment="Live site · reviews", page="Product Analytics",
        diagnosis=("Under the title the quilt page shows '4.9/5 Ridhi customer rating' (store-wide). The product's own score (4.6★, "
                   "16 reviews, 13% 2-star) is far down the page, and the featured reviews there are for other products - one says "
                   "'took about 6-7 weeks to receive'. Best sellers have only 3-16 reviews each against 2,196 for the store."),
        metrics=[_metric("Rating shown at top", "Store 4.9★ (2,196)", "Product 4.6★ (16)", "actual product", None, True),
                 _metric("Reviews per best seller", "3-16", "30+", "to look established", None, True)],
        causes=["Review widget set to store-wide carousel.", "No systematic review requests per product."],
        steps=["Show the product's own stars + count under the title (link to reviews); keep the store rating as a small badge.",
               "Filter the featured reviews on a product page to that product (or same category), 4★+ with photos first.",
               "Send review requests 10 days after DELIVERY (not after order), with a photo incentive, starting with best sellers."],
        test=None, impact=None, formula="Not estimated.",
        window_days=ctx["window_days"], window_label=wl, confidence="Medium", effort="Low",
    )
    b.add(
        key="site:third_party_scripts", kind="site_review", area="Speed", action="fix",
        title="Collection pages load 480+ files from 34 different servers - trim apps and trackers",
        segment="Live site · page weight", page="Site Health",
        diagnosis=("The Quilts collection page made ~486 network requests to 34 hosts: Trustpilot and Judge.me (two review apps), "
                   "Klaviyo, Clarity, Bing, Facebook, Google Tag Manager, a chat widget and more, plus 195 script tags on the home page. "
                   "Each one costs mobile load time and tap responsiveness."),
        metrics=[_metric("Network requests (collection page)", "≈486", None, None, None, True),
                 _metric("Third-party hosts", "34", None, None, None, True),
                 _metric("Review apps loaded", "2 (Trustpilot + Judge.me)", "1", None, None, True)],
        causes=["Apps added over time, old ones not removed.", "Trackers loaded directly instead of through one tag manager."],
        steps=["Keep one review app (Judge.me holds the product reviews) and remove Trustpilot's scripts, or load it only on the home page.",
               "Move Bing/Facebook/other pixels into Google Tag Manager or Shopify Customer Events and load them after interaction.",
               "Load the chat widget only after a user tap or 10 seconds.",
               "Re-check mobile LCP/INP on Site Health a week later."],
        test=None, impact=None, formula="Not estimated: see the Speed item for the size of the prize.",
        window_days=ctx["window_days"], window_label=wl, confidence="Medium", effort="Medium",
    )


RULES = [rule_funnel, rule_mobile, rule_landing, rule_sources, rule_cvr_drop, rule_payments, rule_products,
         rule_product_pages, rule_stock, rule_size_price, rule_offers, rule_delivery, rule_site_review,
         rule_order_value, rule_retention, rule_speed, rule_search, rule_geo, rule_refunds_store]


# ---------------------------------------------------------------------------
# assembly
# ---------------------------------------------------------------------------

def _funnel_summary(ctx: dict) -> dict | None:
    cur, prev = ctx.get("funnel_total"), ctx.get("funnel_prev_total")
    if not cur:
        return None
    steps = []
    for key, label in (("sessions", "Sessions"), ("cart", "Added to cart"), ("checkout", "Reached checkout"), ("purchase", "Purchased")):
        steps.append({
            "key": key, "label": label, "value": cur[key],
            "pct_of_sessions": round(_rate(cur[key], cur["sessions"]), 2) if cur["sessions"] else None,
            "previous_pct_of_sessions": round(_rate(prev[key], prev["sessions"]), 2) if prev and prev["sessions"] else None,
        })
    r = _step_rates(cur)
    pr = _step_rates(prev) if prev and prev["sessions"] else {}
    worst = None
    for k in ("cart", "checkout", "purchase"):
        if r[k] is not None and pr.get(k):
            ch = (r[k] - pr[k]) / pr[k]
            if worst is None or ch < worst[1]:
                worst = (k, ch)
    return {
        "steps": steps,
        "step_rates": {k: (round(v, 2) if v is not None else None) for k, v in r.items()},
        "previous_step_rates": {k: (round(v, 2) if v is not None else None) for k, v in pr.items()},
        "weakest_step": STEP_INFO[worst[0]]["name"] if worst and worst[1] < 0 else None,
        "by_device": {d: {**v, **{f"{k}_rate": (round(x, 2) if x is not None else None) for k, x in _step_rates(v).items()}}
                      for d, v in (ctx.get("funnel") or {}).items() if v["sessions"]},
    }


def _coverage(ctx: dict) -> list[dict]:
    prod = ctx.get("products") or {}
    deeper = ctx.get("deeper") or {}
    return [
        {"source": "Shopify sessions & funnel", "ok": bool(ctx.get("funnel_total"))},
        {"source": "Landing pages & traffic sources", "ok": bool(ctx.get("landing"))},
        {"source": "Sales & AOV", "ok": bool(ctx.get("aov"))},
        {"source": "Page speed (Core Web Vitals)", "ok": bool((ctx.get("site") or {}).get("cwv_available"))},
        {"source": "Site search", "ok": bool((ctx.get("site") or {}).get("search"))},
        {"source": "Country / state", "ok": bool((ctx.get("geo") or {}).get("countries"))},
        {"source": "Payments", "ok": bool(((ctx.get("cart") or {}).get("payments") or {}).get("attempts"))},
        {"source": "Product views (Clarity)", "ok": bool(prod.get("views_available"))},
        {"source": "Product sales & refunds", "ok": bool(prod.get("products"))},
        {"source": "Orders: codes, bundles, customers", "ok": bool(deeper.get("discounts"))},
        {"source": "New vs returning", "ok": bool(deeper.get("new_vs_returning"))},
        {"source": "Product pages: photos, text, reviews, stock", "ok": bool(ctx.get("catalog"))},
        {"source": "Sizes sold", "ok": bool(ctx.get("variant_sales"))},
        {"source": "Delivery times", "ok": bool(ctx.get("delivery"))},
        {"source": f"Live site review ({SITE_REVIEW_DATE})", "ok": True},
    ]


def build_recommendations(db: Session, store: models.Store, days: int = 30, period: str | None = None) -> dict:
    """period: None (last `days` complete days) or "yesterday"."""
    period = "yesterday" if period == "yesterday" else None
    ctx = gather(db, store, days, period)
    return assemble(db, store, ctx)


def run_rules(ctx: dict) -> tuple[list[dict], list[str]]:
    b = _Builder(ctx)
    errors = []
    for rule in RULES:
        try:
            rule(b)
        except Exception as exc:  # a bug in one rule must not blank the page
            logger.exception("Recommendation rule %s failed", rule.__name__)
            errors.append(f"{rule.__name__}: {str(exc)[:200]}")
    # One item per key (first wins).
    seen, recs = set(), []
    for r in b.items:
        if r["key"] not in seen:
            seen.add(r["key"])
            recs.append(r)
    est = sorted(r["monthly_impact"] for r in recs if r["monthly_impact"])
    fallback = est[len(est) // 2] * 0.5 if est else 50.0
    for r in recs:
        base = r["monthly_impact"] or 0
        if not base:
            # No money estimate: rank like a mid-sized item (half the median
            # estimate), so trust / content fixes don't sink to the bottom.
            base = fallback
        r["priority_score"] = round(base * CONF_WEIGHT[r["confidence"]] / EFFORT_WEIGHT[r["effort"]], 1)
    recs.sort(key=lambda r: -r["priority_score"])
    for i, r in enumerate(recs, 1):
        r["rank"] = i
    return recs, errors


def assemble(db: Session | None, store: models.Store | None, ctx: dict) -> dict:
    recs, rule_errors = run_rules(ctx)
    saved = {}
    if db is not None and store is not None:
        saved = {r.rec_key: r for r in db.query(models.RecommendationStatus).filter(models.RecommendationStatus.store_id == store.id)}
    for r in recs:
        s = saved.get(r["key"])
        r["status"] = s.status if s else "open"
        r["status_updated_at"] = s.updated_at.isoformat() if s and s.updated_at else None
    active = [r for r in recs if r["status"] not in ("done", "ignored")]
    funnel = _funnel_summary(ctx)
    leak = next((r for r in recs if r["kind"] == "funnel_leak"), None)
    if funnel and leak:
        step = leak["key"].split(":", 1)[1]
        funnel["weakest_step"] = STEP_INFO[step]["name"] if step in STEP_INFO else "Cart → purchase"
    return {
        "days": ctx["days"],
        "period": ctx["period"] or f"last{ctx['days']}",
        "window_label": ctx["window_label"],
        "compare_label": ctx["compare_label"],
        "store_conversion_rate": round(ctx["store_cvr"], 2) if ctx["store_cvr"] else None,
        "industry_conversion_rate": INDUSTRY_CVR,
        "sessions": ctx["sessions_total"],
        "aov": ctx["aov"],
        "orders": ctx["orders"],
        "total_impact": round(sum(r["impact"] or 0 for r in active), 2),
        # Items overlap (a mobile fix also lifts the funnel and landing pages),
        # so the headline is the top 5, not a sum of everything.
        "top5_monthly_impact": round(sum(r["monthly_impact"] or 0 for r in active[:5]), 2),
        "total_monthly_impact": round(sum(r["monthly_impact"] or 0 for r in active), 2),
        "top_keys": [r["key"] for r in active[:3]],
        "funnel": funnel,
        "coverage": _coverage(ctx),
        "areas": sorted({r["area"] for r in recs}, key=lambda a: AREAS.index(a) if a in AREAS else 99),
        "recommendations": recs,
        "errors": ctx["errors"] + rule_errors,
        "generated_at": datetime.now(timezone.utc).isoformat(),
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
