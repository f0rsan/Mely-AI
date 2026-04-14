"""Tests for M1-C: LLM QLoRA training backend."""
from __future__ import annotations

import json
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def ollama_runtime_stub(monkeypatch):
    state = {
        "running": True,
        "models": ["qwen2.5:7b-instruct-q4_K_M", "qwen2.5:3b"],
    }

    async def fake_check_ollama_status():
        return SimpleNamespace(
            running=state["running"],
            version="0.6.0",
            models=[SimpleNamespace(name=name) for name in state["models"]],
        )

    monkeypatch.setattr("app.services.llm_training.check_ollama_status", fake_check_ollama_status)
    return state


@pytest.fixture()
def client(temp_data_root, ollama_runtime_stub):
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

    def test_start_training_fine_mode(self, client, character_id, dataset_id, monkeypatch):
        monkeypatch.setenv("MELY_LLM_HARDWARE_POLICY", "validation_16gb")
        monkeypatch.setenv("MELY_GPU_VRAM_GB", "16")
        resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "fine"},
        )
        assert resp.status_code == 202
        assert resp.json()["mode"] == "fine"

    def test_start_training_unknown_base_model_returns_400(self, client, character_id, dataset_id):
        resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={
                "datasetIds": [dataset_id],
                "mode": "light",
                "baseModel": "unknown:model",
            },
        )
        assert resp.status_code == 400
        assert "暂不支持训练" in resp.json()["detail"]

    def test_start_training_model_not_downloaded_returns_400(
        self, client, character_id, dataset_id, ollama_runtime_stub
    ):
        ollama_runtime_stub["models"] = ["qwen2.5:7b-instruct-q4_K_M"]
        resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={
                "datasetIds": [dataset_id],
                "mode": "light",
                "baseModel": "qwen2.5:3b",
            },
        )
        assert resp.status_code == 400
        assert "尚未在 Ollama 中就绪" in resp.json()["detail"]

    def test_start_training_mode_restricted_by_product_policy(
        self, client, character_id, dataset_id, monkeypatch
    ):
        monkeypatch.setenv("MELY_LLM_HARDWARE_POLICY", "product_8gb")
        resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "fine"},
        )
        assert resp.status_code == 400
        assert "RTX 3070 8GB 产品基线" in resp.json()["detail"]
        assert "暂不允许" in resp.json()["detail"]

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

    def test_runner_moves_job_forward_from_queued(self, client, character_id, dataset_id):
        """Real runner should advance queued jobs into active/terminal states."""
        resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        assert resp.status_code == 202
        job_id = resp.json()["id"]

        job = resp.json()
        for _ in range(30):
            job = client.get(f"/api/llm-training/{job_id}").json()
            if job["status"] != "queued":
                break
            time.sleep(0.01)

        assert job["status"] in (
            "preparing",
            "training",
            "exporting",
            "registering",
            "completed",
            "failed",
            "canceled",
        )

    def test_start_training_missing_gpu_dependencies_returns_chinese_error(
        self, client, character_id, dataset_id, monkeypatch
    ):
        monkeypatch.setattr(
            "app.services.llm_training.get_missing_gpu_training_dependencies",
            lambda: ["unsloth", "torch"],
        )

        resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        assert resp.status_code == 202
        job_id = resp.json()["id"]

        job = resp.json()
        for _ in range(20):
            job = client.get(f"/api/llm-training/{job_id}").json()
            if job["status"] == "failed":
                break
            time.sleep(0.01)

        assert job["status"] == "failed"
        assert "缺少 LLM 训练依赖" in (job["errorMessage"] or "")
        assert "unsloth、torch" in (job["errorMessage"] or "")


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
        # Job may have already reached a terminal state; only cancel when still active.
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
