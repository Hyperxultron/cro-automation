from sqlalchemy import text
from database import engine

with engine.begin() as connection:
    connection.execute(text("""
        ALTER TABLE stores
        ADD COLUMN IF NOT EXISTS access_token_encrypted TEXT,
        ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT,
        ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS refresh_token_expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS scopes TEXT;
    """))

print("Store table updated successfully!")