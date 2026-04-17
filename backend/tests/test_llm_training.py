"""Tests for M1-C: LLM QLoRA training backend."""
from __future__ import annotations

import json
import shutil
import sys
import time
from types import SimpleNamespace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


REPO_ROOT = Path(__file__).resolve().parents[2]
WORKER_SCRIPT = REPO_ROOT / "backend" / "app" / "services" / "unsloth_worker.py"


def _seed_runtime_manifest(data_root: Path) -> None:
    runtime_root = data_root / "runtimes" / "llm" / "llm-win-cu121-py311-v1"
    runtime_root.mkdir(parents=True, exist_ok=True)
    payload = {
        "runtimeId": "llm-win-cu121-py311-v1",
        "python": {"exePath": sys.executable},
        "worker": {"entryScript": str(WORKER_SCRIPT)},
        "readiness": {"state": "READY"},
    }
    (runtime_root / "manifest.runtime.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _seed_training_snapshot(data_root: Path) -> None:
    snapshot_root = (
        data_root / "cache" / "hf" / "models--Qwen--Qwen2.5-3B-Instruct" / "snapshots" / "local"
    )
    snapshot_root.mkdir(parents=True, exist_ok=True)
    (snapshot_root / "config.json").write_text("{}", encoding="utf-8")


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def ollama_runtime_stub(monkeypatch):
    state = {
        "installed": True,
        "running": True,
        "models": ["qwen2.5:7b-instruct-q4_K_M", "qwen2.5:3b"],
        "hint": None,
    }

    async def fake_check_ollama_runtime():
        return SimpleNamespace(
            installed=state["installed"],
            running=state["running"],
            models=[SimpleNamespace(name=name) for name in state["models"]],
            hint=state["hint"],
        )

    monkeypatch.setattr(
        "app.services.llm_runtime_manager.check_ollama_runtime",
        fake_check_ollama_runtime,
    )
    return state


@pytest.fixture()
def client(temp_data_root, ollama_runtime_stub, monkeypatch: pytest.MonkeyPatch):
    _seed_runtime_manifest(temp_data_root)
    _seed_training_snapshot(temp_data_root)
    monkeypatch.setenv("MELY_LLM_RUNTIME_ENFORCED", "1")
    monkeypatch.setenv("MELY_LLM_ALLOW_NON_WINDOWS_TRAINING", "1")
    monkeypatch.setenv("MELY_GPU_NAME", "NVIDIA RTX 3070")
    monkeypatch.setenv("MELY_GPU_VRAM_GB", "16")
    monkeypatch.setenv("MELY_GPU_DRIVER_VERSION", "551.86")
    monkeypatch.setenv("MELY_CUDA_VERSION", "12.1")
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
        assert body["baseModel"] == "qwen2.5:3b"
        assert body["status"] in ("queued", "preparing", "failed")
        assert body["stageName"] == "等待训练资源"
        assert body["checkpointPath"] is None
        assert body["runRoot"].endswith(body["id"])
        assert body["progress"] >= 0.0
        assert body["id"] is not None
        assert body["createdAt"] is not None

    def test_open_run_root_endpoint_opens_job_directory(
        self, client, character_id, dataset_id, monkeypatch, temp_data_root
    ):
        opened: dict[str, str] = {}

        def fake_open_directory(path: Path) -> None:
            opened["path"] = str(path)

        monkeypatch.setattr("app.services.llm_training._open_directory", fake_open_directory)

        start_resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        assert start_resp.status_code == 202
        job = start_resp.json()

        open_resp = client.post(f"/api/llm-training/{job['id']}/open-run-root")
        assert open_resp.status_code == 204

        expected_path = (
            temp_data_root / "characters" / character_id / "llm_training_runs" / job["id"]
        )
        assert opened["path"] == str(expected_path)
        assert expected_path.exists()

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
        monkeypatch.setenv("MELY_GPU_VRAM_GB", "8")
        resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "fine"},
        )
        assert resp.status_code == 400
        assert "至少需要 12GB" in resp.json()["detail"]

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

    def test_start_training_runtime_broken_guides_repair(
        self, client, character_id, dataset_id, temp_data_root
    ):
        broken_flag = (
            temp_data_root
            / "runtimes"
            / "llm"
            / "llm-win-cu121-py311-v1"
            / "install"
            / "runtime-broken.json"
        )
        broken_flag.parent.mkdir(parents=True, exist_ok=True)
        broken_flag.write_text(
            json.dumps({"reason": "训练运行时依赖异常。"}, ensure_ascii=False),
            encoding="utf-8",
        )
        resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        assert resp.status_code == 400
        assert "修复训练环境" in resp.json()["detail"]

    def test_start_training_missing_snapshot_enters_auto_prepare_state(
        self, client, character_id, dataset_id, temp_data_root
    ):
        snapshot_root = (
            temp_data_root / "cache" / "hf" / "models--Qwen--Qwen2.5-3B-Instruct"
        )
        if snapshot_root.exists():
            shutil.rmtree(snapshot_root)

        resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        assert resp.status_code == 400
        assert "正在准备训练模型基础权重" in resp.json()["detail"]


def test_start_training_blocks_when_runtime_missing(
    temp_data_root, monkeypatch, ollama_runtime_stub, tmp_path: Path
):
    resource_root = tmp_path / "llm-runtime"
    resource_root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("MELY_LLM_RUNTIME_ENFORCED", "1")
    monkeypatch.setenv("MELY_LLM_ALLOW_NON_WINDOWS_TRAINING", "1")
    monkeypatch.setenv("MELY_LLM_RUNTIME_RESOURCE_ROOT", str(resource_root))
    monkeypatch.setenv("MELY_GPU_NAME", "NVIDIA RTX 3070")
    monkeypatch.setenv("MELY_GPU_VRAM_GB", "12")
    monkeypatch.setenv("MELY_GPU_DRIVER_VERSION", "551.86")
    monkeypatch.setenv("MELY_CUDA_VERSION", "12.1")

    app = create_app()
    with TestClient(app) as client:
        character_resp = client.post("/api/characters", json={"name": "运行时阻断角色"})
        assert character_resp.status_code == 201
        character_id = character_resp.json()["id"]

        lines = [
            json.dumps({"user": f"问{i}", "assistant": f"这是回答{i}，内容详细丰富。"})
            for i in range(60)
        ]
        dataset_resp = client.post(
            f"/api/characters/{character_id}/llm-datasets",
            json={"filename": "train.jsonl", "content": "\n".join(lines)},
        )
        assert dataset_resp.status_code == 201
        dataset_id = dataset_resp.json()["id"]

        start_resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )

    assert start_resp.status_code == 400
    assert (
        "训练运行时缺失" in start_resp.json()["detail"]
        or "自动安装" in start_resp.json()["detail"]
        or "安装中" in start_resp.json()["detail"]
    )


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
