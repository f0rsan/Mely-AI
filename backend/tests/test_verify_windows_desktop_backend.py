from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest.mock import Mock

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "verify_windows_desktop_backend.py"


def _load_verify_module():
    spec = importlib.util.spec_from_file_location("verify_windows_desktop_backend", SCRIPT_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_wait_for_desktop_backend_accepts_expected_health_feature(monkeypatch):
    module = _load_verify_module()
    statuses = iter(
        [
            (200, {"api": {"features": {"llmRuntimeReadiness": True}}}),
            (200, {"ready": False}),
            (200, {"api": {"features": {"llmRuntimeReadiness": True}}}),
            (200, {"ready": True}),
        ]
    )
    monkeypatch.setattr(module, "probe_json", lambda _url: next(statuses))
    monkeypatch.setattr(module.time, "sleep", lambda _seconds: None)

    module.wait_for_desktop_backend_ready(timeout_seconds=1.0)


def test_wait_for_desktop_backend_rejects_missing_health_feature(monkeypatch):
    module = _load_verify_module()
    monkeypatch.setattr(
        module,
        "probe_json",
        lambda _url: (200, {"api": {"features": {"llmRuntimeReadiness": False}}}),
    )
    monkeypatch.setattr(module.time, "sleep", lambda _seconds: None)

    with pytest.raises(RuntimeError, match="健康接口缺少训练环境能力标记"):
        module.wait_for_desktop_backend_ready(timeout_seconds=0.1)


def test_verify_desktop_backend_launches_and_terminates(monkeypatch, tmp_path):
    module = _load_verify_module()
    executable = tmp_path / "mely-ai.exe"
    executable.write_text("binary", encoding="utf-8")
    process = Mock()
    process.pid = 1234
    process.poll.return_value = None
    monkeypatch.setattr(module, "ensure_port_is_free", lambda _port: None)
    monkeypatch.setattr(module.subprocess, "Popen", lambda *args, **kwargs: process)
    wait_mock = Mock()
    monkeypatch.setattr(module, "wait_for_desktop_backend_ready", wait_mock)
    terminate_mock = Mock()
    monkeypatch.setattr(module, "terminate_process_tree", terminate_mock)

    module.verify_desktop_backend(executable)

    wait_mock.assert_called_once()
    terminate_mock.assert_called_once_with(process)
