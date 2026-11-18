from datetime import datetime, timedelta, timezone

import jwt
import httpx

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from dependencies import get_db
from models import Store
from encryption import encrypt_token
from shopify_auth import validate_shopify_id_token, exchange_shopify_token

router = APIRouter()
security = HTTPBearer()


@router.post("/shopify/auth")
async def shopify_authenticate(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
):
    id_token = credentials.credentials

    try:
        shop = validate_shopify_id_token(id_token)
        token_data = await exchange_shopify_token(shop, id_token)

        access_token = token_data["access_token"]
        refresh_token = token_data["refresh_token"]

        now = datetime.now(timezone.utc)

        store = db.query(Store).filter(
            Store.store_url == shop
        ).first()

        if not store:
            store = Store(
                store_name=shop,
                store_url=shop,
                platform="shopify"
            )
            db.add(store)

        store.access_token_encrypted = encrypt_token(access_token)
        store.refresh_token_encrypted = encrypt_token(refresh_token)
        store.token_expires_at = now + timedelta(
            seconds=token_data["expires_in"]
        )
        store.refresh_token_expires_at = now + timedelta(
            seconds=token_data["refresh_token_expires_in"]
        )
        store.scopes = token_data.get("scope", "")

        db.commit()
        db.refresh(store)

        return {
            "status": "success",
            "message": "Shopify store connected successfully",
            "store_id": store.id,
            "store_domain": shop,
            "scopes": store.scopes
        }

    except (jwt.PyJWTError, ValueError):
        db.rollback()
        raise HTTPException(status_code=401, detail="Invalid Shopify ID token")

    except httpx.HTTPError:
        db.rollback()
        raise HTTPException(status_code=502, detail="Shopify token exchange failed")

    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Shopify authentication failed")