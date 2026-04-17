#!/usr/bin/env python3
"""Install or repair the local LLM training runtime from a seed package."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


REQUIRED_IMPORT_MODULES = ("torch", "unsloth", "datasets", "transformers", "trl")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def run(command: list[str], *, cwd: Path | None = None) -> None:
    process = subprocess.run(command, cwd=str(cwd) if cwd else None)
    if process.returncode != 0:
        command_text = " ".join(command)
        raise RuntimeError(f"命令执行失败: {command_text}")


def platform_python(path: Path) -> Path:
    if os.name == "nt":
        return path / "python.exe"
    return path / "bin" / "python"


def venv_python(path: Path) -> Path:
    if os.name == "nt":
        return path / "Scripts" / "python.exe"
    return path / "bin" / "python"


def read_manifest(seed_root: Path) -> dict:
    manifest_path = seed_root / "manifest.json"
    if not manifest_path.exists():
        raise RuntimeError(f"缺少 manifest.json: {manifest_path}")
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError("manifest.json 格式错误")
    return data


def resolve_target_root(seed_root: Path, provided_target: str | None) -> Path:
    if provided_target:
        return Path(provided_target).expanduser().resolve()

    manifest = read_manifest(seed_root)
    runtime_id = str(manifest.get("runtimeId") or "llm-win-cu121-py311-v1")
    default_root = Path.home() / ".mely" / "runtimes" / "llm" / runtime_id
    return default_root.resolve()


def ensure_seed_contract(seed_root: Path) -> tuple[Path, Path, Path]:
    runtime_python_dir = seed_root / "python-runtime"
    wheelhouse_dir = seed_root / "wheelhouse"
    lockfile_path = seed_root / "requirements-lock.txt"
    if not runtime_python_dir.exists():
        raise RuntimeError(f"缺少独立 Python runtime: {runtime_python_dir}")
    if not wheelhouse_dir.exists():
        raise RuntimeError(f"缺少离线 wheelhouse: {wheelhouse_dir}")
    if not lockfile_path.exists():
        raise RuntimeError(f"缺少 requirements lockfile: {lockfile_path}")
    return runtime_python_dir, wheelhouse_dir, lockfile_path


def update_runtime_manifest(
    *,
    seed_root: Path,
    target_root: Path,
    python_exe: Path,
    worker_script: Path,
) -> None:
    source_manifest = read_manifest(seed_root)
    runtime_manifest = {
        **source_manifest,
        "installedAt": utc_now(),
        "python": {
            "version": source_manifest.get("python", {}).get("version"),
            "exePath": str(python_exe),
        },
        "worker": {
            "entryScript": str(worker_script),
        },
        "readiness": {
            "state": "READY",
            "lastCheckedAt": utc_now(),
            "repairCount": int(
                source_manifest.get("readiness", {}).get("repairCount") or 0
            ),
            "lastErrorCode": None,
        },
    }
    (target_root / "manifest.runtime.json").write_text(
        json.dumps(runtime_manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Bootstrap local LLM runtime from seed package.")
    parser.add_argument(
        "--seed-root",
        required=True,
        help="Path to the seed runtime directory (contains manifest.json / wheelhouse)",
    )
    parser.add_argument(
        "--target-root",
        help="Install target directory. Defaults to ~/.mely/runtimes/llm/<runtimeId>",
    )
    parser.add_argument(
        "--force-reinstall",
        action="store_true",
        help="Delete target root before re-installing",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    seed_root = Path(args.seed_root).expanduser().resolve()
    if not seed_root.exists():
        print(f"[runtime-bootstrap] seed root not found: {seed_root}", file=sys.stderr)
        return 1

    target_root = resolve_target_root(seed_root, args.target_root)
    runtime_python_dir, wheelhouse_dir, lockfile_path = ensure_seed_contract(seed_root)

    if args.force_reinstall and target_root.exists():
        shutil.rmtree(target_root)

    target_root.mkdir(parents=True, exist_ok=True)
    target_python_root = target_root / "python-runtime"
    if target_python_root.exists():
        shutil.rmtree(target_python_root)
    shutil.copytree(runtime_python_dir, target_python_root)

    standalone_python = platform_python(target_python_root)
    if not standalone_python.exists():
        print(
            f"[runtime-bootstrap] standalone python missing: {standalone_python}",
            file=sys.stderr,
        )
        return 1

    venv_dir = target_root / "venv"
    if venv_dir.exists():
        shutil.rmtree(venv_dir)

    try:
        run([str(standalone_python), "-m", "venv", str(venv_dir)])
        venv_py = venv_python(venv_dir)
        run(
            [
                str(venv_py),
                "-m",
                "pip",
                "install",
                "--no-index",
                "--find-links",
                str(wheelhouse_dir),
                "--requirement",
                str(lockfile_path),
            ]
        )
        verify_script = seed_root / "tools" / "verify_import_chain.py"
        run(
            [
                str(venv_py),
                str(verify_script),
                "--modules",
                *REQUIRED_IMPORT_MODULES,
            ]
        )
    except RuntimeError as exc:
        print(f"[runtime-bootstrap] {exc}", file=sys.stderr)
        return 1

    worker_script = (seed_root / "tools" / "unsloth_worker.py").resolve()
    update_runtime_manifest(
        seed_root=seed_root,
        target_root=target_root,
        python_exe=venv_python(venv_dir).resolve(),
        worker_script=worker_script,
    )

    print(f"[runtime-bootstrap] installed: {target_root}")
    print(f"[runtime-bootstrap] python: {venv_python(venv_dir)}")
    print("[runtime-bootstrap] readiness: READY")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
