import re
import os
from hmac import compare_digest

from flask import Blueprint, jsonify

from config import GOOGLE_OAUTH_CLIENT_ID
from utils.auth import (
    generate_refresh_token,
    generate_token,
    verify_google_identity_token,
    verify_refresh_token,
)
from utils.helpers import _get_body


auth_bp = Blueprint("auth", __name__)
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _token_response(email: str):
    return jsonify({
        "token": generate_token(email),
        "refresh_token": generate_refresh_token(email),
        "email": email,
        "token_type": "Bearer",
    })


@auth_bp.post("/api/auth/token")
def issue_token():
    body = _get_body()
    google_token = str(body.get("google_id_token") or "").strip()
    email = verify_google_identity_token(google_token)
    if not email and not GOOGLE_OAUTH_CLIENT_ID:
        provided = str(body.get("app_token") or "")
        expected = os.getenv("APP_INTERNAL_TOKEN", "")
        legacy_email = str(body.get("user_email") or "").strip().lower()
        if expected and compare_digest(provided, expected):
            email = legacy_email
    if not email:
        return jsonify({"ok": False, "error": "unauthorized"}), 401
    if not _EMAIL_RE.fullmatch(email):
        return jsonify({"ok": False, "error": "valid user_email required"}), 400
    try:
        return _token_response(email)
    except RuntimeError:
        return jsonify({"ok": False, "error": "authentication unavailable"}), 503


@auth_bp.post("/api/auth/refresh")
def refresh_token():
    body = _get_body()
    email = verify_refresh_token(str(body.get("refresh_token") or "").strip())
    if not email:
        return jsonify({"ok": False, "error": "unauthorized"}), 401
    try:
        return _token_response(email)
    except RuntimeError:
        return jsonify({"ok": False, "error": "authentication unavailable"}), 503
