"""
Saari migrations ek jagah - startup par apne aap chalti hain (Render ke liye).

Safe hai: sirf tables/columns CREATE/ADD karta hai agar maujood nahi hain.
Koi data ya column kabhi delete nahi hota. Baar baar chalana bhi safe hai.
"""

import logging

from sqlalchemy import text

import models
from database import Base, engine

logger = logging.getLogger("migrations")

STATEMENTS = [
    """
    ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS access_token_encrypted TEXT,
    ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT,
    ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS refresh_token_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS scopes TEXT,
    ADD COLUMN IF NOT EXISTS timezone VARCHAR(64),
    ADD COLUMN IF NOT EXISTS currency VARCHAR(10),
    ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
    """,
    """
    ALTER TABLE alert_history
    ADD COLUMN IF NOT EXISTS store_id INTEGER REFERENCES stores(id),
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
    """,
    "CREATE INDEX IF NOT EXISTS ix_alert_history_store_rule ON alert_history (store_id, alarm_rule_id);",
    """
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS shopify_product_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS product_type VARCHAR(255),
    ADD COLUMN IF NOT EXISTS tags TEXT;
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_products_store_shopify_id ON products (store_id, shopify_product_id);",
    """
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS shopify_order_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS financial_status VARCHAR(50),
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS currency VARCHAR(10);
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_store_shopify_id ON orders (store_id, shopify_order_id);",
    "CREATE INDEX IF NOT EXISTS ix_orders_store_created ON orders (store_id, created_at);",
    """
    ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS notification_email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS email_alerts_enabled BOOLEAN DEFAULT TRUE;
    """,
    "ALTER TABLE alarm_rules ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;",
]


def run_migrations():
    # Pehle saari tables bana do (fresh database - jaise Render ka naya Postgres)
    Base.metadata.create_all(bind=engine)

    # Phir purane columns jo create_all nahi jodta, unhe ADD COLUMN se jodo
    with engine.begin() as connection:
        for statement in STATEMENTS:
            connection.execute(text(statement))

    logger.info("Migrations applied successfully")
