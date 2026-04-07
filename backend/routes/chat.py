from flask import Blueprint, jsonify, request
from utils.helpers import _is_rate_limited, _get_body
from services.gpt_service import _run_gpt4o_internal

chat_bp = Blueprint('chat', __name__)

@chat_bp.post("/api/chat")
def chat():
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()
    if _is_rate_limited(ip, limit=20, window_s=60):
        return jsonify({"ok": False, "error": "Твърде много заявки. Изчакай минута."}), 429
    body = _get_body()
    user_msg = (body.get("message") or "").strip()
    if not user_msg:
        return jsonify({"ok": False, "error": "message is required"}), 400
    result = _run_gpt4o_internal(
        user_msg, body.get("history") or [], body.get("context") or {}
    )
    if not result.get("ok"):
        code = 503 if "конфигуриран" in result.get("error", "") else 500
        return jsonify(result), code
    return jsonify(result)
