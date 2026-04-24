from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "backend" / "runtime" / "windows-llm-gpu" / "tools" / "verify_runtime_health.py"


def _load_health_module():
    spec = importlib.util.spec_from_file_location("verify_runtime_health", SCRIPT_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _fake_torch_module():
    return SimpleNamespace(
        cuda=SimpleNamespace(
            is_available=lambda: True,
            get_device_name=lambda _index: "NVIDIA RTX 5060",
        ),
        version=SimpleNamespace(cuda="13.0"),
    )


def test_json_output_is_not_polluted_by_import_warnings(monkeypatch, capsys):
    module = _load_health_module()
    monkeypatch.setitem(sys.modules, "torch", _fake_torch_module())

    def fake_import(name: str):
        if name == "unsloth":
            print(
                "W0422 17:02:11 redirects.py:29] NOTE: redirects are currently not supported in Windows or MacOs"
            )
        return object()

    monkeypatch.setattr(module.importlib, "import_module", fake_import)

    exit_code = module.main(["--json"])
    output = capsys.readouterr().out
    payload = json.loads(output)

    assert exit_code == 0
    assert payload["status"] == "ok"
    assert output.lstrip().startswith("{")
    unsloth_check = next(item for item in payload["checks"] if item["name"] == "unsloth")
    assert "redirects are currently not supported" in unsloth_check["stdout"]


def test_json_output_survives_windows_gbk_stdout(monkeypatch):
    module = _load_health_module()
    monkeypatch.setitem(sys.modules, "torch", _fake_torch_module())

    def fake_import(name: str):
        if name == "unsloth":
            print("🦥 Unsloth runtime ready")
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

    exit_code = module.main(["--json"])
    output = "".join(stdout.parts)
    payload = json.loads(output)

    assert exit_code == 0
    assert "\\ud83e\\udda5" in output
    unsloth_check = next(item for item in payload["checks"] if item["name"] == "unsloth")
    assert "🦥 Unsloth runtime ready" in unsloth_check["stdout"]


def test_runtime_manager_parses_json_after_noisy_stdout():
    from app.services.llm_runtime_manager import LLMRuntimeManager

    noisy_stdout = (
        "W0422 redirects.py:29] NOTE: redirects are currently not supported in Windows or MacOs\n"
        '{"status":"ok","message":"运行时健康检测通过。"}\n'
    )

    payload, noise = LLMRuntimeManager._parse_runtime_health_payload(noisy_stdout)

    assert payload == {"status": "ok", "message": "运行时健康检测通过。"}
    assert noise is not None
    assert "redirects are currently not supported" in noise
