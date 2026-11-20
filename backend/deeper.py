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
    }
  }
}
"""

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

    def load():
        out, cursor = [], None
        for _ in range(400):  # 20,000 orders max
            data = graphql(store.store_url, ORDERS_QUERY, {"cursor": cursor, "search": search})["orders"]
            for n in data["nodes"]:
                if n.get("test") or n.get("cancelledAt"):
                    continue
                prods = {}
                for li in n["lineItems"]["nodes"]:
                    p = li.get("product")
                    if p:
                        prods[p["id"]] = p["title"]
                out.append({
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
    return out
