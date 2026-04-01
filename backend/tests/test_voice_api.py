"""Tests for Voice API HTTP layer.

All VoiceService and TTSRuntime interactions are mocked.
"""
from __future__ import annotations

import io
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services.tts_runtime import TTSEngineStatus
from app.services.voice_service import (
    VoiceAssetRow,
    VoiceCharacterNotFoundError,
    VoiceInvalidDurationError,
    VoiceInvalidFormatError,
    VoiceNotBoundError,
    VoiceReferenceNotFoundError,
)


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


def _tts_status(state: str = "stopped") -> TTSEngineStatus:
    return TTSEngineStatus(state=state, restart_count=0, error_message=None, pid=None)


def _make_mock_voice_service(
    asset: VoiceAssetRow | None = None,
    upload_asset: VoiceAssetRow | None = None,
    task_id: str = "task-abc",
) -> MagicMock:
    svc = MagicMock()
    default_asset = VoiceAssetRow(
        character_id="char-1",
        reference_audio_path=None,
        reference_audio_duration=None,
        reference_audio_format=None,
        status="unbound",
        tts_engine=None,
        bound_at=None,
    )
    svc.get_status.return_value = asset or default_asset
    svc.save_reference_audio.return_value = upload_asset or VoiceAssetRow(
        character_id="char-1",
        reference_audio_path="/tmp/reference.wav",
        reference_audio_duration=10.0,
        reference_audio_format="wav",
        status="extracting",
        tts_engine="f5-tts",
        bound_at=None,
    )
    svc.submit_voiceprint_extraction = AsyncMock(return_value=task_id)
    svc.submit_synthesis = AsyncMock(return_value=task_id)
    return svc


def _make_mock_tts_runtime(state: str = "stopped") -> MagicMock:
    runtime = MagicMock()
    runtime.get_status.return_value = _tts_status(state)
    runtime.start = AsyncMock()
    runtime.stop = AsyncMock()
    return runtime


# ---------------------------------------------------------------------------
# TTS engine endpoints
# ---------------------------------------------------------------------------


def test_get_tts_engine_status_returns_stopped(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        app.state.tts_runtime = _make_mock_tts_runtime("stopped")
        resp = client.get("/api/voice/engine/status")

    assert resp.status_code == 200
    assert resp.json()["state"] == "stopped"


def test_start_tts_engine_returns_202(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        mock_runtime = _make_mock_tts_runtime("starting")
        app.state.tts_runtime = mock_runtime
        resp = client.post("/api/voice/engine/start")

    assert resp.status_code == 202
    assert resp.json()["message"] == "TTS 引擎启动指令已发送"
    mock_runtime.start.assert_awaited_once()


def test_stop_tts_engine_returns_200(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        mock_runtime = _make_mock_tts_runtime("stopped")
        app.state.tts_runtime = mock_runtime
        resp = client.post("/api/voice/engine/stop")

    assert resp.status_code == 200
    assert resp.json()["message"] == "TTS 引擎已停止"


def test_start_tts_engine_gpu_mutex_returns_409(temp_data_root):
    from app.services.gpu_mutex import EngineGpuMutexError

    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        mock_runtime = _make_mock_tts_runtime()
        mock_runtime.start.side_effect = EngineGpuMutexError("GPU 正被其他任务占用")
        app.state.tts_runtime = mock_runtime
        resp = client.post("/api/voice/engine/start")

    assert resp.status_code == 409


def test_tts_engine_endpoints_return_503_when_not_initialized(temp_data_root):
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        del app.state.tts_runtime
        for path, method in [
            ("/api/voice/engine/status", "GET"),
            ("/api/voice/engine/start", "POST"),
            ("/api/voice/engine/stop", "POST"),
        ]:
            resp = client.get(path) if method == "GET" else client.post(path)
            assert resp.status_code == 503


# ---------------------------------------------------------------------------
# voice status endpoint
# ---------------------------------------------------------------------------


def test_get_voice_status_unbound(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        app.state.voice_service = _make_mock_voice_service()
        resp = client.get("/api/voice/char-1/status")

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "unbound"
    assert data["hasReference"] is False


def test_get_voice_status_bound(temp_data_root):
    bound_asset = VoiceAssetRow(
        character_id="char-1",
        reference_audio_path="/tmp/ref.wav",
        reference_audio_duration=8.5,
        reference_audio_format="wav",
        status="bound",
        tts_engine="f5-tts",
        bound_at="2026-04-01T00:00:00+00:00",
    )
    app = create_app()
    with TestClient(app) as client:
        app.state.voice_service = _make_mock_voice_service(asset=bound_asset)
        resp = client.get("/api/voice/char-1/status")

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "bound"
    assert data["hasReference"] is True
    assert data["durationSeconds"] == 8.5


def test_get_voice_status_404_for_missing_character(temp_data_root):
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        svc = _make_mock_voice_service()
        svc.get_status.side_effect = VoiceCharacterNotFoundError("角色不存在")
        app.state.voice_service = svc
        resp = client.get("/api/voice/nonexistent/status")

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# upload reference audio
# ---------------------------------------------------------------------------


def test_upload_reference_audio_returns_201(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        app.state.voice_service = _make_mock_voice_service()
        resp = client.post(
            "/api/voice/upload-reference?character_id=char-1&durationSeconds=10.0",
            files={"file": ("voice.wav", b"FAKE_WAV", "audio/wav")},
        )

    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "extracting"
    assert data["characterId"] == "char-1"


def test_upload_reference_unsupported_format_returns_400(temp_data_root):
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        svc = _make_mock_voice_service()
        svc.save_reference_audio.side_effect = VoiceInvalidFormatError("不支持的格式")
        app.state.voice_service = svc
        resp = client.post(
            "/api/voice/upload-reference?character_id=char-1&durationSeconds=10.0",
            files={"file": ("voice.mp4", b"FAKE", "video/mp4")},
        )

    assert resp.status_code in (400, 422)


def test_upload_reference_missing_duration_returns_422(temp_data_root):
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        app.state.voice_service = _make_mock_voice_service()
        resp = client.post(
            "/api/voice/upload-reference?character_id=char-1",
            files={"file": ("voice.wav", b"FAKE", "audio/wav")},
        )

    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# voiceprint extraction
# ---------------------------------------------------------------------------


def test_extract_voiceprint_returns_202(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        app.state.voice_service = _make_mock_voice_service()
        resp = client.post("/api/voice/extract-voiceprint?character_id=char-1")

    assert resp.status_code == 202
    assert resp.json()["taskId"] == "task-abc"


def test_extract_voiceprint_no_reference_returns_400(temp_data_root):
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        svc = _make_mock_voice_service()
        svc.submit_voiceprint_extraction.side_effect = VoiceReferenceNotFoundError("无参考音频")
        app.state.voice_service = svc
        resp = client.post("/api/voice/extract-voiceprint?character_id=char-1")

    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# synthesis
# ---------------------------------------------------------------------------


def test_synthesize_returns_202(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        app.state.voice_service = _make_mock_voice_service()
        resp = client.post(
            "/api/voice/synthesize",
            json={"characterId": "char-1", "text": "你好，世界！"},
        )

    assert resp.status_code == 202
    assert resp.json()["taskId"] == "task-abc"


def test_synthesize_not_bound_returns_400(temp_data_root):
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        svc = _make_mock_voice_service()
        svc.submit_synthesis.side_effect = VoiceNotBoundError("未绑定")
        app.state.voice_service = svc
        resp = client.post(
            "/api/voice/synthesize",
            json={"characterId": "char-1", "text": "test"},
        )

    assert resp.status_code == 400


def test_voice_service_endpoints_return_503_when_not_initialized(temp_data_root):
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        app.state.voice_service = None
        resp = client.get("/api/voice/char-1/status")
        assert resp.status_code == 503
