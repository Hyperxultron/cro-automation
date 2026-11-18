"""
READ-ONLY Shopify connection test (client credentials grant).

Backend apne client ID + secret (.env se) se seedha Shopify se access token
leta hai - frontend / Cloudflare tunnel ki zaroorat nahi.
Yeh sirf store ka naam, scopes aur 3 latest orders/products count print karta hai.
Koi token ya secret print NAHI hota. Database mein kuch save nahi hota.

Run:  python shopify_token_test.py
"""

import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

SHOP = os.getenv("SHOPIFY_SHOP", "guz0he-21.myshopify.com")
API_VERSION = os.getenv("SHOPIFY_API_VERSION", "2026-10")
CLIENT_ID = os.getenv("SHOPIFY_CLIENT_ID")
CLIENT_SECRET = os.getenv("SHOPIFY_CLIENT_SECRET")

if not CLIENT_ID or not CLIENT_SECRET:
    raise SystemExit("SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET missing in backend .env")

print(f"Shop: {SHOP}")
print("1) Requesting access token (client credentials)...")

resp = httpx.post(
    f"https://{SHOP}/admin/oauth/access_token",
    data={
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "grant_type": "client_credentials",
    },
    timeout=20,
)

if resp.status_code != 200:
    # Error body mein secret nahi hota, sirf error message hota hai
    print(f"   FAILED: HTTP {resp.status_code}")
    print(f"   {resp.text[:500]}")
    raise SystemExit(1)

token_data = resp.json()
access_token = token_data["access_token"]
print("   OK - token mila (print nahi kar rahe)")
print(f"   Scopes: {token_data.get('scope')}")
print(f"   Expires in: {token_data.get('expires_in')} seconds")

print("2) Calling GraphQL Admin API...")
query = """
{
  shop { name currencyCode ianaTimezone }
  orders(first: 3, sortKey: CREATED_AT, reverse: true) {
    nodes { name createdAt }
  }
  productsCount { count }
}
"""
gql = httpx.post(
    f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json",
    json={"query": query},
    headers={"X-Shopify-Access-Token": access_token},
    timeout=30,
)
print(f"   HTTP {gql.status_code}")
body = gql.json()
if body.get("errors"):
    print(f"   GraphQL errors: {body['errors']}")
else:
    data = body["data"]
    shop = data["shop"]
    print(f"   Store name: {shop['name']}")
    print(f"   Currency: {shop['currencyCode']}, Timezone: {shop['ianaTimezone']}")
    print(f"   Total products: {data['productsCount']['count']}")
    print("   Latest 3 orders:")
    for o in data["orders"]["nodes"]:
        print(f"     - {o['name']}  {o['createdAt']}")

print("\nDone. (read-only, nothing saved)")
