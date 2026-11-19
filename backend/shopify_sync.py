"""
Shopify -> PostgreSQL sync (real data).

- Products: saare products (title, product type, tags).
  Quilt pehchaan: title mein poora shabd "quilt" ho toh category = "Quilt"
  ("Quilted Cosmetic Bag" quilt nahi hai).
- Orders: pichhle `days` din ke orders, Shopify ke asli createdAt time ke saath.
  Test orders skip hote hain. Customer ka naam/email/address save NAHI hota.
- Dobara chalane par duplicate nahi banta (update hota hai).
"""

import re
import zlib
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from database import engine

import models
from shopify_client import graphql

QUILT_KEYWORD = "quilt"

SHOP_QUERY = """
{ shop { name currencyCode ianaTimezone } }
"""

PRODUCTS_QUERY = """
query Products($cursor: String) {
  products(first: 250, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id title handle productType tags }
  }
}
"""

ORDERS_QUERY = """
query Orders($cursor: String, $search: String) {
  orders(first: 40, after: $cursor, query: $search, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      createdAt
      cancelledAt
      test
      displayFinancialStatus
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      currentSubtotalPriceSet { shopMoney { amount } }
      currentTotalDiscountsSet { shopMoney { amount } }
      currentShippingPriceSet { shopMoney { amount } }
      currentTotalTaxSet { shopMoney { amount } }
      totalRefundedSet { shopMoney { amount } }
      lineItems(first: 20) {
        nodes {
          quantity
          originalUnitPriceSet { shopMoney { amount } }
          product { id }
        }
      }
    }
  }
}
"""


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


_QUILT_WORD = re.compile(r"\bquilts?\b")


def is_quilt(title: str, product_type: str, tags: list[str]) -> bool:
    # Title only, whole word "quilt": "Quilted Cosmetic Bag" / "Quilted Toiletry
    # Bag" aren't quilts, and some non-quilts (e.g. a table runner) carry the
    # product type or tag "Quilt" on this store.
    return bool(_QUILT_WORD.search((title or "").lower()))


def get_or_create_store(db: Session, shop: str) -> models.Store:
    info = graphql(shop, SHOP_QUERY)["shop"]
    store = db.query(models.Store).filter(models.Store.store_url == shop).first()
    if not store:
        store = models.Store(store_url=shop, store_name=info["name"], platform="shopify")
        db.add(store)
    store.store_name = info["name"]
    store.timezone = info["ianaTimezone"]
    store.currency = info["currencyCode"]
    db.commit()
    db.refresh(store)
    return store


def sync_products(db: Session, store: models.Store) -> dict:
    existing = {
        p.shopify_product_id: p
        for p in db.query(models.Product).filter(
            models.Product.store_id == store.id,
            models.Product.shopify_product_id.isnot(None),
        )
    }
    created = updated = quilt_count = 0
    cursor = None

    while True:
        data = graphql(store.store_url, PRODUCTS_QUERY, {"cursor": cursor})["products"]
        for node in data["nodes"]:
            tags = node.get("tags") or []
            product_type = node.get("productType") or ""
            quilt = is_quilt(node["title"], product_type, tags)
            quilt_count += quilt

            product = existing.get(node["id"])
            if not product:
                product = models.Product(store_id=store.id, shopify_product_id=node["id"])
                db.add(product)
                existing[node["id"]] = product
                created += 1
            else:
                updated += 1

            product.product_name = node["title"][:255]
            product.product_type = product_type[:255]
            product.tags = ", ".join(tags)
            product.handle = (node.get("handle") or "")[:255] or None
            product.category = "Quilt" if quilt else (product_type[:100] or None)

        db.commit()
        if not data["pageInfo"]["hasNextPage"]:
            break
        cursor = data["pageInfo"]["endCursor"]

    return {"created": created, "updated": updated, "quilt_products": quilt_count}


def sync_orders(db: Session, store: models.Store, days: int = 30) -> dict:
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    search = f"created_at:>='{since}'"

    product_map = {
        p.shopify_product_id: p.id
        for p in db.query(models.Product.id, models.Product.shopify_product_id).filter(
            models.Product.store_id == store.id,
            models.Product.shopify_product_id.isnot(None),
        )
    }

    created = updated = skipped_test = 0
    cursor = None

    while True:
        data = graphql(
            store.store_url, ORDERS_QUERY, {"cursor": cursor, "search": search}
        )["orders"]

        for node in data["nodes"]:
            if node.get("test"):
                skipped_test += 1
                continue

            order = (
                db.query(models.Order)
                .filter(
                    models.Order.store_id == store.id,
                    models.Order.shopify_order_id == node["id"],
                )
                .first()
            )
            if not order:
                order = models.Order(store_id=store.id, shopify_order_id=node["id"])
                db.add(order)
                created += 1
            else:
                updated += 1
                db.query(models.OrderItem).filter(
                    models.OrderItem.order_id == order.id
                ).delete()

            money = node["currentTotalPriceSet"]["shopMoney"]
            order.order_number = node["name"]
            order.total_amount = float(money["amount"])
            order.currency = money["currencyCode"]
            order.created_at = _parse_dt(node["createdAt"])
            order.cancelled_at = _parse_dt(node.get("cancelledAt"))
            order.financial_status = node.get("displayFinancialStatus")
            order.subtotal_amount = float(node["currentSubtotalPriceSet"]["shopMoney"]["amount"])
            order.total_discounts = float(node["currentTotalDiscountsSet"]["shopMoney"]["amount"])
            order.total_shipping = float(node["currentShippingPriceSet"]["shopMoney"]["amount"])
            order.total_tax = float(node["currentTotalTaxSet"]["shopMoney"]["amount"])
            order.total_refunded = float(node["totalRefundedSet"]["shopMoney"]["amount"])
            db.flush()  # order.id chahiye

            for item in node["lineItems"]["nodes"]:
                product = item.get("product")
                product_id = product_map.get(product["id"]) if product else None
                if not product_id:
                    continue  # deleted product / custom item
                db.add(
                    models.OrderItem(
                        order_id=order.id,
                        product_id=product_id,
                        quantity=item.get("quantity") or 1,
                        unit_price=float(item["originalUnitPriceSet"]["shopMoney"]["amount"]),
                    )
                )

        db.commit()
        if not data["pageInfo"]["hasNextPage"]:
            break
        cursor = data["pageInfo"]["endCursor"]

    return {"created": created, "updated": updated, "skipped_test_orders": skipped_test}


def _acquire_sync_lock(shop: str):
    """
    PostgreSQL advisory lock: ek store ka sync ek time par sirf ek jagah chale
    (scheduler, manual sync, ya do backend processes - sab safe).
    Returns lock connection, ya None agar sync pehle se chal raha hai.
    """
    if engine.dialect.name != "postgresql":
        return "no-lock"
    key = zlib.crc32(f"shopify-sync:{shop}".encode())
    conn = engine.connect()
    got = conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": key}).scalar()
    if not got:
        conn.close()
        return None
    conn.info["sync_lock_key"] = key
    return conn


def _release_sync_lock(conn):
    if conn in (None, "no-lock"):
        return
    try:
        conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": conn.info["sync_lock_key"]})
        conn.commit()
    finally:
        conn.close()


def sync_store(db: Session, shop: str, days: int = 30) -> dict:
    lock = _acquire_sync_lock(shop)
    if lock is None:
        return {"status": "skipped", "reason": "sync_already_running", "shop": shop}
    try:
        return _sync_store(db, shop, days)
    finally:
        _release_sync_lock(lock)


def _sync_store(db: Session, shop: str, days: int = 30) -> dict:
    try:
        store = get_or_create_store(db, shop)
        products = sync_products(db, store)
        orders = sync_orders(db, store, days=days)
        store.last_synced_at = datetime.now(timezone.utc)
        db.commit()
        return {
            "status": "success",
            "store_id": store.id,
            "store_name": store.store_name,
            "products": products,
            "orders": orders,
        }
    except Exception:
        db.rollback()
        raise
