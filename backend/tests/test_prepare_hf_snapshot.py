from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "backend" / "runtime" / "windows-llm-gpu" / "tools" / "prepare_hf_snapshot.py"


def _load_snapshot_module():
    spec = importlib.util.spec_from_file_location("prepare_hf_snapshot", SCRIPT_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_json_output_survives_windows_gbk_stdout(monkeypatch, tmp_path):
    module = _load_snapshot_module()

    def fake_snapshot_download(**_kwargs: object) -> str:
        return str(tmp_path / "snapshots" / "🦥")

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
    monkeypatch.setitem(
        sys.modules,
        "huggingface_hub",
        SimpleNamespace(snapshot_download=fake_snapshot_download),
    )

    exit_code = module.main(["--repo-id", "Qwen/Qwen2.5-3B-Instruct", "--cache-dir", str(tmp_path)])
    output = "".join(stdout.parts)
    payload = json.loads(output)

    assert exit_code == 0
    assert "\\ud83e\\udda5" in output
    assert payload["snapshotPath"].endswith("🦥")
