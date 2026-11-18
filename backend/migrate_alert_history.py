"""
Migration: alert_history table mein 2 naye columns jodta hai.
  - store_id    -> alert kis store ka hai (stores.id se link)
  - resolved_at -> alert kab band (resolve) hua

Safe hai:
  - Sirf ADD COLUMN IF NOT EXISTS use karta hai (koi data delete nahi hota)
  - Do baar chalane par bhi koi problem nahi
  - Purani rows ka store_id / resolved_at NULL rahega
"""

from sqlalchemy import text

from database import engine

with engine.begin() as connection:
    connection.execute(text("""
        ALTER TABLE alert_history
        ADD COLUMN IF NOT EXISTS store_id INTEGER REFERENCES stores(id),
        ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
    """))

    connection.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_alert_history_store_rule
        ON alert_history (store_id, alarm_rule_id);
    """))

print("alert_history table updated successfully!")

# ---- Read-only check: timestamp columns timezone-aware hain ya nahi ----
print("\n=== Timestamp column types ===")
with engine.connect() as connection:
    rows = connection.execute(text("""
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND data_type LIKE 'timestamp%'
        ORDER BY table_name, column_name;
    """))
    for table_name, column_name, data_type in rows:
        print(f"  {table_name}.{column_name}: {data_type}")

    print("\n=== alert_history columns now ===")
    rows = connection.execute(text("""
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'alert_history'
        ORDER BY ordinal_position;
    """))
    for column_name, data_type in rows:
        print(f"  - {column_name}: {data_type}")
