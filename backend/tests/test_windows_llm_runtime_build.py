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


def test_copy_python_runtime_excludes_user_environment_payload(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    module = _load_build_module()
    source = tmp_path / "Python311"
    source.mkdir()
    (source / "python.exe").write_text("python", encoding="utf-8")
    (source / "pythonw.exe").write_text("pythonw", encoding="utf-8")
    (source / "python311.dll").write_text("dll", encoding="utf-8")
    (source / "vcruntime140.dll").write_text("vcruntime", encoding="utf-8")
    (source / "DLLs").mkdir()
    (source / "DLLs" / "_sqlite3.pyd").write_text("pyd", encoding="utf-8")
    (source / "Lib" / "venv").mkdir(parents=True)
    (source / "Lib" / "venv" / "__init__.py").write_text("", encoding="utf-8")
    (source / "Lib" / "venv" / "scripts" / "common").mkdir(parents=True)
    (source / "Lib" / "venv" / "scripts" / "common" / "activate").write_text(
        "activate",
        encoding="utf-8",
    )
    (source / "Lib" / "ensurepip" / "_bundled").mkdir(parents=True)
    (source / "Lib" / "ensurepip" / "_bundled" / "pip.whl").write_text(
        "pip",
        encoding="utf-8",
    )
    (source / "Lib" / "site-packages" / "jupyter").mkdir(parents=True)
    (source / "Lib" / "site-packages" / "jupyter" / "heavy.py").write_text(
        "jupyter",
        encoding="utf-8",
    )
    (source / "share" / "jupyter" / "labextensions").mkdir(parents=True)
    (source / "share" / "jupyter" / "labextensions" / "long-file.js.map").write_text(
        "map",
        encoding="utf-8",
    )
    (source / "Lib" / "tkinter").mkdir()
    (source / "Lib" / "tkinter" / "__init__.py").write_text("", encoding="utf-8")
    (source / "Lib" / "test").mkdir()
    (source / "Lib" / "test" / "test_json.py").write_text("", encoding="utf-8")
    (source / "Scripts").mkdir()
    (source / "Scripts" / "pip.exe").write_text("pip", encoding="utf-8")

    monkeypatch.setattr(
        module,
        "python_info",
        lambda _python_exe: {
            "executable": str(source / "python.exe"),
            "version": "3.11.9",
            "base_prefix": str(source),
            "platform": "win32",
        },
    )

    destination = tmp_path / "runtime" / "python-runtime"
    metadata = module.copy_python_runtime(
        python_exe=source / "python.exe",
        destination=destination,
    )

    assert (destination / "python.exe").exists()
    assert (destination / "python311.dll").exists()
    assert (destination / "DLLs" / "_sqlite3.pyd").exists()
    assert (destination / "Lib" / "venv" / "__init__.py").exists()
    assert (destination / "Lib" / "venv" / "scripts" / "common" / "activate").exists()
    assert (destination / "Lib" / "ensurepip" / "_bundled" / "pip.whl").exists()
    assert not (destination / "Lib" / "site-packages").exists()
    assert not (destination / "Lib" / "tkinter").exists()
    assert not (destination / "Lib" / "test").exists()
    assert not (destination / "share").exists()
    assert not (destination / "Scripts").exists()
    assert metadata["copiedExecutable"] == str(destination / "python.exe")


def test_copy_python_runtime_requires_stdlib_directories(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    module = _load_build_module()
    source = tmp_path / "Python311"
    source.mkdir()
    (source / "python.exe").write_text("python", encoding="utf-8")

    monkeypatch.setattr(
        module,
        "python_info",
        lambda _python_exe: {
            "executable": str(source / "python.exe"),
            "version": "3.11.9",
            "base_prefix": str(source),
            "platform": "win32",
        },
    )

    with pytest.raises(RuntimeError, match="missing required directories"):
        module.copy_python_runtime(
            python_exe=source / "python.exe",
            destination=tmp_path / "runtime" / "python-runtime",
        )


def test_runtime_builder_does_not_copy_whole_python_installation():
    script = BUILD_SCRIPT.read_text(encoding="utf-8")

    assert "shutil.copytree(base_prefix, destination" not in script
    assert "assert_python_runtime_copy_contract" in script
