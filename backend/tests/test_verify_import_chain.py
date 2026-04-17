from __future__ import annotations

import importlib.util
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "backend" / "runtime" / "windows-llm-gpu" / "tools" / "verify_import_chain.py"


def _load_verify_module():
    spec = importlib.util.spec_from_file_location("verify_import_chain", SCRIPT_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_unsloth_gpu_required_error_is_deferred(monkeypatch):
    module = _load_verify_module()

    def fake_import(name: str):
        if name == "unsloth":
            raise NotImplementedError("Unsloth cannot find any torch accelerator? You need a GPU.")
        return object()

    monkeypatch.setattr(module.importlib, "import_module", fake_import)

    result = module.check_module("unsloth")

    assert result["status"] == "deferred_gpu_check"
    assert "GPU" in result["error"]


def test_regular_import_failure_stays_failed(monkeypatch):
    module = _load_verify_module()

    def fake_import(_name: str):
        raise ModuleNotFoundError("missing dependency")

    monkeypatch.setattr(module.importlib, "import_module", fake_import)

    result = module.check_module("datasets")

    assert result["status"] == "failed"
    assert "missing dependency" in result["error"]
