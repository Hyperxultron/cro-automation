"""
Product and category analytics (manager checklist, section 4).

Finds winners and losers fairly:
  - 28-day window by default (enough data per product at ~70 orders/day).
  - Each product is compared with ITS OWN CATEGORY, not the store average
    (quilts convert lower than cushion covers because of price).
  - Small-sample adjustment so a lucky low-traffic product doesn't top the list:
        adjusted rate = (purchases + 200 x category rate) / (views + 200)
  - Four groups:
        Stars        many views, high conversion -> keep in stock, use in ads
        Hidden gems  few views,  high conversion -> send more traffic
        Leaky        many views, low conversion  -> fix the product page first
        Dead weight  few views,  low conversion  -> rework or drop
  - Fix-first list for Leaky products, ranked by revenue left on the table:
        views x (category rate - product rate) x price

Data sources:
  - purchases / revenue / price: our synced orders (orders that include the
    product, cancelled orders excluded).
  - views / add-to-cart: Shopify Analytics, via `fetch_product_views`. Until
    that source is confirmed for this store, view-based columns and the four
    groups are reported as unavailable - never estimated.
"""

from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from overview import _day_bounds_utc, _tz

PRIOR_VIEWS = 200  # the "200" in the checklist's small-sample adjustment

# Many products have no Shopify product type, which left "—" as their
# category. Fall back to the product family in the title so each product is
# compared with similar products.
TITLE_CATEGORIES = [
    ("quilt", "Quilt"),
    ("tablecloth", "Tablecloth"),
    ("napkin", "Napkins"),
    ("table runner", "Table Runner"),
    ("runner", "Table Runner"),
    ("placemat", "Placemats"),
    ("pillow cover", "Pillow Cover"),
    ("cushion", "Cushion"),
    ("pillow insert", "Pillow Insert"),
    ("tissue box", "Tissue Box Cover"),
    ("curtain", "Curtain"),
    ("towel", "Kitchen Towel"),
    ("ornament", "Ornament"),
    ("tree skirt", "Tree Skirt"),
]


def product_category(name: str | None, category: str | None) -> str:
    title = (name or "").lower()
    # Title wins for the families above: Shopify product types on this store
    # are inconsistent (e.g. a table runner typed as "Quilt").
    for keyword, label in TITLE_CATEGORIES:
        if keyword in title:
            return label
    if category and category.strip():
        return category.strip().title()
    return "Other"


def fetch_product_views(store: models.Store, days: int) -> dict[str, dict] | None:
    """
    {shopify_product_id: {"views": int, "cart_adds": int}} for the window, or
    None when per-product views aren't available from Shopify for this store.

    Placeholder until the exact Shopify Analytics query for per-product views
    is confirmed against the store's own report - returning None keeps the
    page honest (view-based columns show as unavailable).
    """
    return None


def _sales_by_product(db: Session, store: models.Store, start, end) -> list[dict]:
    rows = (
        db.query(
            models.Product.id,
            models.Product.shopify_product_id,
            models.Product.product_name,
            models.Product.category,
            func.count(func.distinct(models.Order.id)).label("orders"),
            func.coalesce(func.sum(models.OrderItem.quantity), 0).label("qty"),
            func.coalesce(func.sum(models.OrderItem.quantity * models.OrderItem.unit_price), 0).label("revenue"),
        )
        .join(models.OrderItem, models.OrderItem.product_id == models.Product.id)
        .join(models.Order, models.Order.id == models.OrderItem.order_id)
        .filter(
            models.Order.store_id == store.id,
            models.Order.cancelled_at.is_(None),
            models.Order.created_at >= start,
            models.Order.created_at < end,
        )
        .group_by(models.Product.id, models.Product.shopify_product_id, models.Product.product_name, models.Product.category)
        .all()
    )
    return [
        {
            "product_id": pid,
            "shopify_product_id": spid,
            "name": name,
            "category": product_category(name, category),
            "orders": int(orders),
            "quantity": int(qty),
            "revenue": round(float(revenue), 2),
            "price": round(float(revenue) / int(qty), 2) if qty else None,
        }
        for pid, spid, name, category, orders, qty, revenue in rows
    ]


def _window(store: models.Store, days: int, end_days_ago: int = 0):
    tz = _tz(store)
    last_day = datetime.now(tz).date() - timedelta(days=1 + end_days_ago)
    first_day = last_day - timedelta(days=days - 1)
    start, _ = _day_bounds_utc(first_day, tz)
    _, end = _day_bounds_utc(last_day, tz)
    return first_day, last_day, start, end


def _median(values: list[float]) -> float:
    s = sorted(values)
    if not s:
        return 0.0
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2


def classify(products: list[dict]) -> None:
    """
    Adds category rates, adjusted rate, group and revenue-left-on-table to
    products that have `views`. Mutates in place.
    """
    by_cat: dict[str, dict] = {}
    for p in products:
        c = by_cat.setdefault(p["category"], {"views": 0, "orders": 0})
        c["views"] += p["views"]
        c["orders"] += p["orders"]
    for c in by_cat.values():
        c["rate"] = c["orders"] / c["views"] if c["views"] else 0.0
    # Price for products that sold nothing in the window: the category's
    # average selling price, so their revenue left on the table isn't 0.
    cat_prices: dict[str, list[float]] = {}
    for p in products:
        if p["price"]:
            cat_prices.setdefault(p["category"], []).append(p["price"])

    # "Many views" = at or above the median views of products in the same
    # category, so a quilt isn't judged against napkin traffic.
    cat_view_medians = {
        cat: _median([p["views"] for p in products if p["category"] == cat]) for cat in by_cat
    }

    for p in products:
        cat_rate = by_cat[p["category"]]["rate"]
        views = p["views"]
        raw_rate = p["orders"] / views if views else 0.0
        adjusted = (p["orders"] + PRIOR_VIEWS * cat_rate) / (views + PRIOR_VIEWS)
        many_views = views >= cat_view_medians[p["category"]] and views > 0
        high_conv = adjusted >= cat_rate
        if many_views and high_conv:
            group = "star"
        elif not many_views and high_conv:
            group = "hidden_gem"
        elif many_views:
            group = "leaky"
        else:
            group = "dead_weight"
        left_on_table = (
            round(views * (cat_rate - raw_rate) * (p["price"] or _median(cat_prices.get(p["category"], []))), 2)
            if group == "leaky" and cat_rate > raw_rate else 0.0
        )
        p.update(
            {
                "view_to_purchase_rate": round(raw_rate * 100, 2) if views else None,
                "adjusted_rate": round(adjusted * 100, 2),
                "category_rate": round(cat_rate * 100, 2),
                "vs_category_pts": round((adjusted - cat_rate) * 100, 2),
                "group": group,
                "revenue_left_on_table": left_on_table,
            }
        )


def fetch_product_analytics(db: Session, store: models.Store, days: int = 28) -> dict:
    first_day, last_day, start, end = _window(store, days)
    p_first, p_last, p_start, p_end = _window(store, days, end_days_ago=days)

    products = _sales_by_product(db, store, start, end)
    prior = {p["product_id"]: p for p in _sales_by_product(db, store, p_start, p_end)}

    views = fetch_product_views(store, days)
    views_available = views is not None

    if views_available:
        # Products that were viewed but sold nothing belong in the table too
        # (they're often the Leaky / Dead weight ones).
        sold = {p["shopify_product_id"] for p in products}
        missing = [spid for spid, v in views.items() if spid not in sold and v.get("views")]
        if missing:
            for row in db.query(models.Product).filter(
                models.Product.store_id == store.id, models.Product.shopify_product_id.in_(missing)
            ):
                products.append({
                    "product_id": row.id, "shopify_product_id": row.shopify_product_id,
                    "name": row.product_name, "category": product_category(row.product_name, row.category),
                    "orders": 0, "quantity": 0, "revenue": 0.0, "price": None,
                })

    for p in products:
        prev = prior.get(p["product_id"])
        p["prior_revenue"] = prev["revenue"] if prev else 0.0
        p["revenue_change_pct"] = (
            round((p["revenue"] - prev["revenue"]) / prev["revenue"] * 100, 1) if prev and prev["revenue"] else None
        )
        v = (views or {}).get(p["shopify_product_id"] or "") if views_available else None
        p["views"] = v["views"] if v else (0 if views_available else None)
        p["cart_adds"] = v["cart_adds"] if v else (0 if views_available else None)
        if views_available:
            p["add_to_cart_rate"] = round(p["cart_adds"] / p["views"] * 100, 2) if p["views"] else None
            p["cart_to_purchase_rate"] = round(p["orders"] / p["cart_adds"] * 100, 2) if p["cart_adds"] else None
            p["revenue_per_view"] = round(p["revenue"] / p["views"], 2) if p["views"] else None

    if views_available:
        classify(products)

    # Category roll-up (checklist P2, cheap to add): revenue, orders, products.
    categories: dict[str, dict] = {}
    for p in products:
        c = categories.setdefault(p["category"], {"category": p["category"], "products": 0, "orders": 0, "revenue": 0.0, "prior_revenue": 0.0})
        c["products"] += 1
        c["orders"] += p["orders"]
        c["revenue"] = round(c["revenue"] + p["revenue"], 2)
        c["prior_revenue"] = round(c["prior_revenue"] + p["prior_revenue"], 2)
    for c in categories.values():
        c["revenue_change_pct"] = (
            round((c["revenue"] - c["prior_revenue"]) / c["prior_revenue"] * 100, 1) if c["prior_revenue"] else None
        )

    fix_first = (
        sorted(
            (p for p in products if p.get("group") == "leaky" and p["revenue_left_on_table"] > 0),
            key=lambda p: p["revenue_left_on_table"],
            reverse=True,
        )[:10]
        if views_available else []
    )
    products.sort(key=lambda p: p["revenue"], reverse=True)

    return {
        "days": days,
        "window_label": f"{first_day.strftime('%d %b')} - {last_day.strftime('%d %b')} (last {days} complete days)",
        "prior_window_label": f"{p_first.strftime('%d %b')} - {p_last.strftime('%d %b')}",
        "views_available": views_available,
        "views_note": None if views_available else (
            "Product views and add-to-cart by product aren't connected yet, so the four groups and the "
            "fix-first list are waiting on that data. Orders and revenue below are real."
        ),
        "products": products,
        "categories": sorted(categories.values(), key=lambda c: c["revenue"], reverse=True),
        "fix_first": fix_first,
    }
