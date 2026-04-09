from fastapi.testclient import TestClient

from app.main import create_app


def test_packaged_tauri_origin_is_allowed():
    app = create_app()

    with TestClient(app) as client:
        response = client.get("/api/health", headers={"Origin": "tauri://localhost"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "tauri://localhost"


def test_unknown_origin_is_not_allowed():
    app = create_app()

    with TestClient(app) as client:
        response = client.get("/api/health", headers={"Origin": "https://example.com"})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers
