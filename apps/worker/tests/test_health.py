from fastapi.testclient import TestClient

from appraise_worker.main import app


def test_health_does_not_disclose_secrets() -> None:
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "environment": "development"}
    assert "key" not in response.text.lower()
