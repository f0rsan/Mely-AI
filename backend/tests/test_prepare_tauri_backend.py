from __future__ import annotations

import importlib.util
import os
from pathlib import Path
from unittest.mock import Mock

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "prepare_tauri_backend.py"


def _load_prepare_module():
    spec = importlib.util.spec_from_file_location("prepare_tauri_backend", SCRIPT_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_backend_bundle_freshness_passes_when_binary_is_newer(tmp_path):
    module = _load_prepare_module()
    source_file = tmp_path / "backend" / "app" / "main.py"
    source_file.parent.mkdir(parents=True)
    source_file.write_text("print('source')\n", encoding="utf-8")

    binary = tmp_path / "backend" / "dist" / "mely-backend" / "mely-backend.exe"
    binary.parent.mkdir(parents=True)
    binary.write_text("binary", encoding="utf-8")
    os.utime(source_file, (100, 100))
    os.utime(binary, (200, 200))

    stale = module.find_stale_backend_sources(
        backend_binary=binary,
        source_roots=[source_file],
    )

    assert stale == []


def test_backend_bundle_freshness_reports_newer_source(tmp_path):
    module = _load_prepare_module()
    source_file = tmp_path / "backend" / "app" / "main.py"
    source_file.parent.mkdir(parents=True)
    source_file.write_text("print('source')\n", encoding="utf-8")

    binary = tmp_path / "backend" / "dist" / "mely-backend" / "mely-backend.exe"
    binary.parent.mkdir(parents=True)
    binary.write_text("binary", encoding="utf-8")
    os.utime(binary, (100, 100))
    os.utime(source_file, (200, 200))

    stale = module.find_stale_backend_sources(
        backend_binary=binary,
        source_roots=[source_file],
    )

    assert stale == [source_file]


def test_backend_api_compatibility_checks_required_endpoints(monkeypatch, tmp_path):
    module = _load_prepare_module()
    binary = tmp_path / "mely-backend.exe"
    binary.write_text("binary", encoding="utf-8")
    process = Mock()
    process.poll.return_value = None
    process.wait.return_value = 0
    monkeypatch.setattr(module, "pick_backend_port", lambda: 19191)
    monkeypatch.setattr(module.subprocess, "Popen", lambda *args, **kwargs: process)
    probe = Mock(return_value=200)
    monkeypatch.setattr(module, "probe_endpoint_status", probe)
    monkeypatch.setattr(
        module,
        "probe_endpoint_json",
        lambda url: (
            {"buildVersion": "0.1.123"}
            if url.endswith("/api/llm/runtime")
            else {"api": {"features": {"llmRuntimeReadiness": True}}}
        ),
    )
    monkeypatch.setattr(module.time, "sleep", lambda _seconds: None)

    module.verify_backend_api_compatibility(binary)

    assert probe.call_count == len(module.REQUIRED_API_PROBES) + 1
    process.terminate.assert_called_once()


def test_backend_api_compatibility_fails_on_readiness_404(monkeypatch, tmp_path):
    module = _load_prepare_module()
    binary = tmp_path / "mely-backend.exe"
    binary.write_text("binary", encoding="utf-8")
    process = Mock()
    process.poll.return_value = None
    process.wait.return_value = 0
    monkeypatch.setattr(module, "pick_backend_port", lambda: 19191)
    monkeypatch.setattr(module.subprocess, "Popen", lambda *args, **kwargs: process)
    statuses = iter([200, 200, 404])
    monkeypatch.setattr(module, "probe_endpoint_status", lambda _url: next(statuses))
    monkeypatch.setattr(
        module,
        "probe_endpoint_json",
        lambda _url: {
            "api": {"features": {"llmRuntimeReadiness": True}},
        },
    )
    monkeypatch.setattr(module.time, "sleep", lambda _seconds: None)

    with pytest.raises(RuntimeError, match="LLM runtime readiness"):
        module.verify_backend_api_compatibility(binary)


def test_backend_api_compatibility_fails_when_health_feature_missing(monkeypatch, tmp_path):
    module = _load_prepare_module()
    binary = tmp_path / "mely-backend.exe"
    binary.write_text("binary", encoding="utf-8")
    process = Mock()
    process.poll.return_value = None
    process.wait.return_value = 0
    monkeypatch.setattr(module, "pick_backend_port", lambda: 19191)
    monkeypatch.setattr(module.subprocess, "Popen", lambda *args, **kwargs: process)
    monkeypatch.setattr(module, "probe_endpoint_status", lambda _url: 200)
    monkeypatch.setattr(
        module,
        "probe_endpoint_json",
        lambda _url: {
            "api": {"features": {"llmRuntimeReadiness": False}},
        },
    )
    monkeypatch.setattr(module.time, "sleep", lambda _seconds: None)

    with pytest.raises(RuntimeError, match="health payload is missing required feature"):
        module.verify_backend_api_compatibility(binary)


def test_backend_api_compatibility_fails_when_runtime_build_version_missing(monkeypatch, tmp_path):
    module = _load_prepare_module()
    binary = tmp_path / "mely-backend.exe"
    binary.write_text("binary", encoding="utf-8")
    process = Mock()
    process.poll.return_value = None
    process.wait.return_value = 0
    monkeypatch.setattr(module, "pick_backend_port", lambda: 19191)
    monkeypatch.setattr(module.subprocess, "Popen", lambda *args, **kwargs: process)
    monkeypatch.setattr(module, "probe_endpoint_status", lambda _url: 200)
    monkeypatch.setattr(
        module,
        "probe_endpoint_json",
        lambda _url: {
            "api": {"features": {"llmRuntimeReadiness": True}},
        },
    )
    monkeypatch.setattr(module.time, "sleep", lambda _seconds: None)

    with pytest.raises(RuntimeError, match="buildVersion"):
        module.verify_backend_api_compatibility(binary)
