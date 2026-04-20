from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services.llm_runtime_manager import LLMRuntimeManager


def _seed_runtime_manifest(data_root: Path, *, worker_script: Path) -> None:
    runtime_root = data_root / "runtimes" / "llm" / "llm-win-cu121-py311-v1"
    runtime_root.mkdir(parents=True, exist_ok=True)
    payload = {
        "runtimeId": "llm-win-cu121-py311-v1",
        "python": {"exePath": sys.executable},
        "worker": {"entryScript": str(worker_script)},
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


def _seed_runtime_resources(resource_root: Path) -> None:
    resource_root.mkdir(parents=True, exist_ok=True)
    (resource_root / "runtime-manifest.template.json").write_text("{}", encoding="utf-8")
    tools_dir = resource_root / "tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    worker_path = tools_dir / "unsloth_worker.py"
    worker_path.write_text("print('worker placeholder')\n", encoding="utf-8")
    (tools_dir / "verify_import_chain.py").write_text("print('verify placeholder')\n", encoding="utf-8")
    (tools_dir / "prepare_hf_snapshot.py").write_text(
        (
            "import argparse\n"
            "from pathlib import Path\n"
            "parser = argparse.ArgumentParser()\n"
            "parser.add_argument('--repo-id', required=True)\n"
            "parser.add_argument('--cache-dir', required=True)\n"
            "args = parser.parse_args()\n"
            "target = Path(args.cache_dir) / ('models--' + args.repo_id.replace('/', '--')) / 'snapshots' / 'local'\n"
            "target.mkdir(parents=True, exist_ok=True)\n"
            "(target / 'config.json').write_text('{}', encoding='utf-8')\n"
        ),
        encoding="utf-8",
    )
    (tools_dir / "bootstrap_runtime.py").write_text(
        (
            "import argparse, json, sys\n"
            "from pathlib import Path\n"
            "parser = argparse.ArgumentParser()\n"
            "parser.add_argument('--seed-root', required=True)\n"
            "parser.add_argument('--target-root', required=True)\n"
            "parser.add_argument('--force-reinstall', action='store_true')\n"
            "args = parser.parse_args()\n"
            "seed_root = Path(args.seed_root)\n"
            "target_root = Path(args.target_root)\n"
            "target_root.mkdir(parents=True, exist_ok=True)\n"
            "payload = {\n"
            "  'runtimeId': 'llm-win-cu121-py311-v1',\n"
            "  'python': {'exePath': sys.executable},\n"
            "  'worker': {'entryScript': str(seed_root / 'tools' / 'unsloth_worker.py')},\n"
            "  'readiness': {'state': 'READY'}\n"
            "}\n"
            "(target_root / 'manifest.runtime.json').write_text(json.dumps(payload), encoding='utf-8')\n"
        ),
        encoding="utf-8",
    )
    snapshot_root = resource_root / "hf-snapshots" / "Qwen--Qwen2.5-3B-Instruct"
    snapshot_root.mkdir(parents=True, exist_ok=True)
    (snapshot_root / "config.json").write_text("{}", encoding="utf-8")


@pytest.fixture()
def runtime_manager(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    data_root = tmp_path / ".mely-test"
    data_root.mkdir(parents=True, exist_ok=True)
    resource_root = tmp_path / "llm-runtime-resources"
    _seed_runtime_resources(resource_root)

    monkeypatch.setenv("MELY_LLM_RUNTIME_ENFORCED", "1")
    monkeypatch.setenv("MELY_LLM_ALLOW_NON_WINDOWS_TRAINING", "1")
    monkeypatch.setenv("MELY_LLM_RUNTIME_RESOURCE_ROOT", str(resource_root))
    monkeypatch.setenv("MELY_GPU_NAME", "NVIDIA RTX 3070")
    monkeypatch.setenv("MELY_GPU_VRAM_GB", "12")
    monkeypatch.setenv("MELY_GPU_DRIVER_VERSION", "551.86")
    monkeypatch.setenv("MELY_CUDA_VERSION", "12.1")

    manager = LLMRuntimeManager(data_root=data_root)
    return manager, data_root


@pytest.mark.asyncio
async def test_readiness_blocks_non_windows_training_before_snapshot_check(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    data_root = tmp_path / ".mely-test"
    resource_root = tmp_path / "llm-runtime-resources"
    _seed_runtime_resources(resource_root)
    _seed_runtime_manifest(
        data_root,
        worker_script=resource_root / "tools" / "unsloth_worker.py",
    )

    monkeypatch.setattr("app.services.llm_runtime_manager.sys.platform", "darwin")
    monkeypatch.delenv("MELY_LLM_ALLOW_NON_WINDOWS_TRAINING", raising=False)
    monkeypatch.setenv("MELY_LLM_RUNTIME_ENFORCED", "1")
    monkeypatch.setenv("MELY_LLM_RUNTIME_RESOURCE_ROOT", str(resource_root))
    monkeypatch.setenv("MELY_GPU_NAME", "Apple GPU")
    monkeypatch.setenv("MELY_GPU_VRAM_GB", "8")
    monkeypatch.setenv("MELY_GPU_DRIVER_VERSION", "")
    monkeypatch.setenv("MELY_CUDA_VERSION", "")
    monkeypatch.setattr(
        "app.services.llm_runtime_manager.check_ollama_runtime",
        lambda: asyncio.sleep(
            0,
            result=SimpleNamespace(
                installed=True,
                running=True,
                models=[SimpleNamespace(name="qwen2.5:3b")],
                hint=None,
            ),
        ),
    )

    manager = LLMRuntimeManager(data_root=data_root)
    readiness = await manager.get_readiness(base_model="qwen2.5:3b")

    assert readiness.state == "unsupported"
    assert readiness.blocking_reason is not None
    assert "Windows" in readiness.blocking_reason
    assert "训练基础快照" not in readiness.blocking_reason


@pytest.mark.asyncio
async def test_readiness_missing_runtime(runtime_manager, monkeypatch):
    manager, _data_root = runtime_manager
    monkeypatch.setattr(
        "app.services.llm_runtime_manager.check_ollama_runtime",
        lambda: asyncio.sleep(
            0, result=SimpleNamespace(installed=True, running=True, models=[], hint=None)
        ),
    )
    readiness = await manager.get_readiness()
    assert readiness.state == "missing_runtime"
    assert readiness.blocking_reason is not None
    assert "缺失" in readiness.blocking_reason


@pytest.mark.asyncio
async def test_readiness_missing_ollama(runtime_manager, monkeypatch):
    manager, data_root = runtime_manager
    _seed_runtime_manifest(
        data_root,
        worker_script=Path(os.environ["MELY_LLM_RUNTIME_RESOURCE_ROOT"]) / "tools" / "unsloth_worker.py",
    )
    _seed_training_snapshot(data_root)
    monkeypatch.setattr("app.services.llm_runtime_manager.detect_missing_runtime_dependencies", lambda: [])
    monkeypatch.setattr(
        "app.services.llm_runtime_manager.check_ollama_runtime",
        lambda: asyncio.sleep(
            0,
            result=SimpleNamespace(
                installed=False,
                running=False,
                models=[],
                hint="未检测到语言引擎，请先安装 Ollama。",
            ),
        ),
    )

    readiness = await manager.get_readiness()
    assert readiness.state == "missing_ollama"
    assert readiness.blocking_reason is not None
    assert "Ollama" in readiness.blocking_reason


@pytest.mark.asyncio
async def test_readiness_missing_inference_model(runtime_manager, monkeypatch):
    manager, data_root = runtime_manager
    _seed_runtime_manifest(
        data_root,
        worker_script=Path(os.environ["MELY_LLM_RUNTIME_RESOURCE_ROOT"]) / "tools" / "unsloth_worker.py",
    )
    _seed_training_snapshot(data_root)
    monkeypatch.setattr("app.services.llm_runtime_manager.detect_missing_runtime_dependencies", lambda: [])
    monkeypatch.setattr(
        "app.services.llm_runtime_manager.check_ollama_runtime",
        lambda: asyncio.sleep(
            0,
            result=SimpleNamespace(
                installed=True,
                running=True,
                models=[SimpleNamespace(name="qwen2.5:7b-instruct-q4_K_M")],
                hint=None,
            ),
        ),
    )

    readiness = await manager.get_readiness(base_model="qwen2.5:3b")
    assert readiness.state == "missing_inference_model"
    assert readiness.blocking_reason is not None
    assert "尚未在 Ollama 中就绪" in readiness.blocking_reason


@pytest.mark.asyncio
async def test_readiness_missing_training_base_snapshot(runtime_manager, monkeypatch):
    manager, data_root = runtime_manager
    _seed_runtime_manifest(
        data_root,
        worker_script=Path(os.environ["MELY_LLM_RUNTIME_RESOURCE_ROOT"]) / "tools" / "unsloth_worker.py",
    )
    monkeypatch.setattr("app.services.llm_runtime_manager.detect_missing_runtime_dependencies", lambda: [])
    monkeypatch.setattr(
        "app.services.llm_runtime_manager.check_ollama_runtime",
        lambda: asyncio.sleep(
            0,
            result=SimpleNamespace(
                installed=True,
                running=True,
                models=[SimpleNamespace(name="qwen2.5:3b")],
                hint=None,
            ),
        ),
    )

    readiness = await manager.get_readiness(base_model="qwen2.5:3b")
    assert readiness.state == "missing_training_base_snapshot"
    assert readiness.blocking_reason is not None
    assert "训练基础快照" in readiness.blocking_reason


@pytest.mark.asyncio
async def test_auto_fix_prepares_missing_training_snapshot_with_runtime_tool(
    runtime_manager, monkeypatch
):
    manager, data_root = runtime_manager
    resource_root = Path(os.environ["MELY_LLM_RUNTIME_RESOURCE_ROOT"])
    shutil.rmtree(resource_root / "hf-snapshots")
    _seed_runtime_manifest(
        data_root,
        worker_script=resource_root / "tools" / "unsloth_worker.py",
    )
    monkeypatch.setattr(
        "app.services.llm_runtime_manager.check_ollama_runtime",
        lambda: asyncio.sleep(
            0,
            result=SimpleNamespace(
                installed=True,
                running=True,
                models=[SimpleNamespace(name="qwen2.5:3b")],
                hint=None,
            ),
        ),
    )

    preparing = await manager.get_readiness(base_model="qwen2.5:3b", auto_fix=True)
    assert preparing.state == "preparing_training_base_snapshot"

    for _ in range(50):
        ready_state = await manager.get_readiness(base_model="qwen2.5:3b")
        if ready_state.state == "ready":
            break
        await asyncio.sleep(0.02)
    else:
        raise AssertionError("训练基础快照未由 runtime 工具准备完成")

    assert ready_state.state == "ready"


@pytest.mark.asyncio
async def test_readiness_ready(runtime_manager, monkeypatch):
    manager, data_root = runtime_manager
    _seed_runtime_manifest(
        data_root,
        worker_script=Path(os.environ["MELY_LLM_RUNTIME_RESOURCE_ROOT"]) / "tools" / "unsloth_worker.py",
    )
    _seed_training_snapshot(data_root)
    monkeypatch.setattr("app.services.llm_runtime_manager.detect_missing_runtime_dependencies", lambda: [])
    monkeypatch.setattr(
        "app.services.llm_runtime_manager.check_ollama_runtime",
        lambda: asyncio.sleep(
            0,
            result=SimpleNamespace(
                installed=True,
                running=True,
                models=[SimpleNamespace(name="qwen2.5:3b")],
                hint=None,
            ),
        ),
    )

    readiness = await manager.get_readiness(base_model="qwen2.5:3b")
    assert readiness.state == "ready"
    assert readiness.ready is True


@pytest.mark.asyncio
async def test_readiness_runtime_broken_then_repair(runtime_manager, monkeypatch):
    manager, data_root = runtime_manager
    _seed_runtime_manifest(
        data_root,
        worker_script=Path(os.environ["MELY_LLM_RUNTIME_RESOURCE_ROOT"]) / "tools" / "unsloth_worker.py",
    )
    _seed_training_snapshot(data_root)
    broken_flag = (
        data_root / "runtimes" / "llm" / "llm-win-cu121-py311-v1" / "install" / "runtime-broken.json"
    )
    broken_flag.parent.mkdir(parents=True, exist_ok=True)
    broken_flag.write_text(json.dumps({"reason": "训练运行时依赖缺失。"}), encoding="utf-8")

    monkeypatch.setattr("app.services.llm_runtime_manager.detect_missing_runtime_dependencies", lambda: [])
    monkeypatch.setattr(
        "app.services.llm_runtime_manager.check_ollama_runtime",
        lambda: asyncio.sleep(
            0,
            result=SimpleNamespace(
                installed=True,
                running=True,
                models=[SimpleNamespace(name="qwen2.5:3b")],
                hint=None,
            ),
        ),
    )

    broken = await manager.get_readiness()
    assert broken.state == "runtime_broken"

    repairing = await manager.repair_runtime()
    assert repairing.state in {"installing_runtime", "ready"}

    for _ in range(50):
        ready_state = await manager.get_readiness()
        if ready_state.state == "ready":
            break
        await asyncio.sleep(0.02)
    else:
        raise AssertionError("修复流程未在预期时间内进入 ready")

    assert ready_state.state == "ready"
    assert ready_state.install_progress.stage in {"completed", "idle"}


@pytest.mark.asyncio
async def test_fine_mode_blocked_on_8gb(runtime_manager, monkeypatch):
    manager, data_root = runtime_manager
    _seed_runtime_manifest(
        data_root,
        worker_script=Path(os.environ["MELY_LLM_RUNTIME_RESOURCE_ROOT"]) / "tools" / "unsloth_worker.py",
    )
    _seed_training_snapshot(data_root)
    monkeypatch.setenv("MELY_GPU_VRAM_GB", "8")
    monkeypatch.setattr("app.services.llm_runtime_manager.detect_missing_runtime_dependencies", lambda: [])
    monkeypatch.setattr(
        "app.services.llm_runtime_manager.check_ollama_runtime",
        lambda: asyncio.sleep(
            0,
            result=SimpleNamespace(
                installed=True,
                running=True,
                models=[SimpleNamespace(name="qwen2.5:3b")],
                hint=None,
            ),
        ),
    )

    readiness = await manager.get_readiness(mode="fine")
    assert readiness.state == "unsupported"
    assert readiness.blocking_reason is not None
    assert "至少需要 12GB" in readiness.blocking_reason


@pytest.mark.asyncio
async def test_vram_below_8gb_blocked(runtime_manager, monkeypatch):
    manager, data_root = runtime_manager
    _seed_runtime_manifest(
        data_root,
        worker_script=Path(os.environ["MELY_LLM_RUNTIME_RESOURCE_ROOT"]) / "tools" / "unsloth_worker.py",
    )
    _seed_training_snapshot(data_root)
    monkeypatch.setenv("MELY_GPU_VRAM_GB", "6")
    monkeypatch.setattr("app.services.llm_runtime_manager.detect_missing_runtime_dependencies", lambda: [])
    monkeypatch.setattr(
        "app.services.llm_runtime_manager.check_ollama_runtime",
        lambda: asyncio.sleep(
            0,
            result=SimpleNamespace(
                installed=True,
                running=True,
                models=[SimpleNamespace(name="qwen2.5:3b")],
                hint=None,
            ),
        ),
    )

    readiness = await manager.get_readiness(mode="light")
    assert readiness.state == "unsupported"
    assert readiness.blocking_reason is not None
    assert "低于训练最低要求 8GB" in readiness.blocking_reason


@pytest.mark.asyncio
async def test_readiness_hardware_probe_does_not_block_event_loop(runtime_manager, monkeypatch):
    manager, data_root = runtime_manager
    _seed_runtime_manifest(
        data_root,
        worker_script=Path(os.environ["MELY_LLM_RUNTIME_RESOURCE_ROOT"]) / "tools" / "unsloth_worker.py",
    )
    _seed_training_snapshot(data_root)
    monkeypatch.setattr("app.services.llm_runtime_manager.detect_missing_runtime_dependencies", lambda: [])

    async def fake_check_ollama_runtime():
        return SimpleNamespace(
            installed=True,
            running=True,
            models=[SimpleNamespace(name="qwen2.5:3b")],
            hint=None,
        )

    monkeypatch.setattr("app.services.llm_runtime_manager.check_ollama_runtime", fake_check_ollama_runtime)

    original_hardware_probe = manager._detect_hardware

    def slow_hardware_probe():
        time.sleep(0.08)
        return original_hardware_probe()

    monkeypatch.setattr(manager, "_detect_hardware", slow_hardware_probe)

    start = time.perf_counter()
    readiness_task = asyncio.create_task(manager.get_readiness(base_model="qwen2.5:3b"))
    await asyncio.sleep(0.01)
    elapsed = time.perf_counter() - start

    assert elapsed < 0.05

    readiness = await readiness_task
    assert readiness.state == "ready"


def test_detect_hardware_ignores_stuck_nvidia_smi(runtime_manager, monkeypatch):
    manager, _data_root = runtime_manager

    monkeypatch.delenv("MELY_GPU_NAME", raising=False)
    monkeypatch.delenv("MELY_GPU_VRAM_GB", raising=False)
    monkeypatch.delenv("MELY_GPU_DRIVER_VERSION", raising=False)
    monkeypatch.delenv("MELY_CUDA_VERSION", raising=False)

    def fake_run(*_args, **_kwargs):
        raise subprocess.TimeoutExpired(cmd="nvidia-smi", timeout=2.0)

    monkeypatch.setattr("app.services.llm_runtime_manager.subprocess.run", fake_run)

    hardware = manager._detect_hardware()

    assert hardware.vram_gb == 8.0
    assert hardware.source == "fallback"


def test_llm_runtime_api_returns_readiness(monkeypatch, temp_data_root, tmp_path: Path):
    resource_root = tmp_path / "llm-runtime-api"
    _seed_runtime_resources(resource_root)
    _seed_runtime_manifest(
        temp_data_root,
        worker_script=resource_root / "tools" / "unsloth_worker.py",
    )
    _seed_training_snapshot(temp_data_root)

    monkeypatch.setenv("MELY_LLM_RUNTIME_ENFORCED", "1")
    monkeypatch.setenv("MELY_LLM_ALLOW_NON_WINDOWS_TRAINING", "1")
    monkeypatch.setenv("MELY_LLM_RUNTIME_RESOURCE_ROOT", str(resource_root))
    monkeypatch.setenv("MELY_GPU_NAME", "NVIDIA RTX 3070")
    monkeypatch.setenv("MELY_GPU_VRAM_GB", "12")
    monkeypatch.setenv("MELY_GPU_DRIVER_VERSION", "551.86")
    monkeypatch.setenv("MELY_CUDA_VERSION", "12.1")
    monkeypatch.setattr("app.services.llm_runtime_manager.detect_missing_runtime_dependencies", lambda: [])

    async def fake_check_ollama_runtime():
        return SimpleNamespace(
            installed=True,
            running=True,
            models=[SimpleNamespace(name="qwen2.5:3b")],
            hint=None,
        )

    monkeypatch.setattr("app.services.llm_runtime_manager.check_ollama_runtime", fake_check_ollama_runtime)

    app = create_app()
    with TestClient(app) as client:
        resp = client.get("/api/llm-runtime/readiness")

    assert resp.status_code == 200
    body = resp.json()
    assert body["state"] == "ready"
    assert body["ready"] is True
    assert body["blockingReason"] is None
    assert body["hardware"]["gpuModel"] == "NVIDIA RTX 3070"
