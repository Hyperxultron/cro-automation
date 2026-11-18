"""
READ-ONLY database inspection script.
Yeh script database mein kuch bhi change nahi karti.
Sirf tables, columns, constraints aur row counts print karti hai.
Koi password ya token print nahi hota.
"""

from sqlalchemy import inspect, text

from database import engine

TABLES = ["stores", "products", "orders", "order_items", "alarm_rules", "alert_history"]

inspector = inspect(engine)
existing = inspector.get_table_names()

print("\n=== Tables in database ===")
print(", ".join(sorted(existing)) or "(none)")

with engine.connect() as conn:
    for table in TABLES:
        print(f"\n=== {table} ===")
        if table not in existing:
            print("  (table does not exist)")
            continue

        for col in inspector.get_columns(table):
            nullable = "NULL" if col["nullable"] else "NOT NULL"
            print(f"  - {col['name']}: {col['type']} {nullable}")

        for uc in inspector.get_unique_constraints(table):
            print(f"  UNIQUE: {uc['column_names']}")
        for idx in inspector.get_indexes(table):
            if idx.get("unique"):
                print(f"  UNIQUE INDEX: {idx['column_names']}")
        for fk in inspector.get_foreign_keys(table):
            print(f"  FK: {fk['constrained_columns']} -> {fk['referred_table']}")

        count = conn.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar()
        print(f"  ROWS: {count}")

    print("\n=== alarm_rules (id, title, threshold, is_active) ===")
    if "alarm_rules" in existing:
        for row in conn.execute(text(
            "SELECT id, title, threshold, is_active FROM alarm_rules ORDER BY id"
        )):
            print(f"  {tuple(row)}")

    print("\n=== stores (id, store_name, store_url, has_token) ===")
    if "stores" in existing:
        for row in conn.execute(text(
            "SELECT id, store_name, store_url, "
            "(access_token_encrypted IS NOT NULL) AS has_token FROM stores ORDER BY id"
        )):
            print(f"  {tuple(row)}")

print("\nDone. (read-only, nothing was changed)")
