import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.mark.parametrize(
    "origin",
    [
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ],
)
def test_packaged_tauri_origins_are_allowed(origin: str):
    app = create_app()

    with TestClient(app) as client:
        response = client.get("/api/health", headers={"Origin": origin})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_unknown_origin_is_not_allowed():
    app = create_app()

    with TestClient(app) as client:
        response = client.get("/api/health", headers={"Origin": "https://example.com"})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers
