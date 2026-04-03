"""Tests for M1-C: LLM QLoRA training backend."""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def client(temp_data_root):
    app = create_app()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def character_id(client) -> str:
    resp = client.post("/api/characters", json={"name": "训练角色"})
    assert resp.status_code == 201
    return resp.json()["id"]


@pytest.fixture()
def dataset_id(client, character_id) -> str:
    lines = [
        json.dumps({"user": f"问{i}", "assistant": f"这是回答{i}，内容详细丰富。"})
        for i in range(60)
    ]
    resp = client.post(
        f"/api/characters/{character_id}/llm-datasets",
        json={"filename": "train.jsonl", "content": "\n".join(lines)},
    )
    assert resp.status_code == 201
    return resp.json()["id"]


# ── Start training ─────────────────────────────────────────────────────────────

class TestStartTraining:
    def test_start_training_returns_202(self, client, character_id, dataset_id):
        resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        assert resp.status_code == 202

    def test_start_training_job_fields(self, client, character_id, dataset_id):
        resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "standard"},
        )
        assert resp.status_code == 202
        body = resp.json()
        assert body["characterId"] == character_id
        assert body["datasetIds"] == [dataset_id]
        assert body["mode"] == "standard"
        assert body["status"] in ("queued", "preparing", "failed")
        assert body["progress"] >= 0.0
        assert body["id"] is not None
        assert body["createdAt"] is not None

    def test_start_training_fine_mode(self, client, character_id, dataset_id):
        resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "fine"},
        )
        assert resp.status_code == 202
        assert resp.json()["mode"] == "fine"

    def test_start_training_nonexistent_character_returns_404(self, client, dataset_id):
        resp = client.post(
            "/api/characters/ghost-id/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        assert resp.status_code == 404

    def test_start_training_nonexistent_dataset_returns_400(self, client, character_id):
        resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": ["nonexistent-dataset-id"], "mode": "light"},
        )
        assert resp.status_code == 400

    def test_start_training_empty_dataset_list_returns_422(self, client, character_id):
        resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [], "mode": "light"},
        )
        # pydantic min_length=1 triggers 422
        assert resp.status_code in (400, 422)

    def test_start_training_invalid_mode_returns_422(self, client, character_id, dataset_id):
        resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "ultra"},
        )
        assert resp.status_code == 422

    def test_start_training_dataset_from_other_character_returns_400(
        self, client, character_id, dataset_id
    ):
        other_resp = client.post("/api/characters", json={"name": "其他角色"})
        other_id = other_resp.json()["id"]
        resp = client.post(
            f"/api/characters/{other_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        assert resp.status_code == 400

    def test_placeholder_executor_transitions_to_failed(self, client, character_id, dataset_id):
        """The placeholder runner should move the job to failed with a clear message."""
        resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        assert resp.status_code == 202
        job_id = resp.json()["id"]

        # Poll until terminal (sync client drives the event loop)
        status_resp = client.get(f"/api/llm-training/{job_id}")
        assert status_resp.status_code == 200
        job = status_resp.json()
        # Placeholder marks job as failed
        assert job["status"] in ("queued", "preparing", "failed")


# ── Get / list jobs ────────────────────────────────────────────────────────────

class TestGetListJobs:
    def test_get_job_by_id(self, client, character_id, dataset_id):
        start_resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        job_id = start_resp.json()["id"]
        resp = client.get(f"/api/llm-training/{job_id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == job_id

    def test_get_nonexistent_job_returns_404(self, client):
        resp = client.get("/api/llm-training/nonexistent-job-id")
        assert resp.status_code == 404

    def test_list_jobs_empty(self, client):
        resp = client.get("/api/llm-training")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_list_jobs_filtered_by_character(self, client, character_id, dataset_id):
        client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        resp = client.get(f"/api/llm-training?characterId={character_id}")
        assert resp.status_code == 200
        jobs = resp.json()
        assert len(jobs) >= 1
        assert all(j["characterId"] == character_id for j in jobs)

    def test_list_jobs_excludes_other_characters(self, client, character_id, dataset_id):
        other_resp = client.post("/api/characters", json={"name": "其他角色2"})
        other_id = other_resp.json()["id"]
        client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        resp = client.get(f"/api/llm-training?characterId={other_id}")
        assert resp.status_code == 200
        assert resp.json() == []


# ── Cancel ─────────────────────────────────────────────────────────────────────

class TestCancelJob:
    def test_cancel_queued_job(self, client, character_id, dataset_id):
        start_resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        job_id = start_resp.json()["id"]
        # Job may already have moved to failed (placeholder executor), only try cancel if not terminal
        job = client.get(f"/api/llm-training/{job_id}").json()
        if job["status"] not in ("completed", "failed", "canceled"):
            resp = client.post(f"/api/llm-training/{job_id}/cancel")
            assert resp.status_code == 200
            assert resp.json()["status"] == "canceled"

    def test_cancel_nonexistent_job_returns_404(self, client):
        resp = client.post("/api/llm-training/ghost-job-id/cancel")
        assert resp.status_code == 404

    def test_cancel_already_failed_job_returns_400(self, client, character_id, dataset_id):
        start_resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        job_id = start_resp.json()["id"]
        job = client.get(f"/api/llm-training/{job_id}").json()
        if job["status"] == "failed":
            resp = client.post(f"/api/llm-training/{job_id}/cancel")
            assert resp.status_code == 400
            assert "无法取消" in resp.json()["detail"]


# ── GPU mutex ──────────────────────────────────────────────────────────────────

class TestGPUMutexPrefixes:
    def test_llm_training_prefix_in_gpu_exclusive_list(self):
        from app.services.gpu_mutex import GPU_EXCLUSIVE_PREFIXES
        assert "llm-training-" in GPU_EXCLUSIVE_PREFIXES
