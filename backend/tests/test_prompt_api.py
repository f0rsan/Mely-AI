"""API-level tests for POST /api/prompt/assemble."""
from fastapi.testclient import TestClient

from app.main import create_app


def make_payload(**overrides):
    base = {
        "scenePrompt": "在咖啡馆里看书",
        "dnaPrompt": "pink hair, violet eyes",
        "triggerWord": "hoshino_mika",
        "costumePrompt": "school uniform",
    }
    base.update(overrides)
    return base


def test_assemble_returns_200_with_assembled_prompt(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        resp = client.post("/api/prompt/assemble", json=make_payload())

    assert resp.status_code == 200
    data = resp.json()
    assert "assembled" in data
    assert "hoshino_mika" in data["assembled"]
    assert data["wasOverridden"] is False
    assert len(data["components"]) == 4


def test_assemble_with_override_skips_assembly(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        resp = client.post(
            "/api/prompt/assemble",
            json=make_payload(overridePrompt="my custom prompt"),
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["assembled"] == "my custom prompt"
    assert data["wasOverridden"] is True


def test_assemble_missing_scene_prompt_returns_422(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        resp = client.post(
            "/api/prompt/assemble",
            json={"dnaPrompt": "blue eyes"},
        )

    assert resp.status_code == 422


def test_assemble_empty_scene_prompt_returns_422(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        resp = client.post(
            "/api/prompt/assemble",
            json=make_payload(scenePrompt=""),
        )

    assert resp.status_code == 422


def test_assemble_deduplicates_across_sources(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        resp = client.post(
            "/api/prompt/assemble",
            json=make_payload(
                dnaPrompt="pink hair, anime girl",
                costumePrompt="anime girl, school uniform",
            ),
        )

    data = resp.json()
    tokens = [t.strip() for t in data["assembled"].split(",")]
    assert tokens.count("anime girl") == 1


def test_assemble_token_count_is_returned(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        resp = client.post("/api/prompt/assemble", json=make_payload())

    data = resp.json()
    assert isinstance(data["tokenCount"], int)
    assert data["tokenCount"] > 0
