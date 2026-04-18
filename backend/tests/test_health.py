from fastapi.testclient import TestClient
from pathlib import Path
from types import SimpleNamespace

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
    assert body["api"]["features"]["llmRuntimeReadiness"] is True
    assert body["dataRoot"] == str(temp_data_root)
    assert body["database"]["initialized"] is True
    assert body["database"]["path"] == str(temp_data_root / "db" / "mely.db")
    applied_migrations = body["database"]["appliedMigrations"]
    assert "0001_initial_schema.sql" in applied_migrations
    assert "0002_download_tasks.sql" in applied_migrations
    assert "0003_training_jobs.sql" in applied_migrations
    assert "0004_dataset_reports.sql" in applied_migrations
    assert body["database"]["error"] is None


def test_health_returns_503_without_bootstrap_state() -> None:
    app = create_app()

    with TestClient(app) as client:
        client.app.state.bootstrap = None
        response = client.get("/api/health")

    assert response.status_code == 503

    body = response.json()
    assert body["error"] == "bootstrap_not_run"
    assert body["api"]["features"]["llmRuntimeReadiness"] is True
    assert body["database"]["initialized"] is False


def test_health_sanitizes_bootstrap_error_text() -> None:
    app = create_app()

    with TestClient(app) as client:
        client.app.state.bootstrap = SimpleNamespace(
            status="error",
            data_root=Path("/tmp/mely-test"),
            db_path=Path("/tmp/mely-test/db/mely.db"),
            initialized=False,
            applied_migrations=[],
            error="sqlite open failed: permission denied",
        )
        response = client.get("/api/health")

    assert response.status_code == 503

    body = response.json()
    assert body["status"] == "error"
    assert body["error"] == "bootstrap_failed"
    assert body["api"]["features"]["llmRuntimeReadiness"] is True
    assert body["database"]["error"] == "bootstrap_failed"
    assert "permission denied" not in body["database"]["error"]
