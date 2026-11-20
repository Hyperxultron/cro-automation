"""
Deeper analyses (manager checklist, section 9) - stage 1:

  Price bands     - orders, items, net sales and view-to-purchase conversion
                    for products grouped by their price (P2)
  Discounts       - orders with vs without a discount code, and per code:
                    orders, AOV, discount given (P2)
  Bought together - top 20 product pairs bought in the same order (P2)

(The hour x day heatmap is the same one as on the Overview: /buy-heatmap.)

Data, all read-only from Shopify:
  - Orders (GraphQL Admin API) for the window in store time, test and
    cancelled orders left out: discount codes, subtotal after discounts,
    products in the order.
  - Product prices: the product's lowest variant price ("from $X"), from
    the products API, so a product lands in a band even if it sold nothing.
  - Net sales per product and product views come from the Product Analytics
    page's sources (Shopify sales report + Microsoft Clarity views), so the
    numbers here match that page.
AOV = subtotal after discounts / orders (before shipping and tax), the same
basis as Shopify's average order value.
"""

import logging
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from itertools import combinations

from sqlalchemy.orm import Session

import models
from landing import period_windows
from overview import _day_bounds_utc, _tz
from shopify_client import graphql

logger = logging.getLogger("deeper")

ORDERS_QUERY = """
query DeepOrders($cursor: String, $search: String) {
  orders(first: 50, after: $cursor, query: $search, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      createdAt
      test
      cancelledAt
      discountCodes
      currentSubtotalPriceSet { shopMoney { amount } }
      currentTotalDiscountsSet { shopMoney { amount } }
      lineItems(first: 15) {
        nodes { quantity product { id title } }
      }
      %EXTRA%
    }
  }
}
"""

# New vs returning needs the order's customer journey; repeat purchase needs
# the customer's order count (read_customers). If the app can't read one of
# them, Shopify refuses the whole query, so we step down to a smaller one and
# say which parts aren't available.
JOURNEY = "customerJourneySummary { ready customerOrderIndex daysToConversion momentsCount { count } }"
CUSTOMER = "customer { id numberOfOrders }"
VARIANTS = [("full", f"{JOURNEY} {CUSTOMER}"), ("journey", JOURNEY), ("basic", "")]
_variant: dict = {}

PRODUCTS_QUERY = """
query DeepProducts($cursor: String) {
  products(first: 250, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id title priceRangeV2 { minVariantPrice { amount } } }
  }
}
"""

BANDS = [(0, 25), (25, 50), (50, 75), (75, 100), (100, 150), (150, 200), (200, 300), (300, None)]
CACHE_SECONDS = 1800
_cache: dict = {}


def _cached(key, ttl, fn):
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    val = fn()
    _cache[key] = (time.time() + ttl, val)
    return val


def _pull_orders(store: models.Store, first, last) -> list[dict]:
    tz = _tz(store)
    start, _ = _day_bounds_utc(first, tz)
    _, end = _day_bounds_utc(last, tz)
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    search = (f"created_at:>='{start.astimezone(timezone.utc).strftime(fmt)}' "
              f"created_at:<'{end.astimezone(timezone.utc).strftime(fmt)}'")

    def page(cursor):
        start_at = _variant.get(store.store_url, 0)
        for i in range(start_at, len(VARIANTS)):
            q = ORDERS_QUERY.replace("%EXTRA%", VARIANTS[i][1])
            try:
                data = graphql(store.store_url, q, {"cursor": cursor, "search": search})["orders"]
                _variant[store.store_url] = i
                return data
            except Exception as exc:
                if i == len(VARIANTS) - 1 or cursor is not None:
                    raise
                logger.warning("Deeper: order query '%s' refused, trying a smaller one: %s", VARIANTS[i][0], exc)
        raise RuntimeError("unreachable")

    def load():
        out, cursor = [], None
        for _ in range(400):  # 20,000 orders max
            data = page(cursor)
            for n in data["nodes"]:
                if n.get("test") or n.get("cancelledAt"):
                    continue
                prods = {}
                for li in n["lineItems"]["nodes"]:
                    p = li.get("product")
                    if p:
                        prods[p["id"]] = p["title"]
                j = n.get("customerJourneySummary") or {}
                cust = n.get("customer") or {}
                out.append({
                    "created": n.get("createdAt"),
                    "order_index": j.get("customerOrderIndex") if j.get("ready") is not False else None,
                    "days_to_conversion": j.get("daysToConversion"),
                    "visits": ((j.get("momentsCount") or {}).get("count")) if j else None,
                    "customer": cust.get("id"),
                    "customer_orders": int(cust["numberOfOrders"]) if cust.get("numberOfOrders") is not None else None,
                    "codes": [c.strip().upper() for c in (n.get("discountCodes") or []) if c and c.strip()],
                    "subtotal": float(n["currentSubtotalPriceSet"]["shopMoney"]["amount"]),
                    "discount": float(n["currentTotalDiscountsSet"]["shopMoney"]["amount"]),
                    "products": prods,
                })
            if not data["pageInfo"]["hasNextPage"]:
                break
            cursor = data["pageInfo"]["endCursor"]
        return out

    return _cached(("orders", store.store_url, first.isoformat(), last.isoformat()), CACHE_SECONDS, load)


def _product_prices(store: models.Store) -> dict[str, float]:
    def load():
        out, cursor = {}, None
        for _ in range(40):
            data = graphql(store.store_url, PRODUCTS_QUERY, {"cursor": cursor})["products"]
            for n in data["nodes"]:
                try:
                    out[n["id"]] = float(n["priceRangeV2"]["minVariantPrice"]["amount"])
                except (TypeError, KeyError, ValueError):
                    pass
            if not data["pageInfo"]["hasNextPage"]:
                break
            cursor = data["pageInfo"]["endCursor"]
        return out

    return _cached(("prices", store.store_url), 6 * 3600, load)


def _band_label(lo, hi) -> str:
    return f"${lo}+" if hi is None else f"${lo}-{hi - 1}" if lo else f"Under ${hi}"


def _band_of(price: float):
    for lo, hi in BANDS:
        if price >= lo and (hi is None or price < hi):
            return (lo, hi)
    return BANDS[-1]


def _price_bands(db: Session, store: models.Store, days: int, orders: list[dict]) -> dict:
    from product_groups import fetch_product_analytics

    prices = _product_prices(store)
    pa = fetch_product_analytics(db, store, days=days)
    views_ok = bool(pa.get("views_available"))
    bands = {b: {"products": 0, "items": 0, "net_sales": 0.0, "views": 0, "view_orders": 0, "orders": 0} for b in BANDS}
    band_by_pid: dict[str, tuple] = {}
    for p in pa["products"]:
        spid = p.get("shopify_product_id")
        price = prices.get(spid) if spid else None
        if price is None:
            price = p.get("price")
        if price is None:
            continue
        b = _band_of(price)
        if spid:
            band_by_pid[spid] = b
        x = bands[b]
        x["products"] += 1
        x["items"] += int(p.get("quantity") or 0)
        x["net_sales"] += float(p.get("revenue") or 0)
        if views_ok:
            x["views"] += int(p.get("views") or 0)
            x["view_orders"] += int(p.get("view_orders") or 0)
    # Orders per band: an order counts once in every band it has a product from.
    for o in orders:
        for b in {band_by_pid[pid] for pid in o["products"] if pid in band_by_pid}:
            bands[b]["orders"] += 1
    total_sales = sum(x["net_sales"] for x in bands.values())
    rows = []
    for (lo, hi), x in bands.items():
        if not x["products"]:
            continue
        rows.append({
            "band": _band_label(lo, hi),
            "from": lo,
            "products": x["products"],
            "orders": x["orders"],
            "items": x["items"],
            "net_sales": round(x["net_sales"], 2),
            "share_of_sales": round(x["net_sales"] / total_sales * 100, 1) if total_sales else None,
            "views": x["views"] if views_ok else None,
            "conversion_rate": round(x["view_orders"] / x["views"] * 100, 2) if views_ok and x["views"] else None,
        })
    return {
        "rows": rows,
        "conversion_available": views_ok,
        "views_window_label": pa.get("views_window_label") if views_ok else None,
        "sales_source": pa.get("sales_source"),
    }


def _discounts(orders: list[dict]) -> dict:
    def stats(group):
        n = len(group)
        sub = sum(o["subtotal"] for o in group)
        disc = sum(o["discount"] for o in group)
        return {
            "orders": n,
            "net_sales": round(sub, 2),
            "aov": round(sub / n, 2) if n else None,
            "discount_given": round(disc, 2),
            "avg_discount": round(disc / n, 2) if n else None,
            "discount_pct": round(disc / (sub + disc) * 100, 1) if (sub + disc) else None,
        }

    total = len(orders)
    with_code = [o for o in orders if o["codes"]]
    without = [o for o in orders if not o["codes"]]
    by_code = defaultdict(list)
    for o in with_code:
        for c in set(o["codes"]):
            by_code[c].append(o)
    codes = sorted(({"code": c, **stats(g)} for c, g in by_code.items()), key=lambda r: -r["orders"])
    for c in codes:
        c["share_of_orders"] = round(c["orders"] / total * 100, 1) if total else None
    w, wo = stats(with_code), stats(without)
    w["share_of_orders"] = round(len(with_code) / total * 100, 1) if total else None
    wo["share_of_orders"] = round(len(without) / total * 100, 1) if total else None
    return {"total_orders": total, "with_code": w, "without_code": wo, "codes": codes[:15], "code_count": len(codes)}


def _pairs(orders: list[dict], limit: int = 20) -> dict:
    single = Counter()
    pair = Counter()
    titles: dict[str, str] = {}
    multi = 0
    for o in orders:
        pids = sorted(o["products"])
        titles.update(o["products"])
        single.update(pids)
        if len(pids) > 1:
            multi += 1
            pair.update(combinations(pids, 2))
    n = len(orders)
    rows = []
    for (a, b), c in pair.most_common(limit):
        lift = (c / n) / ((single[a] / n) * (single[b] / n)) if n and single[a] and single[b] else None
        rows.append({
            "a": titles.get(a, a), "b": titles.get(b, b),
            "orders_together": c,
            "a_orders": single[a], "b_orders": single[b],
            "pct_of_a": round(c / single[a] * 100, 1) if single[a] else None,
            "pct_of_b": round(c / single[b] * 100, 1) if single[b] else None,
            "lift": round(lift, 1) if lift else None,
        })
    return {"rows": rows, "orders": n, "multi_product_orders": multi,
            "multi_share": round(multi / n * 100, 1) if n else None}


def _median(xs):
    xs = sorted(xs)
    n = len(xs)
    return (xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2) if n else None


def _new_vs_returning(orders: list[dict]) -> dict | None:
    known = [o for o in orders if o.get("order_index")]
    if not known:
        return None
    new = [o for o in known if o["order_index"] == 1]
    ret = [o for o in known if o["order_index"] > 1]

    def stats(g):
        n = len(g)
        sub = sum(o["subtotal"] for o in g)
        return {"orders": n, "share_of_orders": round(n / len(known) * 100, 1), "net_sales": round(sub, 2),
                "aov": round(sub / n, 2) if n else None}

    visits = [o["visits"] for o in new if o.get("visits")]
    days = [o["days_to_conversion"] for o in new if o.get("days_to_conversion") is not None]
    v_buckets = [("1 visit", 1, 1), ("2 visits", 2, 2), ("3-5 visits", 3, 5), ("6+ visits", 6, None)]
    d_buckets = [("Same day", 0, 0), ("1-3 days", 1, 3), ("4-7 days", 4, 7), ("8-30 days", 8, 30), ("31+ days", 31, None)]

    def hist(vals, buckets):
        n = len(vals)
        return [{"label": lab, "orders": c, "share": round(c / n * 100, 1) if n else 0}
                for lab, lo, hi in buckets
                for c in [sum(1 for v in vals if v >= lo and (hi is None or v <= hi))]]

    return {
        "orders_with_journey": len(known),
        "orders_total": len(orders),
        "new": stats(new),
        "returning": stats(ret),
        "first_order": {
            "median_visits": _median(visits),
            "median_days": _median(days),
            "visits": hist(visits, v_buckets),
            "days": hist(days, d_buckets),
            "with_visits": len(visits),
            "with_days": len(days),
        },
    }


def _repeat_by_first_product(orders: list[dict], min_buyers: int = 5) -> dict | None:
    """First-time buyers in the window, grouped by the products in that first
    order: share who have ordered again by now (customer's order count > 1)."""
    firsts = [o for o in orders if o.get("order_index") == 1 and o.get("customer") and o.get("customer_orders") is not None]
    if not firsts:
        return None
    by_pid: dict[str, dict] = {}
    titles: dict[str, str] = {}
    for o in firsts:
        again = o["customer_orders"] > 1
        for pid, title in o["products"].items():
            titles[pid] = title
            x = by_pid.setdefault(pid, {"buyers": 0, "repeat": 0})
            x["buyers"] += 1
            x["repeat"] += 1 if again else 0
    overall_rep = sum(1 for o in firsts if o["customer_orders"] > 1)
    rows = [
        {"product": titles[pid], "first_time_buyers": x["buyers"], "came_back": x["repeat"],
         "repeat_rate": round(x["repeat"] / x["buyers"] * 100, 1)}
        for pid, x in by_pid.items() if x["buyers"] >= min_buyers
    ]
    rows.sort(key=lambda r: (-r["repeat_rate"], -r["first_time_buyers"]))
    return {
        "first_time_buyers": len(firsts),
        "came_back": overall_rep,
        "repeat_rate": round(overall_rep / len(firsts) * 100, 1),
        "min_buyers": min_buyers,
        "rows": rows[:20],
    }


def fetch_deeper(db: Session, store: models.Store, days: int = 30) -> dict:
    first, last, _, _, window_label, _ = period_windows(store, days, None)
    errors = {}
    orders: list[dict] = []
    try:
        orders = _pull_orders(store, first, last)
    except Exception as exc:
        logger.warning("Deeper: orders pull failed: %s", exc)
        errors["orders"] = str(exc)[:300]

    out = {"days": days, "window_label": window_label, "errors": errors,
           "generated_at": datetime.now(timezone.utc).isoformat()}
    try:
        out["price_bands"] = _price_bands(db, store, days, orders)
    except Exception as exc:
        logger.warning("Deeper: price bands failed: %s", exc)
        errors["price_bands"] = str(exc)[:300]
        out["price_bands"] = None
    out["discounts"] = _discounts(orders) if "orders" not in errors else None
    out["bought_together"] = _pairs(orders) if "orders" not in errors else None
    variant = VARIANTS[_variant.get(store.store_url, 0)][0] if orders else None
    out["new_vs_returning"] = _new_vs_returning(orders) if variant in ("full", "journey") else None
    out["repeat_purchase"] = _repeat_by_first_product(orders) if variant == "full" else None
    out["customer_data"] = {
        "journey": variant in ("full", "journey"),
        "customers": variant == "full",
    }
    return out
