from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
BUILD_SCRIPT = REPO_ROOT / "scripts" / "build_windows_llm_runtime.py"


def _load_build_module():
    spec = importlib.util.spec_from_file_location("build_windows_llm_runtime", BUILD_SCRIPT)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_validate_cuda_torch_wheel_rejects_cpu_torch(tmp_path: Path):
    module = _load_build_module()
    wheelhouse = tmp_path / "wheelhouse"
    wheelhouse.mkdir()
    (wheelhouse / "torch-2.10.0-cp311-cp311-win_amd64.whl").write_text("stub", encoding="utf-8")

    with pytest.raises(RuntimeError, match="不是目标 CUDA 构建"):
        module.validate_cuda_torch_wheel(
            wheelhouse_dir=wheelhouse,
            torch_index_url="https://download.pytorch.org/whl/cu130",
        )


def test_validate_cuda_torch_wheel_accepts_target_cuda_torch(tmp_path: Path):
    module = _load_build_module()
    wheelhouse = tmp_path / "wheelhouse"
    wheelhouse.mkdir()
    (wheelhouse / "torch-2.10.0+cu130-cp311-cp311-win_amd64.whl").write_text(
        "stub",
        encoding="utf-8",
    )

    module.validate_cuda_torch_wheel(
        wheelhouse_dir=wheelhouse,
        torch_index_url="https://download.pytorch.org/whl/cu130",
    )
