import os
from pathlib import Path
from urllib.parse import urlparse

import jwt
import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")


def validate_shopify_id_token(token: str):
    client_id = os.getenv("SHOPIFY_CLIENT_ID")
    client_secret = os.getenv("SHOPIFY_CLIENT_SECRET")

    if not client_id or not client_secret:
        raise ValueError("Shopify credentials are missing")

    claims = jwt.decode(
        token,
        client_secret,
        algorithms=["HS256"],
        audience=client_id,
        options={
            "require": ["exp", "nbf", "aud", "iss", "dest"]
        }
    )

    issuer = urlparse(claims["iss"])
    destination = urlparse(claims["dest"])

    if (
        issuer.scheme != "https"
        or destination.scheme != "https"
        or issuer.hostname != destination.hostname
        or not destination.hostname.endswith(".myshopify.com")
    ):
        raise ValueError("Invalid Shopify store identity")

    return destination.hostname


async def exchange_shopify_token(shop: str, id_token: str):
    data = {
        "client_id": os.getenv("SHOPIFY_CLIENT_ID"),
        "client_secret": os.getenv("SHOPIFY_CLIENT_SECRET"),
        "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
        "subject_token": id_token,
        "subject_token_type": "urn:ietf:params:oauth:token-type:id_token",
        "requested_token_type": "urn:shopify:params:oauth:token-type:offline-access-token",
        "expiring": "1",
    }

    url = f"https://{shop}/admin/oauth/access_token"

    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(url, data=data)
        response.raise_for_status()
        return response.json()