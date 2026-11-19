"""
Shopify Admin API client (server-side).

Client credentials grant se access token leta hai (24 ghante valid) aur
memory mein cache karta hai. Token kabhi print / log / DB mein save nahi hota.
"""

import os
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

API_VERSION = os.getenv("SHOPIFY_API_VERSION", "2026-10")

# shop domain -> (token, expires_at_epoch)
_token_cache: dict[str, tuple[str, float]] = {}


class ShopifyError(Exception):
    pass


def get_access_token(shop: str) -> str:
    cached = _token_cache.get(shop)
    if cached and cached[1] > time.time() + 300:  # 5 min safety margin
        return cached[0]

    client_id = os.getenv("SHOPIFY_CLIENT_ID")
    client_secret = os.getenv("SHOPIFY_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise ShopifyError("SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET missing in .env")

    response = httpx.post(
        f"https://{shop}/admin/oauth/access_token",
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "client_credentials",
        },
        timeout=20,
    )
    if response.status_code != 200:
        raise ShopifyError(
            f"Token request failed for {shop}: HTTP {response.status_code} {response.text[:300]}"
        )

    data = response.json()
    token = data["access_token"]
    _token_cache[shop] = (token, time.time() + int(data.get("expires_in", 3600)))
    return token


def graphql(shop: str, query: str, variables: dict | None = None, max_retries: int = 5) -> dict:
    """GraphQL Admin API call. Throttle hone par wait karke retry karta hai."""
    url = f"https://{shop}/admin/api/{API_VERSION}/graphql.json"

    for attempt in range(max_retries):
        token = get_access_token(shop)
        response = httpx.post(
            url,
            json={"query": query, "variables": variables or {}},
            headers={"X-Shopify-Access-Token": token},
            timeout=60,
        )

        if response.status_code == 401:
            _token_cache.pop(shop, None)  # token expire -> naya lo
            continue
        if response.status_code in (429, 502, 503, 504):
            time.sleep(2 * (attempt + 1))
            continue
        if response.status_code != 200:
            raise ShopifyError(f"GraphQL HTTP {response.status_code}: {response.text[:300]}")

        body = response.json()
        errors = body.get("errors")
        if errors:
            throttled = any(
                (e.get("extensions") or {}).get("code") == "THROTTLED" for e in errors
            )
            if throttled:
                time.sleep(2 * (attempt + 1))
                continue
            raise ShopifyError(f"GraphQL errors: {errors}")

        # Rate limit ke paas ho toh thoda ruk jao
        throttle = ((body.get("extensions") or {}).get("cost") or {}).get("throttleStatus") or {}
        available = throttle.get("currentlyAvailable")
        if available is not None and available < 200:
            time.sleep(1.5)

        return body["data"]

    raise ShopifyError("GraphQL request failed after retries")


# Shopify Analytics' own reports count human sessions only ("Human or bot
# session is Human"). Every ShopifyQL `sessions` query in this app uses the
# same filter so sessions / conversion rate / funnel match Shopify exactly.
HUMAN_SESSIONS_FILTER = "WHERE human_or_bot_session = 'Human' "
