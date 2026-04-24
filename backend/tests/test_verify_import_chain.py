from __future__ import annotations

import importlib.util
import json
import sys
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


def test_main_reports_deferred_gpu_check_without_raw_traceback(monkeypatch, capsys):
    module = _load_verify_module()

    def fake_import(name: str):
        if name == "unsloth":
            raise NotImplementedError("Unsloth cannot find any torch accelerator? You need a GPU.")
        return object()

    monkeypatch.setattr(module.importlib, "import_module", fake_import)

    exit_code = module.main(["--modules", "unsloth"])
    output = capsys.readouterr().out

    assert exit_code == 0
    assert "[deferred] unsloth" in output
    assert "full check is deferred to runtime readiness on the target GPU machine" in output
    assert "NotImplementedError" not in output


def test_json_output_survives_windows_gbk_stdout(monkeypatch):
    module = _load_verify_module()

    def fake_import(name: str):
        if name == "unsloth":
            raise RuntimeError("🦥 import warning leaked into exception")
        return object()

    class GbkStdout:
        def __init__(self) -> None:
            self.parts: list[str] = []

        def write(self, text: str) -> int:
            text.encode("gbk")
            self.parts.append(text)
            return len(text)

        def flush(self) -> None:
            pass

    stdout = GbkStdout()
    monkeypatch.setattr(sys, "stdout", stdout)
    monkeypatch.setattr(module.importlib, "import_module", fake_import)

    exit_code = module.main(["--modules", "unsloth", "--json"])
    output = "".join(stdout.parts)
    payload = json.loads(output)

    assert exit_code == 1
    assert "\\ud83e\\udda5" in output
    assert payload["modules"][0]["status"] == "failed"
    assert "🦥 import warning leaked into exception" in payload["modules"][0]["error"]
