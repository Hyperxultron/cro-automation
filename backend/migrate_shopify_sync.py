"""
Migration: Shopify real-data sync ke liye naye columns jodta hai.

Safe hai:
  - Sirf ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
  - Koi data ya column delete nahi hota
  - Do baar chalane par bhi koi problem nahi
"""

from sqlalchemy import text

from database import engine

STATEMENTS = [
    # stores: store ka timezone aur currency (reporting dates ke liye zaroori)
    """
    ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS timezone VARCHAR(64),
    ADD COLUMN IF NOT EXISTS currency VARCHAR(10),
    ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
    """,
    # products: Shopify ID, product type, tags
    """
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS shopify_product_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS product_type VARCHAR(255),
    ADD COLUMN IF NOT EXISTS tags TEXT;
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS ux_products_store_shopify_id
    ON products (store_id, shopify_product_id);
    """,
    # orders: Shopify ID, payment status, cancel time, currency
    """
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS shopify_order_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS financial_status VARCHAR(50),
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS currency VARCHAR(10);
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_store_shopify_id
    ON orders (store_id, shopify_order_id);
    """,
    """
    CREATE INDEX IF NOT EXISTS ix_orders_store_created
    ON orders (store_id, created_at);
    """,
]

with engine.begin() as connection:
    for statement in STATEMENTS:
        connection.execute(text(statement))

print("Shopify sync columns added successfully!")
