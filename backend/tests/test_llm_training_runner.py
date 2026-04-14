from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.db.connection import connect_database
from app.main import create_app
from app.services.bootstrap import bootstrap_application
from app.services.llm_model_service import create_llm_model_service
from app.services.llm_training import (
    INTERRUPTED_TRAINING_RECOVERY_ERROR,
    create_llm_training_service,
)
from app.services.task_queue import TaskQueue


REPO_ROOT = Path(__file__).resolve().parents[2]
WORKER_SCRIPT = REPO_ROOT / "backend" / "app" / "services" / "unsloth_worker.py"


def _dataset_file(tmp_path: Path) -> Path:
    dataset_path = tmp_path / "dataset.jsonl"
    sample = {
        "conversations": [
            {"from": "human", "value": "你好"},
            {"from": "gpt", "value": "你好，我是测试角色。"},
        ]
    }
    dataset_path.write_text(json.dumps(sample, ensure_ascii=False) + "\n", encoding="utf-8")
    return dataset_path


def _base_payload(tmp_path: Path) -> dict[str, Any]:
    dataset_path = _dataset_file(tmp_path)
    return {
        "jobId": "job-test-001",
        "mode": "light",
        "baseModel": "qwen2.5:7b-instruct-q4_K_M",
        "unslothModelName": "unsloth/Qwen2.5-7B-Instruct-bnb-4bit",
        "datasetPaths": [str(dataset_path)],
        "outputDir": str(tmp_path / "outputs"),
        "adapterOutputDir": str(tmp_path / "outputs" / "adapter"),
        "checkpointDir": str(tmp_path / "outputs" / "checkpoints"),
        "ggufOutputDir": str(tmp_path / "outputs" / "gguf"),
        "cancelSentinelPath": str(tmp_path / "outputs" / "cancel.sentinel"),
        "logPath": str(tmp_path / "outputs" / "worker.log"),
        "maxSteps": 6,
        "checkpointEverySteps": 3,
        "dryRun": True,
        "dryRunStepDelaySeconds": 0.0,
    }


def _parse_protocol(stdout: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for raw_line in stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        events.append(json.loads(line))
    return events


def _run_worker_with_stdin(payload: dict[str, Any], *extra_args: str) -> subprocess.CompletedProcess[str]:
    cmd = [sys.executable, str(WORKER_SCRIPT), *extra_args]
    return subprocess.run(
        cmd,
        input=json.dumps(payload, ensure_ascii=False),
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        timeout=30,
    )


def test_worker_dry_run_completes_with_jsonl_protocol(tmp_path: Path):
    payload = _base_payload(tmp_path)
    result = _run_worker_with_stdin(payload, "--dry-run")

    assert result.returncode == 0
    assert result.stderr == ""

    events = _parse_protocol(result.stdout)
    assert events, "worker should emit protocol events"
    assert all(event["event"] in {"status", "progress", "complete", "error"} for event in events)
    assert all("jobId" in event for event in events)

    progress_events = [event for event in events if event["event"] == "progress"]
    assert progress_events
    assert any("checkpointPath" in event for event in progress_events)

    final_event = events[-1]
    assert final_event["event"] == "complete"
    assert final_event["status"] == "completed"

    adapter_path = Path(final_event["adapterPath"])
    gguf_path = Path(final_event["ggufPath"])
    log_path = Path(final_event["logPath"])
    assert adapter_path.exists()
    assert gguf_path.exists()
    assert log_path.exists()


def test_worker_supports_cancel_sentinel_on_windows_safe_path(tmp_path: Path):
    payload = _base_payload(tmp_path)
    payload["maxSteps"] = 200
    payload["dryRunStepDelaySeconds"] = 0.01

    config_path = tmp_path / "worker-config.json"
    config_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    cancel_path = Path(payload["cancelSentinelPath"])

    process = subprocess.Popen(
        [sys.executable, str(WORKER_SCRIPT), str(config_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=REPO_ROOT,
    )
    try:
        time.sleep(0.12)
        cancel_path.write_text("cancel", encoding="utf-8")
        stdout, stderr = process.communicate(timeout=30)
    finally:
        if process.poll() is None:
            process.kill()

    assert stderr == ""
    assert process.returncode == 130
    events = _parse_protocol(stdout)
    assert events

    final_event = events[-1]
    assert final_event["event"] == "error"
    assert final_event["status"] == "canceled"
    assert final_event["code"] == "canceled_by_user"
    assert final_event["retryable"] is True
    assert Path(final_event["logPath"]).exists()


def test_worker_outputs_failed_event_for_missing_dataset(tmp_path: Path):
    payload = _base_payload(tmp_path)
    payload["datasetPaths"] = [str(tmp_path / "missing.jsonl")]

    result = _run_worker_with_stdin(payload, "--dry-run")
    assert result.returncode == 1
    assert result.stderr == ""

    events = _parse_protocol(result.stdout)
    assert events
    final_event = events[-1]
    assert final_event["event"] == "error"
    assert final_event["status"] == "failed"
    assert final_event["code"] == "dataset_not_found"
    assert "不存在" in final_event["message"]


def test_worker_outputs_invalid_config_event(tmp_path: Path):
    payload = _base_payload(tmp_path)
    payload.pop("jobId")

    result = _run_worker_with_stdin(payload, "--dry-run")
    assert result.returncode == 1
    events = _parse_protocol(result.stdout)
    assert len(events) == 1
    assert events[0]["event"] == "error"
    assert events[0]["code"] == "invalid_config"
    assert events[0]["status"] == "failed"


class _FakeLineStdout:
    def __init__(self, lines: list[str], *, final_return_code: int) -> None:
        self._lines = lines
        self._index = 0
        self._eof = False
        self._final_return_code = final_return_code
        self.process: "_FakeWorkerProcess | None" = None

    async def readline(self) -> bytes:
        await asyncio.sleep(0)
        if self._index < len(self._lines):
            line = self._lines[self._index]
            self._index += 1
            if self.process is not None and self._index >= len(self._lines):
                self.process.returncode = self._final_return_code
            if not line.endswith("\n"):
                line = f"{line}\n"
            return line.encode("utf-8")

        self._eof = True
        return b""

    def at_eof(self) -> bool:
        return self._eof

    def force_eof(self) -> None:
        self._eof = True


class _FakeBlockingStdout:
    def __init__(self) -> None:
        self._release = asyncio.Event()
        self._eof = False

    async def readline(self) -> bytes:
        await self._release.wait()
        self._eof = True
        return b""

    def at_eof(self) -> bool:
        return self._eof

    def force_eof(self) -> None:
        self._release.set()
        self._eof = True


class _FakeWorkerProcess:
    def __init__(self, *, lines: list[str] | None = None, return_code: int = 0, blocking: bool = False) -> None:
        self.returncode: int | None = None
        self._return_code = return_code
        self.terminated = False
        self.killed = False
        if blocking:
            self.stdout = _FakeBlockingStdout()
        else:
            self.stdout = _FakeLineStdout(lines or [], final_return_code=return_code)
            self.stdout.process = self

    async def wait(self) -> int:
        if self.returncode is None:
            self.returncode = self._return_code
        return self.returncode

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = 130
        self.stdout.force_eof()

    def kill(self) -> None:
        self.killed = True
        self.returncode = 137
        self.stdout.force_eof()


@pytest.fixture()
def runner_client(temp_data_root: Path, monkeypatch: pytest.MonkeyPatch):
    async def fake_check_ollama_status():
        return SimpleNamespace(
            running=True,
            version="0.6.0",
            models=[
                SimpleNamespace(name="qwen2.5:7b-instruct-q4_K_M"),
                SimpleNamespace(name="qwen2.5:3b"),
            ],
        )

    monkeypatch.setattr("app.services.llm_training.check_ollama_status", fake_check_ollama_status)
    monkeypatch.setattr("app.services.llm_training.get_missing_gpu_training_dependencies", lambda: [])
    monkeypatch.setenv("MELY_GPU_VRAM_GB", "16")
    monkeypatch.setenv("MELY_LLM_HARDWARE_POLICY", "validation_16gb")

    app = create_app()
    with TestClient(app) as client:
        yield client


def _create_character_and_dataset(client: TestClient) -> tuple[str, str]:
    character_resp = client.post("/api/characters", json={"name": "Runner角色"})
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
    return character_id, dataset_id


def _wait_terminal(client: TestClient, job_id: str, timeout: float = 4.0) -> dict[str, Any]:
    deadline = time.time() + timeout
    latest: dict[str, Any] | None = None
    while time.time() < deadline:
        resp = client.get(f"/api/llm-training/{job_id}")
        assert resp.status_code == 200
        latest = resp.json()
        if latest["status"] in {"completed", "failed", "canceled"}:
            return latest
        time.sleep(0.02)
    raise AssertionError(f"任务未在超时前进入终态: {latest}")


def _seed_recovery_jobs(db_path: Path, *, statuses: list[str]) -> tuple[str, list[str]]:
    character_id = "character-recovery"
    created_at = "2026-04-13T08:00:00Z"
    job_ids: list[str] = []

    with connect_database(db_path) as conn:
        conn.execute(
            """
            INSERT INTO characters (id, name, created_at)
            VALUES (?, ?, ?)
            """,
            (character_id, "恢复测试角色", created_at),
        )

        for index, status in enumerate(statuses):
            job_id = f"recovery-job-{index}-{status}"
            job_ids.append(job_id)
            conn.execute(
                """
                INSERT INTO llm_training_jobs (
                    id, character_id, dataset_ids_json, mode, base_model, status,
                    progress, current_step, total_steps, queue_task_id, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    character_id,
                    "[]",
                    "light",
                    "qwen2.5:7b-instruct-q4_K_M",
                    status,
                    0.5,
                    10,
                    20,
                    job_id,
                    created_at,
                ),
            )
        conn.commit()

    return character_id, job_ids


def test_service_runner_success_updates_db_and_worker_payload(
    runner_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    launched: dict[str, Any] = {}
    adapter_path = tmp_path / "adapter.safetensors"
    adapter_path.write_text("adapter", encoding="utf-8")
    gguf_path = tmp_path / "model.gguf"
    gguf_path.write_bytes(b"GGUF")

    async def fake_launch(_self, config_path: Path):
        launched["config_path"] = str(config_path)
        launched["payload"] = json.loads(Path(config_path).read_text(encoding="utf-8"))
        lines = [
            json.dumps({"event": "status", "status": "training", "message": "正在训练"}),
            json.dumps(
                {
                    "event": "progress",
                    "status": "training",
                    "step": 3,
                    "totalSteps": 6,
                    "loss": 1.2345,
                    "etaSeconds": 12,
                }
            ),
            json.dumps(
                {
                    "event": "complete",
                    "status": "completed",
                    "adapterPath": str(adapter_path),
                    "ggufPath": str(gguf_path),
                    "finalLoss": 0.4321,
                }
            ),
        ]
        return _FakeWorkerProcess(lines=lines, return_code=0)

    monkeypatch.setattr(
        "app.services.llm_training.LLMTrainingService._launch_worker_process",
        fake_launch,
    )

    character_id, dataset_id = _create_character_and_dataset(runner_client)
    with patch(
        "app.services.llm_model_service.ollama_create_model",
        new_callable=AsyncMock,
    ):
        start_resp = runner_client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        assert start_resp.status_code == 202
        job_id = start_resp.json()["id"]
        final_job = _wait_terminal(runner_client, job_id)

    assert final_job["status"] == "completed"
    assert final_job["currentStep"] >= 3
    assert final_job["totalSteps"] >= 6
    assert final_job["loss"] == pytest.approx(0.4321)
    assert final_job["adapterPath"] == str(adapter_path)
    assert final_job["ggufPath"] == str(gguf_path)
    assert final_job["errorMessage"] is None

    models_resp = runner_client.get(f"/api/characters/{character_id}/llm-models")
    assert models_resp.status_code == 200
    models = models_resp.json()
    assert len(models) == 1
    assert models[0]["status"] == "ready"
    assert models[0]["trainingJobId"] == job_id
    assert models[0]["ggufPath"] == str(gguf_path)
    assert models[0]["lossFinal"] == pytest.approx(0.4321)
    assert models[0]["datasetItemCount"] > 0

    payload = launched["payload"]
    assert payload["jobId"] == job_id
    assert payload["mode"] == "light"
    assert payload["baseModel"] == "qwen2.5:7b-instruct-q4_K_M"
    assert payload["datasetPaths"] and payload["datasetPaths"][0].endswith(".jsonl")
    assert "llm_training_runs" in payload["outputDir"]


def test_service_runner_registration_pending_keeps_training_completed(
    runner_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    from app.services.ollama_service import OllamaNotRunningError

    adapter_path = tmp_path / "pending-adapter.safetensors"
    adapter_path.write_text("adapter", encoding="utf-8")
    gguf_path = tmp_path / "pending-model.gguf"
    gguf_path.write_bytes(b"GGUF")

    async def fake_launch(_self, _config_path: Path):
        lines = [
            json.dumps({"event": "status", "status": "training", "message": "正在训练"}),
            json.dumps(
                {
                    "event": "complete",
                    "status": "completed",
                    "adapterPath": str(adapter_path),
                    "ggufPath": str(gguf_path),
                    "finalLoss": 0.2468,
                }
            ),
        ]
        return _FakeWorkerProcess(lines=lines, return_code=0)

    monkeypatch.setattr(
        "app.services.llm_training.LLMTrainingService._launch_worker_process",
        fake_launch,
    )

    character_id, dataset_id = _create_character_and_dataset(runner_client)
    with patch(
        "app.services.llm_model_service.ollama_create_model",
        new_callable=AsyncMock,
        side_effect=OllamaNotRunningError("offline"),
    ):
        start_resp = runner_client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        assert start_resp.status_code == 202
        job_id = start_resp.json()["id"]
        final_job = _wait_terminal(runner_client, job_id)

    assert final_job["status"] == "completed"
    assert "可稍后重试" in (final_job["errorMessage"] or "")

    models_resp = runner_client.get(f"/api/characters/{character_id}/llm-models")
    assert models_resp.status_code == 200
    models = models_resp.json()
    assert len(models) == 1
    assert models[0]["status"] == "pending"
    assert models[0]["trainingJobId"] == job_id
    assert models[0]["ggufPath"] == str(gguf_path)


def test_service_runner_export_failure_marks_training_failed(
    runner_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    async def fake_launch(_self, _config_path: Path):
        lines = [
            json.dumps({"event": "status", "status": "exporting", "message": "正在导出 GGUF"}),
            json.dumps(
                {
                    "event": "error",
                    "status": "failed",
                    "code": "gguf_export_failed",
                    "message": "GGUF export failed",
                    "retryable": False,
                }
            ),
        ]
        return _FakeWorkerProcess(lines=lines, return_code=1)

    monkeypatch.setattr(
        "app.services.llm_training.LLMTrainingService._launch_worker_process",
        fake_launch,
    )

    character_id, dataset_id = _create_character_and_dataset(runner_client)
    with patch(
        "app.services.llm_model_service.ollama_create_model",
        new_callable=AsyncMock,
    ) as mocked_ollama_create:
        start_resp = runner_client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        assert start_resp.status_code == 202
        job_id = start_resp.json()["id"]
        final_job = _wait_terminal(runner_client, job_id)

    assert final_job["status"] == "failed"
    assert "模型导出失败" in (final_job["errorMessage"] or "")
    mocked_ollama_create.assert_not_called()

    models_resp = runner_client.get(f"/api/characters/{character_id}/llm-models")
    assert models_resp.status_code == 200
    assert models_resp.json() == []


def test_service_runner_error_translation_for_oom(
    runner_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    async def fake_launch(_self, _config_path: Path):
        lines = [
            json.dumps(
                {
                    "event": "error",
                    "status": "failed",
                    "code": "out_of_memory",
                    "message": "CUDA out of memory",
                    "retryable": True,
                }
            )
        ]
        return _FakeWorkerProcess(lines=lines, return_code=1)

    monkeypatch.setattr(
        "app.services.llm_training.LLMTrainingService._launch_worker_process",
        fake_launch,
    )

    character_id, dataset_id = _create_character_and_dataset(runner_client)
    start_resp = runner_client.post(
        f"/api/characters/{character_id}/llm-training/start",
        json={"datasetIds": [dataset_id], "mode": "light"},
    )
    assert start_resp.status_code == 202
    job_id = start_resp.json()["id"]

    final_job = _wait_terminal(runner_client, job_id)
    assert final_job["status"] == "failed"
    assert final_job["errorMessage"] == "显存不足，请尝试轻量模式或关闭其他程序"


def test_service_runner_protocol_anomaly_marked_failed(
    runner_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    async def fake_launch(_self, _config_path: Path):
        lines = ["this-is-not-json"]
        return _FakeWorkerProcess(lines=lines, return_code=1)

    monkeypatch.setattr(
        "app.services.llm_training.LLMTrainingService._launch_worker_process",
        fake_launch,
    )

    character_id, dataset_id = _create_character_and_dataset(runner_client)
    start_resp = runner_client.post(
        f"/api/characters/{character_id}/llm-training/start",
        json={"datasetIds": [dataset_id], "mode": "light"},
    )
    assert start_resp.status_code == 202
    job_id = start_resp.json()["id"]

    final_job = _wait_terminal(runner_client, job_id)
    assert final_job["status"] == "failed"
    assert "协议异常" in (final_job["errorMessage"] or "")


def test_service_runner_cancel_terminates_subprocess(
    runner_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    fake_process = _FakeWorkerProcess(blocking=True)
    launch_called = {"value": False}

    async def fake_launch(_self, _config_path: Path):
        launch_called["value"] = True
        return fake_process

    monkeypatch.setattr(
        "app.services.llm_training.LLMTrainingService._launch_worker_process",
        fake_launch,
    )

    character_id, dataset_id = _create_character_and_dataset(runner_client)
    start_resp = runner_client.post(
        f"/api/characters/{character_id}/llm-training/start",
        json={"datasetIds": [dataset_id], "mode": "light"},
    )
    assert start_resp.status_code == 202
    job_id = start_resp.json()["id"]

    deadline = time.time() + 2.0
    while time.time() < deadline:
        if launch_called["value"]:
            break
        time.sleep(0.01)
    assert launch_called["value"] is True

    cancel_resp = runner_client.post(f"/api/llm-training/{job_id}/cancel")
    assert cancel_resp.status_code == 200
    assert cancel_resp.json()["status"] == "canceled"

    final_job = _wait_terminal(runner_client, job_id)
    assert final_job["status"] == "canceled"
    terminate_deadline = time.time() + 2.0
    while time.time() < terminate_deadline:
        if fake_process.terminated:
            break
        time.sleep(0.02)
    assert fake_process.terminated is True


def test_recover_interrupted_jobs_sweeps_only_inflight_statuses(temp_data_root: Path):
    bootstrap = bootstrap_application()
    inflight_statuses = ["preparing", "training", "exporting", "registering"]
    protected_statuses = ["queued", "completed", "failed", "canceled"]
    character_id, _ = _seed_recovery_jobs(
        bootstrap.db_path,
        statuses=[*inflight_statuses, *protected_statuses],
    )

    service = create_llm_training_service(
        db_path=bootstrap.db_path,
        data_root=bootstrap.data_root,
        queue=TaskQueue(),
        llm_model_service=create_llm_model_service(db_path=bootstrap.db_path),
    )
    recovered_count = service.recover_interrupted_jobs()
    assert recovered_count == len(inflight_statuses)

    rows = service.list_jobs(character_id=character_id)
    status_map = {row["id"]: row for row in rows}

    for status in inflight_statuses:
        row = status_map[f"recovery-job-{inflight_statuses.index(status)}-{status}"]
        assert row["status"] == "failed"
        assert row["errorMessage"] == INTERRUPTED_TRAINING_RECOVERY_ERROR
        assert row["completedAt"] is not None

    for offset, status in enumerate(protected_statuses, start=len(inflight_statuses)):
        row = status_map[f"recovery-job-{offset}-{status}"]
        assert row["status"] == status


def test_startup_recovery_closes_inflight_jobs_for_api_listing(temp_data_root: Path):
    bootstrap = bootstrap_application()
    character_id, _ = _seed_recovery_jobs(
        bootstrap.db_path,
        statuses=["preparing", "training", "exporting", "registering", "completed"],
    )

    app = create_app()
    with TestClient(app) as client:
        response = client.get(f"/api/llm-training?characterId={character_id}")
    assert response.status_code == 200

    jobs = response.json()
    assert jobs
    assert not any(
        job["status"] in {"preparing", "training", "exporting", "registering"}
        for job in jobs
    )

    failed_jobs = [job for job in jobs if job["status"] == "failed"]
    assert len(failed_jobs) == 4
    assert all(job["errorMessage"] == INTERRUPTED_TRAINING_RECOVERY_ERROR for job in failed_jobs)
