import hmac
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from flask import g, jsonify, request
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from config import GOOGLE_OAUTH_CLIENT_ID, JWT_ACCESS_TTL_MINUTES, JWT_REFRESH_TTL_DAYS


def _jwt_secret() -> str:
    return os.getenv("JWT_SECRET", "")


def _generate_token(user_email: str, token_type: str, expires_delta: timedelta) -> str:
    secret = _jwt_secret()
    if not secret:
        raise RuntimeError("JWT_SECRET is not configured")
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_email,
        "typ": token_type,
        "iat": now,
        "exp": now + expires_delta,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def generate_token(user_email: str) -> str:
    return _generate_token(user_email, "access", timedelta(minutes=JWT_ACCESS_TTL_MINUTES))


def generate_refresh_token(user_email: str) -> str:
    return _generate_token(user_email, "refresh", timedelta(days=JWT_REFRESH_TTL_DAYS))


def _verify_token_type(token: str, expected_type: str) -> str | None:
    secret = _jwt_secret()
    if not secret or not token:
        return None
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if payload.get("typ") != expected_type:
        return None
    email = payload.get("sub")
    if not isinstance(email, str) or not email.strip():
        return None
    return email.strip().lower()


def verify_token(token: str) -> str | None:
    return _verify_token_type(token, "access")


def verify_refresh_token(token: str) -> str | None:
    return _verify_token_type(token, "refresh")


def verify_google_identity_token(token: str) -> str | None:
    if not GOOGLE_OAUTH_CLIENT_ID or not token:
        return None
    try:
        info = google_id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            GOOGLE_OAUTH_CLIENT_ID,
        )
    except Exception:
        return None
    email = info.get("email")
    email_verified = info.get("email_verified")
    if not isinstance(email, str) or not email.strip() or email_verified is False:
        return None
    return email.strip().lower()


def require_auth(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        scheme, _, token = header.partition(" ")
        if scheme.lower() != "bearer" or not token:
            return jsonify({"ok": False, "error": "unauthorized"}), 401
        email = verify_token(token.strip())
        if not email:
            return jsonify({"ok": False, "error": "unauthorized"}), 401
        g.user_email = email
        return fn(*args, **kwargs)

    return wrapped


def require_auth_or_app_token(fn):
    """JWT preferred; falls back to X-App-Token for public-safe endpoints (geocode)."""
    @wraps(fn)
    def wrapped(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        scheme, _, token = header.partition(" ")
        if scheme.lower() == "bearer" and token:
            email = verify_token(token.strip())
            if email:
                g.user_email = email
                return fn(*args, **kwargs)
        app_token = request.headers.get("X-App-Token", "")
        expected = os.getenv("APP_INTERNAL_TOKEN", "")
        if expected and app_token and hmac.compare_digest(app_token, expected):
            g.user_email = "anonymous"
            return fn(*args, **kwargs)
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    return wrapped
