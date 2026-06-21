from types import SimpleNamespace
from unittest.mock import Mock

from services import gemini_service


def test_gemini_client_generate_content_is_mocked(monkeypatch):
    client = Mock()
    client.models.generate_content.return_value = SimpleNamespace(text="mock response")
    monkeypatch.setattr(gemini_service, "_gemini_client", client)
    monkeypatch.setattr(gemini_service, "_gemini_ready", True)

    result = gemini_service._run_gemini_worker("test task", "test context")

    assert result == "mock response"
    client.models.generate_content.assert_called_once()


def test_classify_navigation_intent():
    assert gemini_service.classify_intent("маршрут до София") == "nav"


def test_classify_general_intent():
    assert gemini_service.classify_intent("здравей") == "general"


def test_tacho_system_contains_eu_regulation():
    assert "561" in gemini_service.build_gemini_system("tacho", False)
