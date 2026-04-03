"""Tests for engine lifecycle API endpoints.

The ComfyUIRuntime is mocked by replacing app.state.engine_runtime *after* the
TestClient context is entered (so the lifespan has already run). This means the
real ComfyUIRuntime created by lifespan is discarded and the mock takes its place.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.schemas.engine import EngineStatus


def build_status(**overrides) -> EngineStatus:
    return EngineStatus(
        state=overrides.get("state", "stopped"),
        restartCount=overrides.get("restartCount", 0),
        errorMessage=overrides.get("errorMessage", None),
        pid=overrides.get("pid", None),
    )


def make_mock_runtime(status: EngineStatus | None = None) -> MagicMock:
    runtime = MagicMock()
    runtime.get_status.return_value = status or build_status()
    runtime.start = AsyncMock()
    runtime.stop = AsyncMock()
    return runtime


def test_get_engine_status_returns_stopped_by_default(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        mock_runtime = make_mock_runtime()
        app.state.engine_runtime = mock_runtime

        resp = client.get("/api/engine/status")

    assert resp.status_code == 200
    data = resp.json()
    assert data["state"] == "stopped"
    assert data["restartCount"] == 0
    assert data["errorMessage"] is None


def test_post_engine_start_returns_202_and_starting_state(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        mock_runtime = make_mock_runtime(status=build_status(state="starting"))
        app.state.engine_runtime = mock_runtime

        resp = client.post("/api/engine/start")

    assert resp.status_code == 202
    data = resp.json()
    assert data["status"]["state"] == "starting"
    assert data["message"] == "图像引擎启动指令已发送"
    mock_runtime.start.assert_awaited_once()


def test_post_engine_start_blocked_by_gpu_mutex_returns_409(temp_data_root):
    from app.services.engine_runtime import EngineGpuMutexError

    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        mock_runtime = make_mock_runtime()
        mock_runtime.start.side_effect = EngineGpuMutexError(
            "训练任务正在运行中，无法启动图像引擎，请等待训练完成后再试"
        )
        app.state.engine_runtime = mock_runtime

        resp = client.post("/api/engine/start")

    assert resp.status_code == 409
    assert "训练任务" in resp.json()["detail"]


def test_post_engine_stop_returns_200(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        mock_runtime = make_mock_runtime()
        app.state.engine_runtime = mock_runtime

        resp = client.post("/api/engine/stop")

    assert resp.status_code == 200
    data = resp.json()
    assert data["message"] == "图像引擎已停止"
    mock_runtime.stop.assert_awaited_once()


def test_get_engine_status_reflects_failed_state_with_chinese_message(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        mock_runtime = make_mock_runtime(
            status=build_status(
                state="failed",
                restartCount=4,
                errorMessage="图像引擎多次崩溃后仍无法恢复，请检查 GPU 驱动是否正常",
            )
        )
        app.state.engine_runtime = mock_runtime

        resp = client.get("/api/engine/status")

    assert resp.status_code == 200
    data = resp.json()
    assert data["state"] == "failed"
    assert data["restartCount"] == 4
    assert "崩溃" in data["errorMessage"]


def test_engine_endpoints_return_503_when_runtime_not_initialized(temp_data_root):
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        # Remove the engine_runtime that lifespan created.
        del app.state.engine_runtime

        for path, method in [
            ("/api/engine/status", "GET"),
            ("/api/engine/start", "POST"),
            ("/api/engine/stop", "POST"),
        ]:
            resp = client.get(path) if method == "GET" else client.post(path)
            assert resp.status_code == 503, f"{method} {path} expected 503, got {resp.status_code}"
            assert "尚未初始化" in resp.json()["detail"]
