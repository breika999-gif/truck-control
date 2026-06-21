import os
import re
from hmac import compare_digest

from flask import Blueprint, jsonify

from utils.auth import generate_token
from utils.helpers import _get_body


auth_bp = Blueprint("auth", __name__)
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


@auth_bp.post("/api/auth/token")
def issue_token():
    body = _get_body()
    email = str(body.get("user_email") or "").strip().lower()
    expected = os.getenv("APP_INTERNAL_TOKEN", "")
    provided = str(body.get("app_token") or "")
    if not expected or not compare_digest(provided, expected):
        return jsonify({"ok": False, "error": "unauthorized"}), 401
    if not _EMAIL_RE.fullmatch(email):
        return jsonify({"ok": False, "error": "valid user_email required"}), 400
    try:
        token = generate_token(email)
    except RuntimeError:
        return jsonify({"ok": False, "error": "authentication unavailable"}), 503
    return jsonify({"token": token, "email": email})
