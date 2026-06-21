import os

import pytest


os.environ["APP_INTERNAL_TOKEN"] = "test-app-token"
os.environ["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-bytes-long"
os.environ["DATABASE_URL"] = ""
os.environ["WERKZEUG_RUN_MAIN"] = "false"
os.environ["SENTRY_DSN"] = ""

from app import app


@pytest.fixture()
def client():
    app.config.update(TESTING=True)
    with app.test_client() as test_client:
        yield test_client


def test_health(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    assert "status" in response.get_json()


def test_auth_token_with_valid_app_token(client):
    response = client.post(
        "/api/auth/token",
        json={"user_email": "driver@example.com", "app_token": "test-app-token"},
    )

    assert response.status_code == 200
    assert response.get_json()["token"]


def test_auth_token_with_wrong_app_token(client):
    response = client.post(
        "/api/auth/token",
        json={"user_email": "driver@example.com", "app_token": "wrong-token"},
    )

    assert response.status_code == 401


def test_list_pois_without_auth(client):
    response = client.get("/api/pois")

    assert response.status_code == 401


def test_save_poi_without_auth(client):
    response = client.post("/api/pois", json={"name": "Stop", "lat": 42, "lng": 23})

    assert response.status_code == 401


def test_chat_without_auth_returns_401(client):
    response = client.post(
        "/api/chat",
        json={"message": "hello"},
    )
    assert response.status_code == 401


def test_chat_with_valid_jwt_reaches_handler(client):
    import datetime as _dt
    import os as _os
    from unittest.mock import patch

    import jwt as _jwt

    secret = _os.environ["JWT_SECRET"]
    token = _jwt.encode(
        {
            "sub": "driver@example.com",
            "iat": _dt.datetime.now(_dt.timezone.utc),
            "exp": _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=1),
        },
        secret,
        algorithm="HS256",
    )
    with patch(
        "routes.chat._run_gpt4o_internal",
        return_value={"ok": True, "reply": "mock reply"},
    ):
        response = client.post(
            "/api/chat",
            json={"message": "здравей"},
            headers={"Authorization": f"Bearer {token}"},
        )
    # 200 or 503 (if OpenAI not configured in test env) — but NOT 401/403
    assert response.status_code in (200, 503, 500)
    assert response.status_code != 401
    assert response.status_code != 403
