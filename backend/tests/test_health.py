from fastapi.testclient import TestClient

from app.main import create_app


def test_health_endpoint_returns_bootstrap_details(temp_data_root) -> None:
    app = create_app()

    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200

    body = response.json()
    assert body["status"] == "ok"
    assert body["app"] == "mely-backend"
    assert body["services"]["api"] == "running"
    assert body["dataRoot"] == str(temp_data_root)
    assert body["database"]["initialized"] is True
    assert body["database"]["path"] == str(temp_data_root / "db" / "mely.db")
    assert body["database"]["appliedMigrations"] == ["0001_initial_schema.sql"]
    assert body["database"]["error"] is None


def test_health_returns_503_without_bootstrap_state() -> None:
    app = create_app()

    with TestClient(app) as client:
        client.app.state.bootstrap = None
        response = client.get("/api/health")

    assert response.status_code == 503

    body = response.json()
    assert body["error"] == "bootstrap_not_run"
    assert body["database"]["initialized"] is False
