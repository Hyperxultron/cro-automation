"""
Manual Shopify sync chalane ke liye.

Run:  python run_sync.py
       python run_sync.py 60      (pichhle 60 din ke orders)
"""

import os
import sys

from database import SessionLocal
from shopify_sync import sync_store
import models

SHOP = os.getenv("SHOPIFY_SHOP", "guz0he-21.myshopify.com")
DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 30

print(f"Syncing {SHOP} (last {DAYS} days of orders)... thoda time lagega")

db = SessionLocal()
try:
    result = sync_store(db, SHOP, days=DAYS)
    print(result)

    store_id = result["store_id"]
    print("\nQuilt products (first 15) - check karo sahi pehchane gaye:")
    quilts = (
        db.query(models.Product.product_name, models.Product.product_type)
        .filter(models.Product.store_id == store_id, models.Product.category == "Quilt")
        .limit(15)
        .all()
    )
    for name, ptype in quilts:
        print(f"  - {name}  [{ptype}]")
finally:
    db.close()
