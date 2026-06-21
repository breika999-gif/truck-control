import hashlib
import hmac
import json
import os
import threading
import time

import requests
from flask import Blueprint, jsonify, request

from utils.redis_client import get_redis


sentry_webhook_bp = Blueprint("sentry_webhook", __name__)

_seen_issues: dict[str, float] = {}
_seen_lock = threading.Lock()
_DEDUPE_TTL_S = 7 * 24 * 60 * 60
_MAX_BODY_BYTES = 1_000_000


def _valid_signature(raw_body: bytes) -> bool:
    secret = os.getenv("SENTRY_WEBHOOK_SECRET", "")
    signature = request.headers.get("Sentry-Hook-Signature", "")
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected)


def _is_duplicate(issue_id: str) -> bool:
    key = f"sentry:webhook:{issue_id}"
    try:
        client = get_redis()
        if client is not None:
            return not bool(client.set(key, "1", nx=True, ex=_DEDUPE_TTL_S))
    except Exception:
        pass

    now = time.time()
    with _seen_lock:
        expired = [key for key, seen_at in _seen_issues.items() if now - seen_at > _DEDUPE_TTL_S]
        for key in expired:
            _seen_issues.pop(key, None)
        if issue_id in _seen_issues:
            return True
        _seen_issues[issue_id] = now
        return False


def _release_issue(issue_id: str) -> None:
    try:
        client = get_redis()
        if client is not None:
            client.delete(f"sentry:webhook:{issue_id}")
    except Exception:
        pass
    with _seen_lock:
        _seen_issues.pop(issue_id, None)


def _stack_summary(event: dict) -> str:
    frames: list[str] = []
    for entry in event.get("entries") or []:
        if entry.get("type") != "exception":
            continue
        for value in (entry.get("data") or {}).get("values") or []:
            stacktrace = value.get("stacktrace") or {}
            for frame in (stacktrace.get("frames") or [])[-12:]:
                filename = str(frame.get("filename") or frame.get("abs_path") or "")
                if not filename:
                    continue
                function = str(frame.get("function") or "<unknown>")
                line = frame.get("lineno") or "?"
                frames.append(f"{filename}:{line} in {function}")
    return "\n".join(frames[-12:]) or "No source frames supplied by Sentry."


def _create_github_issue(issue: dict, event: dict) -> str:
    token = os.getenv("GITHUB_CRASH_TOKEN", "")
    repository = os.getenv("GITHUB_REPOSITORY", "breika999-gif/truck-control")
    if not token or "/" not in repository:
        raise RuntimeError("GitHub crash integration is not configured")

    sentry_id = str(issue.get("id") or event.get("groupID") or event.get("event_id") or "unknown")
    title = str(issue.get("title") or event.get("title") or "Production crash")[:160]
    culprit = str(issue.get("culprit") or event.get("culprit") or "unknown")[:300]
    body = (
        f"## Sentry production crash\n\n"
        f"- **Sentry issue:** `{sentry_id}`\n"
        f"- **Event:** `{str(event.get('event_id') or 'unknown')[:64]}`\n"
        f"- **Release:** `{str(event.get('release') or 'unknown')[:120]}`\n"
        f"- **Environment:** `{str(event.get('environment') or 'production')[:40]}`\n"
        f"- **Culprit:** `{culprit}`\n\n"
        f"### Sanitized stack frames\n\n```text\n{_stack_summary(event)}\n```\n\n"
        "This issue was created automatically by the Sentry crash bridge. "
        "Crash Doctor must make a minimal fix and open a review-only PR."
    )
    response = requests.post(
        f"https://api.github.com/repos/{repository}/issues",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        json={"title": f"[Sentry] {title}", "body": body, "labels": ["crash-report"]},
        timeout=10,
    )
    response.raise_for_status()
    return str(response.json().get("html_url") or "")


@sentry_webhook_bp.post("/api/sentry/webhook")
def sentry_webhook():
    if request.content_length and request.content_length > _MAX_BODY_BYTES:
        return jsonify({"ok": False, "error": "payload_too_large"}), 413

    raw_body = request.get_data(cache=True)
    if not _valid_signature(raw_body):
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    try:
        payload = json.loads(raw_body)
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "invalid_json"}), 400
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "invalid_payload"}), 400

    data = payload.get("data") or {}
    issue = data.get("issue") or payload.get("issue") or {}
    event = data.get("event") or payload.get("event") or {}
    environment = str(event.get("environment") or "").lower()
    if environment and environment not in {"production", "prod"}:
        return jsonify({"ok": True, "ignored": "non_production"})

    status = str(issue.get("status") or "unresolved").lower()
    if status in {"resolved", "ignored"}:
        return jsonify({"ok": True, "ignored": status})

    issue_id = str(issue.get("id") or event.get("groupID") or event.get("event_id") or "")
    if not issue_id:
        return jsonify({"ok": False, "error": "missing_issue_id"}), 400
    if _is_duplicate(issue_id):
        return jsonify({"ok": True, "duplicate": True})

    try:
        issue_url = _create_github_issue(issue, event)
    except (requests.RequestException, RuntimeError):
        _release_issue(issue_id)
        return jsonify({"ok": False, "error": "github_issue_failed"}), 502

    return jsonify({"ok": True, "issue_url": issue_url}), 202
