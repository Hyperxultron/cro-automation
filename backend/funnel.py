"""
Session-to-purchase funnel (Shopify Analytics / ShopifyQL).

Sessions -> Added to Cart -> Reached Checkout -> Completed Checkout (purchase).
Result 10 minute cache (sessions.py jaisa pattern).
"""

import time
from zoneinfo import ZoneInfo
from datetime import datetime

import models
from shopify_client import graphql

FUNNEL_QUERY = """
query Funnel($q: String!) {
  shopifyqlQuery(query: $q) {
    tableData { columns { name dataType } rows }
    parseErrors
  }
}
"""

CACHE_SECONDS = 600
_cache: dict[str, tuple[float, dict]] = {}


def _to_int(value) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def fetch_funnel(store: models.Store, days: int = 1) -> dict:
    """
    Pichhle poore din (default: kal) ka session-to-purchase funnel.
    """
    key = f"{store.store_url}:{days}"
    cached = _cache.get(key)
    if cached and cached[0] > time.time():
        return cached[1]

    q = (
        "FROM sessions SHOW sessions, sessions_with_cart_additions, "
        "sessions_that_reached_checkout, sessions_that_completed_checkout "
        f"TIMESERIES day SINCE -{days + 1}d UNTIL today ORDER BY day DESC"
    )
    data = graphql(store.store_url, FUNNEL_QUERY, {"q": q})["shopifyqlQuery"]
    if data.get("parseErrors"):
        raise ValueError(f"ShopifyQL error: {data['parseErrors']}")

    tz = ZoneInfo(store.timezone or "UTC")
    today = datetime.now(tz).date().isoformat()

    rows = (data.get("tableData") or {}).get("rows") or []
    result = None
    for row in rows:
        day = str(row.get("day", ""))[:10]
        if not day or day >= today:
            continue  # aaj ka adhoora din skip
        sessions = _to_int(row.get("sessions"))
        cart = _to_int(row.get("sessions_with_cart_additions"))
        checkout = _to_int(row.get("sessions_that_reached_checkout"))
        purchased = _to_int(row.get("sessions_that_completed_checkout"))
        result = {
            "date": day,
            "sessions": sessions,
            "added_to_cart": cart,
            "reached_checkout": checkout,
            "completed_checkout": purchased,
            "cart_rate": round(cart / sessions * 100, 1) if sessions else None,
            "checkout_rate": round(checkout / sessions * 100, 1) if sessions else None,
            "conversion_rate": round(purchased / sessions * 100, 1) if sessions else None,
        }
        break  # sabse recent poora din mil gaya

    result = result or {
        "date": None, "sessions": 0, "added_to_cart": 0, "reached_checkout": 0,
        "completed_checkout": 0, "cart_rate": None, "checkout_rate": None, "conversion_rate": None,
    }
    _cache[key] = (time.time() + CACHE_SECONDS, result)
    return result
