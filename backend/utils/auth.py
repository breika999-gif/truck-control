import os
from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from flask import g, jsonify, request


def _jwt_secret() -> str:
    return os.getenv("JWT_SECRET", "")


def generate_token(user_email: str) -> str:
    secret = _jwt_secret()
    if not secret:
        raise RuntimeError("JWT_SECRET is not configured")
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_email,
        "iat": now,
        "exp": now + timedelta(days=30),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def verify_token(token: str) -> str | None:
    secret = _jwt_secret()
    if not secret or not token:
        return None
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    email = payload.get("sub")
    if not isinstance(email, str) or not email.strip():
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
