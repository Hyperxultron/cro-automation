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
  - views: Microsoft Clarity product-page sessions (bots removed), saved once
    a day (clarity.py). Conversion = orders / views over the SAME days that
    have Clarity data, so a 3-day views total is never divided into 28 days
    of orders. No Clarity data -> view-based columns and the four groups are
    reported as unavailable - never estimated. Per-product add-to-cart isn't
    available from Shopify or Clarity, so it's not shown.
"""

import logging
import time
from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from overview import _day_bounds_utc, _tz
from shopify_client import graphql

logger = logging.getLogger("product_groups")

SHOPIFYQL = """
query Q($q: String!) {
  shopifyqlQuery(query: $q) {
    tableData { columns { name dataType } rows }
    parseErrors
  }
}
"""
CACHE_SECONDS = 600
_cache: dict = {}
SALES_METRICS = ["net_items_sold", "gross_sales", "discounts", "sales_reversals", "net_sales", "total_sales"]

PRIOR_VIEWS = 200  # the "200" in the checklist's small-sample adjustment

# Many products have no Shopify product type, which left "—" as their
# category. Fall back to the product family in the title so each product is
# compared with similar products.
TITLE_CATEGORIES = [
    # Bags first: "Quilted Cosmetic Bag" / "Quilted Toiletry Bag" are not quilts.
    ("cosmetic bag", "Bags"),
    ("toiletry bag", "Bags"),
    (" bag", "Bags"),
    ("coaster", "Coaster"),
    ("picture frame", "Picture Frame"),
    ("sticky note", "Sticky Note Holder"),
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


MIN_VIEW_DAYS = 3  # fewer saved Clarity days than this -> groups not shown yet


def fetch_product_views(db: Session, store: models.Store, first_day, last_day) -> dict | None:
    """
    Product page views from Microsoft Clarity (see clarity.py), or None when
    Clarity isn't connected yet. Shopify Analytics itself has no per-product
    page views (confirmed with Shopify Sidekick).
    """
    from clarity import product_views

    return product_views(db, store, first_day, last_day)


def _num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


_last_sales_error: str | None = None


def _shopify_window_sales(store: models.Store, first_day, last_day) -> dict[str, dict] | None:
    """
    {product_title: {net_items_sold, gross_sales, discounts, sales_reversals,
    net_sales, total_sales, orders?}} for first_day..last_day (store dates),
    straight from Shopify Analytics - the same numbers as Shopify's own "Total
    sales by product" report. None if Shopify refuses every query variant (the
    page then falls back to our synced orders and shows why).
    """
    global _last_sales_error
    key = (store.store_url, first_day.isoformat(), last_day.isoformat())
    cached = _cache.get(key)
    if cached and cached[0] > time.time():
        return cached[1]

    result = None
    errors: list[str] = []
    # Try the richest query first; drop parts Shopify rejects. Rows without a
    # product title (e.g. custom items) are skipped below either way.
    variants = [
        (SALES_METRICS + ["orders"], "WHERE product_title IS NOT NULL "),
        (SALES_METRICS, "WHERE product_title IS NOT NULL "),
        (SALES_METRICS, ""),
    ]
    for metrics, where in variants:
        q = (
            f"FROM sales SHOW {', '.join(metrics)} {where}"
            f"GROUP BY product_title SINCE {first_day.isoformat()} UNTIL {last_day.isoformat()} "
            "ORDER BY net_sales DESC LIMIT 1000"
        )
        try:
            data = graphql(store.store_url, SHOPIFYQL, {"q": q})["shopifyqlQuery"]
        except Exception as exc:
            logger.exception("Shopify sales-by-product query failed")
            errors.append(str(exc)[:300])
            break
        if not data:
            errors.append("empty shopifyqlQuery response")
            continue
        if data.get("parseErrors"):
            logger.warning("ShopifyQL sales-by-product parse errors: %s", data["parseErrors"])
            errors.append(str(data["parseErrors"])[:300])
            continue
        result = {}
        for row in (data.get("tableData") or {}).get("rows") or []:
            title = row.get("product_title")
            if not title:
                continue
            entry = result.setdefault(str(title), {m: 0.0 for m in metrics})
            for m in metrics:
                entry[m] += _num(row.get(m))
        break

    _last_sales_error = None if result is not None else ("; ".join(errors) or "unknown error")
    # Don't keep a failure around for long - retry after a minute.
    _cache[key] = (time.time() + (CACHE_SECONDS if result is not None else 60), result)
    return result


def _merge_shopify_sales(db: Session, store: models.Store, db_rows: list[dict], shop: dict[str, dict]) -> list[dict]:
    """Shopify's per-product sales numbers, joined to our products by title."""
    by_title = {r["name"]: r for r in db_rows}
    known = {
        p.product_name: p
        for p in db.query(models.Product).filter(models.Product.store_id == store.id, models.Product.product_name.in_(list(shop)))
    } if shop else {}
    out = []
    for i, (title, v) in enumerate(shop.items()):
        base = by_title.get(title)
        prod = known.get(title)
        qty = int(round(v.get("net_items_sold", 0)))
        net = round(v.get("net_sales", 0.0), 2)
        out.append({
            "product_id": base["product_id"] if base else (prod.id if prod else -(i + 1)),
            "shopify_product_id": base["shopify_product_id"] if base else (prod.shopify_product_id if prod else None),
            "name": title,
            "category": base["category"] if base else product_category(title, prod.category if prod else None),
            # Orders that include the product: Shopify's count when it gives one, else ours.
            "orders": int(round(v["orders"])) if "orders" in v else (base["orders"] if base else 0),
            "quantity": qty,
            "gross_sales": round(v.get("gross_sales", 0.0), 2),
            "discounts": round(v.get("discounts", 0.0), 2),
            "sales_reversals": round(v.get("sales_reversals", 0.0), 2),
            "net_sales": net,
            "total_sales": round(v.get("total_sales", 0.0), 2),
            "revenue": net,
            "price": round(net / qty, 2) if qty > 0 else None,
        })
    return out


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
        c["orders"] += p.get("view_orders", p["orders"])
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
        orders = p.get("view_orders", p["orders"])
        raw_rate = orders / views if views else 0.0
        adjusted = (orders + PRIOR_VIEWS * cat_rate) / (views + PRIOR_VIEWS)
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
    prior_rows = _sales_by_product(db, store, p_start, p_end)

    # Prefer Shopify's own per-product sales so numbers match Shopify's
    # "Total sales by product" report exactly (net sales, net items sold).
    cur = _shopify_window_sales(store, first_day, last_day)
    sales_source = "orders_db"
    if cur:
        products = _merge_shopify_sales(db, store, products, cur)
        prev_shop = _shopify_window_sales(store, p_first, p_last)
        if prev_shop is not None:
            prior_rows = _merge_shopify_sales(db, store, prior_rows, prev_shop)
        sales_source = "shopify"
    prior = {p["name"]: p for p in prior_rows}

    clarity = fetch_product_views(db, store, first_day, last_day)
    view_days = clarity["days"] if clarity else []
    views = clarity["by_product"] if clarity else None
    views_available = views is not None and len(view_days) >= MIN_VIEW_DAYS

    # Orders over exactly the days that have view data (for conversion).
    conv_orders: dict[str, int] = {}
    if views_available:
        tz = _tz(store)
        v_start, _ = _day_bounds_utc(view_days[0], tz)
        _, v_end = _day_bounds_utc(view_days[-1], tz)
        for r in _sales_by_product(db, store, v_start, v_end):
            if r["shopify_product_id"]:
                conv_orders[r["shopify_product_id"]] = r["orders"]

        # Products that were viewed but sold nothing belong in the table too
        # (they're often the Leaky / Dead weight ones).
        sold = {p["shopify_product_id"] for p in products}
        missing = [spid for spid, v in views.items() if spid not in sold and v]
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
        prev = prior.get(p["name"])
        p["prior_revenue"] = prev["revenue"] if prev else 0.0
        p["revenue_change_pct"] = (
            round((p["revenue"] - prev["revenue"]) / prev["revenue"] * 100, 1) if prev and prev["revenue"] else None
        )
        spid = p["shopify_product_id"] or ""
        p["views"] = views.get(spid, 0) if views_available else None
        p["cart_adds"] = None
        p["add_to_cart_rate"] = None
        p["cart_to_purchase_rate"] = None
        if views_available:
            p["view_orders"] = conv_orders.get(spid, 0)

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
        "sales_source": sales_source,
        "sales_note": (
            "Net sales = gross sales − discounts − sales reversals (refunds), per product, from Shopify Analytics - "
            "same as Shopify's \"Total sales by product\" report."
            if sales_source == "shopify" else
            "Revenue = product price × quantity from synced orders (before order discounts, refunds, shipping and tax). "
            "Shopify's per-product sales report couldn't be reached, so these may differ slightly from Shopify."
            + (f" (Shopify said: {_last_sales_error})" if _last_sales_error else "")
        ),
        "views_available": views_available,
        "views_source": "clarity" if views_available else None,
        "views_days": len(view_days),
        "views_window_label": (
            f"{view_days[0].strftime('%d %b')} - {view_days[-1].strftime('%d %b')} ({len(view_days)} days of Clarity data)"
            if view_days else None
        ),
        "views_note": (
            f"Views = people (not bots) who opened the product page, from Microsoft Clarity, for "
            f"{len(view_days)} day(s). Conversion uses orders from those same days. "
            + ("Groups get more reliable as more days are collected (best after 14+ days)." if len(view_days) < 14 else "")
            if views_available else
            f"Microsoft Clarity is connected and collecting product views ({len(view_days)} of {MIN_VIEW_DAYS} days so far). "
            "The four groups and the fix-first list appear once there are enough days. Orders and sales below are real."
            if view_days else
            "Product views aren't connected yet (they come from Microsoft Clarity, because Shopify has no per-product "
            "page views). Until then the four groups and the fix-first list are waiting on that data. Orders and sales below are real."
        ),
        "products": products,
        "categories": sorted(categories.values(), key=lambda c: c["revenue"], reverse=True),
        "fix_first": fix_first,
    }
