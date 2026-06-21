import hashlib
import hmac
import json
import os
from unittest.mock import patch

import pytest


os.environ["APP_INTERNAL_TOKEN"] = "test-app-token"
os.environ["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-bytes-long"
os.environ["DATABASE_URL"] = ""
os.environ["WERKZEUG_RUN_MAIN"] = "false"
os.environ["SENTRY_DSN"] = ""
os.environ["SENTRY_WEBHOOK_SECRET"] = "test-webhook-secret"
os.environ["GITHUB_CRASH_TOKEN"] = "test-github-token"

from app import app


@pytest.fixture()
def client():
    app.config.update(TESTING=True)
    with app.test_client() as test_client:
        yield test_client


def _signed_request(client, payload):
    raw = json.dumps(payload).encode("utf-8")
    signature = hmac.new(b"test-webhook-secret", raw, hashlib.sha256).hexdigest()
    return client.post(
        "/api/sentry/webhook",
        data=raw,
        content_type="application/json",
        headers={"Sentry-Hook-Signature": signature},
    )


def test_sentry_webhook_rejects_unsigned_payload(client):
    response = client.post("/api/sentry/webhook", json={})
    assert response.status_code == 401


def test_sentry_webhook_ignores_non_production(client):
    response = _signed_request(client, {"data": {"event": {"environment": "development"}}})
    assert response.status_code == 200
    assert response.get_json()["ignored"] == "non_production"


def test_sentry_webhook_creates_crash_issue(client):
    payload = {
        "data": {
            "issue": {"id": "sentry-test-1", "title": "TypeError", "status": "unresolved"},
            "event": {"event_id": "event-1", "environment": "production"},
        }
    }
    with patch("routes.sentry_webhook._is_duplicate", return_value=False), patch(
        "routes.sentry_webhook._create_github_issue",
        return_value="https://github.com/example/repo/issues/1",
    ):
        response = _signed_request(client, payload)

    assert response.status_code == 202
    assert response.get_json()["ok"] is True
