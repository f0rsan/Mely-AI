from fastapi.testclient import TestClient

from app.main import create_app


def test_health_endpoint_returns_basic_service_status() -> None:
    app = create_app()

    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200

    body = response.json()
    assert body["status"] == "ok"
    assert body["app"] == "mely-backend"
    assert body["services"]["api"] == "running"
