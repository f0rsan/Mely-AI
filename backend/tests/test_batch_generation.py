"""Tests for the batch generation queue endpoint."""
import pytest
from fastapi.testclient import TestClient

from app.main import create_app


def _create_char_and_costume(client: TestClient) -> tuple[str, str]:
    """Helper: create a character via API and return (char_id, costume_id)."""
    char_resp = client.post(
        "/api/characters",
        json={
            "name": "Test Char",
            "visual": {
                "loraPath": "/tmp/lora.pt",
                "triggerWord": "tc",
                "trainingStatus": "completed",
            },
        },
    )
    assert char_resp.status_code == 201
    char_id = char_resp.json()["id"]

    wb_resp = client.get(f"/api/characters/{char_id}/generation-workbench")
    assert wb_resp.status_code == 200
    costume_id = wb_resp.json()["selectedCostumeId"]

    return char_id, costume_id


def _batch_payload(char_id: str, costume_id: str, **overrides):
    base = {
        "characterId": char_id,
        "costumeId": costume_id,
        "scenePrompts": ["在咖啡馆", "在海边", "在图书馆"],
        "width": 1024,
        "height": 1024,
        "steps": 28,
        "sampler": "DPM++ 2M Karras",
        "cfgScale": 3.5,
        "seed": None,
        "loraWeight": 0.85,
        "tags": [],
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# API tests
# ---------------------------------------------------------------------------


def test_batch_returns_202_with_jobs(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        char_id, costume_id = _create_char_and_costume(client)

        resp = client.post(
            "/api/generations/batch",
            json=_batch_payload(char_id, costume_id),
        )

    assert resp.status_code == 202
    data = resp.json()
    assert data["total"] == 3
    assert len(data["jobs"]) == 3
    assert "batchId" in data


def test_batch_job_items_have_correct_scene_prompts(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        char_id, costume_id = _create_char_and_costume(client)

        resp = client.post(
            "/api/generations/batch",
            json=_batch_payload(char_id, costume_id, scenePrompts=["场景A", "场景B"]),
        )

    assert resp.status_code == 202
    jobs = resp.json()["jobs"]
    scene_prompts = [j["scenePrompt"] for j in jobs]
    assert scene_prompts == ["场景A", "场景B"]


def test_batch_job_items_have_task_ids(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        char_id, costume_id = _create_char_and_costume(client)

        resp = client.post(
            "/api/generations/batch",
            json=_batch_payload(char_id, costume_id),
        )

    jobs = resp.json()["jobs"]
    task_ids = [j["taskId"] for j in jobs]
    # All task IDs must be non-empty strings.
    assert all(isinstance(tid, str) and len(tid) > 0 for tid in task_ids)
    # All task IDs must be unique.
    assert len(set(task_ids)) == len(task_ids)


def test_batch_jobs_start_as_pending(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        char_id, costume_id = _create_char_and_costume(client)

        resp = client.post(
            "/api/generations/batch",
            json=_batch_payload(char_id, costume_id),
        )

    jobs = resp.json()["jobs"]
    for job in jobs:
        assert job["status"] in ("pending", "running")


def test_batch_404_for_unknown_character(temp_data_root):
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        resp = client.post(
            "/api/generations/batch",
            json={
                "characterId": "nonexistent",
                "costumeId": "c1",
                "scenePrompts": ["场景1"],
                "width": 512,
                "height": 512,
                "steps": 20,
                "sampler": "Euler a",
                "cfgScale": 7.0,
                "seed": None,
                "loraWeight": 0.8,
            },
        )

    assert resp.status_code == 404


def test_batch_400_for_empty_scene_prompts(temp_data_root):
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        char_id, costume_id = _create_char_and_costume(client)

        resp = client.post(
            "/api/generations/batch",
            json=_batch_payload(char_id, costume_id, scenePrompts=[]),
        )

    assert resp.status_code == 422


def test_batch_422_for_too_many_scene_prompts(temp_data_root):
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        char_id, costume_id = _create_char_and_costume(client)

        resp = client.post(
            "/api/generations/batch",
            json=_batch_payload(
                char_id, costume_id, scenePrompts=[f"场景{i}" for i in range(21)]
            ),
        )

    assert resp.status_code == 422


def test_batch_all_jobs_share_same_batch_id(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        char_id, costume_id = _create_char_and_costume(client)

        resp = client.post(
            "/api/generations/batch",
            json=_batch_payload(char_id, costume_id, scenePrompts=["a", "b", "c"]),
        )

    data = resp.json()
    batch_id = data["batchId"]
    assert isinstance(batch_id, str) and len(batch_id) > 0
    # Total must match job count.
    assert data["total"] == len(data["jobs"])


def test_batch_single_scene_prompt_accepted(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        char_id, costume_id = _create_char_and_costume(client)

        resp = client.post(
            "/api/generations/batch",
            json=_batch_payload(char_id, costume_id, scenePrompts=["单场景"]),
        )

    assert resp.status_code == 202
    assert resp.json()["total"] == 1
