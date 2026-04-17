#!/usr/bin/env python3
"""Verify staged runtime resources required for Windows training installer."""

from __future__ import annotations

import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
RUNTIME_DIR = REPO_ROOT / "src-tauri" / "resources" / "llm-runtime"

REQUIRED_FILES = (
    "manifest.json",
    "runtime-manifest.template.json",
    "requirements-lock.txt",
    "SHA256SUMS.txt",
    "tools/bootstrap_runtime.py",
    "tools/verify_import_chain.py",
    "tools/prepare_hf_snapshot.py",
    "tools/unsloth_worker.py",
)


def _format_size(total_bytes: int) -> str:
    units = ("B", "KB", "MB", "GB", "TB")
    value = float(total_bytes)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            if unit == "B":
                return f"{int(value)} {unit}"
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{total_bytes} B"


def _directory_size(path: Path) -> int:
    total = 0
    for child in path.rglob("*"):
        if child.is_file():
            total += child.stat().st_size
    return total


def _verify_manifest(manifest_path: Path) -> tuple[str, int]:
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("manifest.json 不是合法对象。")

    runtime_id = str(payload.get("runtimeId") or "").strip()
    if not runtime_id:
        raise RuntimeError("manifest.json 缺少 runtimeId。")

    dependency_set = payload.get("dependencySet")
    if not isinstance(dependency_set, dict):
        raise RuntimeError("manifest.json 缺少 dependencySet。")

    package_count = int(dependency_set.get("packageCount") or 0)
    if package_count <= 0:
        raise RuntimeError("manifest.json 中 dependencySet.packageCount 非法或为 0。")

    return runtime_id, package_count


def main() -> int:
    if not RUNTIME_DIR.exists():
        print(
            "[verify-runtime] 未找到 src-tauri/resources/llm-runtime。请先运行 scripts/build_windows.sh 生成训练 runtime。",
            file=sys.stderr,
        )
        return 1

    missing = [rel for rel in REQUIRED_FILES if not (RUNTIME_DIR / rel).exists()]
    if missing:
        print("[verify-runtime] 训练 runtime 资源缺失：", file=sys.stderr)
        for rel in missing:
            print(f"  - {RUNTIME_DIR / rel}", file=sys.stderr)
        return 1

    wheelhouse_dir = RUNTIME_DIR / "wheelhouse"
    if not wheelhouse_dir.exists():
        print(f"[verify-runtime] 缺少 wheelhouse 目录：{wheelhouse_dir}", file=sys.stderr)
        return 1
    wheels = sorted(wheelhouse_dir.glob("*.whl"))
    if not wheels:
        print(
            "[verify-runtime] wheelhouse 为空。训练版安装包必须包含离线 wheels（torch/unsloth 等）。",
            file=sys.stderr,
        )
        return 1

    python_runtime_dir = RUNTIME_DIR / "python-runtime"
    if not python_runtime_dir.exists():
        print(f"[verify-runtime] 缺少 python-runtime 目录：{python_runtime_dir}", file=sys.stderr)
        return 1
    if not (python_runtime_dir / "python.exe").exists() and not (python_runtime_dir / "bin" / "python").exists():
        print(
            "[verify-runtime] python-runtime 中未找到解释器（python.exe 或 bin/python）。",
            file=sys.stderr,
        )
        return 1

    runtime_id, package_count = _verify_manifest(RUNTIME_DIR / "manifest.json")
    size_text = _format_size(_directory_size(RUNTIME_DIR))
    print(f"[verify-runtime] runtime id: {runtime_id}")
    print(f"[verify-runtime] package count: {package_count}")
    print(f"[verify-runtime] wheel count: {len(wheels)}")
    print(f"[verify-runtime] size: {size_text}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
