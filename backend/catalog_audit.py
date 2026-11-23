"""
Catalog audit for the CRO Recommendations engine (read-only).

Pulls what the product PAGES actually contain, so recommendations can say
"this product has 1 photo, 40 words and 3 reviews" instead of "improve the
page":

  fetch_catalog(store)        every active product: type, photos, videos,
                              description words, variants (price, compare-at,
                              stock), review count + rating (Judge.me / any
                              app that writes Shopify's standard `reviews`
                              metafields)
  fetch_variant_sales(store)  units sold per product + variant (ShopifyQL)
                              - which size people actually buy
  fetch_delivery(store)       days from order to fulfilment / delivery for
                              recent orders - what the delivery promise
                              really is

Each part fails on its own (e.g. a missing API scope) and the engine then
just skips the items that need it.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timedelta, timezone

import models
from shopify_client import graphql

logger = logging.getLogger("catalog_audit")

_cache: dict = {}
CATALOG_TTL = 6 * 3600
SALES_TTL = 1800
DELIVERY_TTL = 3 * 3600

CATALOG_QUERY = """
query CatalogAudit($cursor: String) {
  products(first: 25, after: $cursor, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      handle
      productType
      tracksInventory
      totalInventory
      description
      media(first: 15) { nodes { mediaContentType } }
      variants(first: 12) {
        nodes { title price compareAtPrice inventoryQuantity availableForSale }
      }
      ratingCount: metafield(namespace: "reviews", key: "rating_count") { value }
      rating: metafield(namespace: "reviews", key: "rating") { value }
    }
  }
}
"""

DELIVERY_QUERY = """
query DeliveryAudit($cursor: String, $search: String) {
  orders(first: 100, after: $cursor, query: $search, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      createdAt
      test
      cancelledAt
      shippingAddress { countryCodeV2 }
      fulfillments(first: 3) { createdAt inTransitAt deliveredAt }
    }
  }
}
"""


def _cached(key, ttl, fn):
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    val = fn()
    _cache[key] = (time.time() + ttl, val)
    return val


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _rating(raw) -> float | None:
    """Shopify's `rating` metafield is JSON like {"value": "4.6", "scale_min": "1.0", ...}."""
    if not raw:
        return None
    m = re.search(r'"value"\s*:\s*"?([0-9.]+)', raw)
    return _f(m.group(1)) if m else _f(raw)


# If the app lacks a scope (inventory, metafields), Shopify refuses the whole
# query, so step down to smaller ones and leave those fields empty.
CATALOG_VARIANTS = [
    CATALOG_QUERY,
    CATALOG_QUERY.replace("inventoryQuantity ", ""),
    CATALOG_QUERY.replace("inventoryQuantity ", "")
    .replace('ratingCount: metafield(namespace: "reviews", key: "rating_count") { value }', "")
    .replace('rating: metafield(namespace: "reviews", key: "rating") { value }', ""),
]


def fetch_catalog(store: models.Store) -> list[dict]:
    def page(cursor, level):
        for i in range(level, len(CATALOG_VARIANTS)):
            try:
                return graphql(store.store_url, CATALOG_VARIANTS[i], {"cursor": cursor})["products"], i
            except Exception as exc:
                if i == len(CATALOG_VARIANTS) - 1:
                    raise
                logger.warning("Catalog query level %s refused, trying a smaller one: %s", i, exc)
        raise RuntimeError("unreachable")

    def load():
        out, cursor, level = [], None, 0
        for _ in range(60):  # 1,500 products max
            data, level = page(cursor, level)
            for n in data["nodes"]:
                media = [m.get("mediaContentType") for m in (n.get("media") or {}).get("nodes") or []]
                variants = []
                for v in (n.get("variants") or {}).get("nodes") or []:
                    variants.append({
                        "title": v.get("title"),
                        "price": _f(v.get("price")),
                        "compare_at": _f(v.get("compareAtPrice")),
                        "inventory": v.get("inventoryQuantity"),
                        "available": bool(v.get("availableForSale")),
                    })
                words = len(re.findall(r"\w+", n.get("description") or ""))
                rc = (n.get("ratingCount") or {}).get("value")
                out.append({
                    "id": n["id"],
                    "title": n["title"],
                    "handle": n["handle"],
                    "product_type": (n.get("productType") or "").strip(),
                    "tracks_inventory": bool(n.get("tracksInventory")),
                    "images": sum(1 for m in media if m == "IMAGE"),
                    "videos": sum(1 for m in media if m in ("VIDEO", "EXTERNAL_VIDEO")),
                    "words": words,
                    "variants": variants,
                    "review_count": int(_f(rc)) if rc is not None and _f(rc) is not None else None,
                    "rating": _rating((n.get("rating") or {}).get("value")),
                })
            if not data["pageInfo"]["hasNextPage"]:
                break
            cursor = data["pageInfo"]["endCursor"]
        return out

    return _cached(("catalog", store.store_url), CATALOG_TTL, load)


def fetch_variant_sales(store: models.Store, first, last) -> dict[str, dict[str, int]]:
    """{product title: {variant title: net items sold}} for the window."""
    from landing import _i, _run, _since

    def load():
        rows = _run(store, "FROM sales SHOW net_items_sold GROUP BY product_title, product_variant_title "
                           f"{_since(first, last)} ORDER BY net_items_sold DESC LIMIT 1000")
        out: dict[str, dict[str, int]] = {}
        for r in rows:
            p, v = r.get("product_title"), r.get("product_variant_title")
            if not p:
                continue
            n = _i(r.get("net_items_sold"))
            if n > 0:
                out.setdefault(str(p), {})[str(v or "Default Title")] = n
        return out

    return _cached(("varsales", store.store_url, first.isoformat(), last.isoformat()), SALES_TTL, load)


def _pctile(xs: list[float], q: float) -> float | None:
    if not xs:
        return None
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))]


def fetch_delivery(store: models.Store, days: int = 60) -> dict | None:
    """Order -> first fulfilment and order -> delivered, in days, for orders
    placed `days`..14 days ago (recent orders haven't had time to arrive)."""

    def load():
        now = datetime.now(timezone.utc)
        start = (now - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
        end = (now - timedelta(days=14)).strftime("%Y-%m-%dT%H:%M:%SZ")
        search = f"created_at:>='{start}' created_at:<'{end}'"
        to_ship, to_deliver, unfulfilled, total, us_deliver = [], [], 0, 0, []
        cursor = None
        for _ in range(10):  # 1,000 orders is plenty for a distribution
            data = graphql(store.store_url, DELIVERY_QUERY, {"cursor": cursor, "search": search})["orders"]
            for o in data["nodes"]:
                if o.get("test") or o.get("cancelledAt"):
                    continue
                total += 1
                created = datetime.fromisoformat(o["createdAt"].replace("Z", "+00:00"))
                fs = o.get("fulfillments") or []
                if not fs:
                    unfulfilled += 1
                    continue
                f0 = min(fs, key=lambda f: f["createdAt"])
                to_ship.append((datetime.fromisoformat(f0["createdAt"].replace("Z", "+00:00")) - created).total_seconds() / 86400)
                delivered = [f["deliveredAt"] for f in fs if f.get("deliveredAt")]
                if delivered:
                    d = (datetime.fromisoformat(max(delivered).replace("Z", "+00:00")) - created).total_seconds() / 86400
                    to_deliver.append(d)
                    if ((o.get("shippingAddress") or {}).get("countryCodeV2")) == "US":
                        us_deliver.append(d)
            if not data["pageInfo"]["hasNextPage"]:
                break
            cursor = data["pageInfo"]["endCursor"]
        if not total:
            return None
        r = lambda x: round(x, 1) if x is not None else None  # noqa: E731
        dl = us_deliver if len(us_deliver) >= 30 else to_deliver
        return {
            "orders": total,
            "window_label": f"orders placed {days} to 14 days ago",
            "unfulfilled_after_14d": unfulfilled,
            "ship_median": r(_pctile(to_ship, 0.5)),
            "ship_p90": r(_pctile(to_ship, 0.9)),
            "deliver_orders": len(dl),
            "deliver_scope": "US orders" if dl is us_deliver else "all orders",
            "deliver_median": r(_pctile(dl, 0.5)),
            "deliver_p75": r(_pctile(dl, 0.75)),
            "deliver_p90": r(_pctile(dl, 0.9)),
            "deliver_over_14_share": round(sum(1 for d in dl if d > 14) / len(dl) * 100, 1) if dl else None,
            "deliver_over_21_share": round(sum(1 for d in dl if d > 21) / len(dl) * 100, 1) if dl else None,
        }

    return _cached(("delivery", store.store_url, days), DELIVERY_TTL, load)
