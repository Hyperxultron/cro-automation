"""
Simple API key protection.

Agar backend .env mein DASHBOARD_API_KEY set hai, toh har request
(kuch exempt paths chhodkar) mein sahi `x-api-key` header hona zaroori hai.

DASHBOARD_API_KEY set NAHI hai (jaise abhi local testing mein) -> koi
protection nahi, purana behavior waisa hi chalega. Isse manual Swagger
testing nahi tootegi.
"""

import os

from fastapi import Depends, HTTPException, Request

EXEMPT_PATHS = {
    "/",
    "/health",
    "/shopify/auth",
    "/docs",
    "/redoc",
    "/openapi.json",
}


def verify_api_key(request: Request):
    path = request.url.path
    if path in EXEMPT_PATHS or path.startswith("/docs") or path.startswith("/openapi"):
        return

    expected = os.getenv("DASHBOARD_API_KEY")
    if not expected:
        return  # key configure nahi hui -> protection off (dev mode)

    provided = request.headers.get("x-api-key")
    if provided != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


api_key_dependency = Depends(verify_api_key)
