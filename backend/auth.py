"""
Dashboard login (username + password).

Render env vars (backend service):
  DASHBOARD_USERNAME       login ka username
  DASHBOARD_PASSWORD_HASH  password ka hash (asli password kabhi nahi) -
                           `python make_password_hash.py` chala ke banao
  AUTH_SECRET              lamba random secret, login tokens sign karne ke liye

Teeno set hon -> login ON: har API request ko valid login token chahiye.
Koi bhi missing ho -> login OFF, purana API-key wala behaviour chalta hai.

Password change karne par (naya hash) purane saare logins apne aap band ho jaate hain.
"""

import base64
import hashlib
import hmac
import os
import threading
import time
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

TOKEN_DAYS = 7
MAX_FAILS = 5            # itni galat koshish ...
LOCK_SECONDS = 15 * 60   # ... ke baad 15 min ke liye block (per IP)

router = APIRouter(prefix="/auth", tags=["auth"])

_fails: dict[str, list[float]] = {}
_lock = threading.Lock()


def _cfg() -> tuple[str, str, str] | None:
    u = (os.getenv("DASHBOARD_USERNAME") or "").strip()
    h = (os.getenv("DASHBOARD_PASSWORD_HASH") or "").strip()
    s = (os.getenv("AUTH_SECRET") or "").strip()
    return (u, h, s) if u and h and s else None


def auth_enabled() -> bool:
    return _cfg() is not None


def hash_password(password: str, iterations: int = 390_000) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return "pbkdf2_sha256${}${}${}".format(
        iterations, base64.b64encode(salt).decode(), base64.b64encode(dk).decode()
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_b64, hash_b64 = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt_b64), int(iters))
        return hmac.compare_digest(dk, base64.b64decode(hash_b64))
    except Exception:
        return False


def _pw_version(stored_hash: str) -> str:
    return hashlib.sha256(stored_hash.encode()).hexdigest()[:12]


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _locked(ip: str) -> bool:
    now = time.time()
    with _lock:
        recent = [t for t in _fails.get(ip, []) if now - t < LOCK_SECONDS]
        _fails[ip] = recent
        return len(recent) >= MAX_FAILS


def _record_fail(ip: str) -> None:
    with _lock:
        _fails.setdefault(ip, []).append(time.time())


def make_token(username: str) -> tuple[str, datetime]:
    cfg = _cfg()
    assert cfg
    exp = datetime.now(timezone.utc) + timedelta(days=TOKEN_DAYS)
    token = jwt.encode(
        {"sub": username, "pv": _pw_version(cfg[1]), "exp": exp, "iat": datetime.now(timezone.utc)},
        cfg[2],
        algorithm="HS256",
    )
    return token, exp


def user_from_request(request: Request) -> str | None:
    """Valid login token ho toh username, warna None."""
    cfg = _cfg()
    if not cfg:
        return None
    header = request.headers.get("authorization") or ""
    if not header.lower().startswith("bearer "):
        return None
    try:
        claims = jwt.decode(header[7:].strip(), cfg[2], algorithms=["HS256"], options={"require": ["exp", "sub"]})
    except jwt.PyJWTError:
        return None
    if claims.get("sub") != cfg[0] or claims.get("pv") != _pw_version(cfg[1]):
        return None
    return claims["sub"]


class LoginBody(BaseModel):
    username: str
    password: str


@router.get("/status")
def auth_status():
    return {"enabled": auth_enabled()}


@router.post("/login")
def login(body: LoginBody, request: Request):
    cfg = _cfg()
    if not cfg:
        raise HTTPException(status_code=503, detail="Login is not set up on the server yet.")
    ip = _client_ip(request)
    if _locked(ip):
        raise HTTPException(status_code=429, detail="Too many wrong attempts. Try again in 15 minutes.")

    user_ok = hmac.compare_digest(body.username.strip().lower().encode(), cfg[0].lower().encode())
    pass_ok = verify_password(body.password, cfg[1])  # hamesha chalao (timing same rahe)
    if not (user_ok and pass_ok):
        _record_fail(ip)
        raise HTTPException(status_code=401, detail="Wrong username or password.")

    with _lock:
        _fails.pop(ip, None)
    token, exp = make_token(cfg[0])
    return {"token": token, "username": cfg[0], "expires_at": exp.isoformat()}


@router.get("/me")
def me(request: Request):
    user = user_from_request(request)
    if auth_enabled() and not user:
        raise HTTPException(status_code=401, detail="Please log in.")
    return {"username": user, "auth_enabled": auth_enabled()}
