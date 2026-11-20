"""
API protection (har request par chalta hai, kuch public paths chhodkar).

1. Login ON (auth.py ke 3 env vars set): sirf valid login token wali request
   chalegi. Frontend bundle wali API key ab kaafi nahi hai.
2. Login OFF: purana behaviour - DASHBOARD_API_KEY set ho toh `x-api-key`
   header chahiye, set na ho toh protection off (local testing).
"""

import os

from fastapi import Depends, HTTPException, Request

from auth import auth_enabled, user_from_request

EXEMPT_PATHS = {
    "/",
    "/health",
    "/shopify/auth",
    "/auth/status",
    "/auth/login",
    "/docs",
    "/redoc",
    "/openapi.json",
}


def verify_api_key(request: Request):
    path = request.url.path
    if request.method == "OPTIONS" or path in EXEMPT_PATHS or path.startswith("/docs") or path.startswith("/openapi"):
        return

    if auth_enabled():
        if not user_from_request(request):
            raise HTTPException(status_code=401, detail="Please log in.")
        return

    expected = os.getenv("DASHBOARD_API_KEY")
    if not expected:
        return  # key configure nahi hui -> protection off (dev mode)

    provided = request.headers.get("x-api-key")
    if provided != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


api_key_dependency = Depends(verify_api_key)
