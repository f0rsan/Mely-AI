#!/usr/bin/env python3
"""Stage the packaged backend into src-tauri/resources for Tauri bundles."""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = REPO_ROOT / "backend" / "dist" / "mely-backend"
TARGET_DIR = REPO_ROOT / "src-tauri" / "resources" / "mely-backend"


def resolve_source_dir() -> Path:
    raw = os.environ.get("MELY_BACKEND_SOURCE")
    if raw:
        return Path(raw).expanduser().resolve()
    return DEFAULT_SOURCE.resolve()


def find_backend_binary(source_dir: Path) -> Path | None:
    for candidate in ("mely-backend.exe", "mely-backend"):
        path = source_dir / candidate
        if path.exists():
            return path
    return None


def format_size(total_bytes: int) -> str:
    units = ["B", "KB", "MB", "GB"]
    value = float(total_bytes)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            if unit == "B":
                return f"{int(value)} {unit}"
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{total_bytes} B"


def directory_size(path: Path) -> int:
    total = 0
    for child in path.rglob("*"):
        if child.is_file():
            total += child.stat().st_size
    return total


def main() -> int:
    source_dir = resolve_source_dir()
    if not source_dir.exists():
        print(
            f"[prepare_tauri_backend] Backend bundle not found: {source_dir}",
            file=sys.stderr,
        )
        print(
            "[prepare_tauri_backend] Build the packaged backend first or set MELY_BACKEND_SOURCE.",
            file=sys.stderr,
        )
        return 1

    backend_binary = find_backend_binary(source_dir)
    if backend_binary is None:
        print(
            f"[prepare_tauri_backend] No backend executable found in: {source_dir}",
            file=sys.stderr,
        )
        return 1

    TARGET_DIR.parent.mkdir(parents=True, exist_ok=True)
    if TARGET_DIR.exists():
        shutil.rmtree(TARGET_DIR)
    shutil.copytree(source_dir, TARGET_DIR)

    staged_binary = TARGET_DIR / backend_binary.name
    if not staged_binary.exists():
        print(
            f"[prepare_tauri_backend] Staged backend executable is missing: {staged_binary}",
            file=sys.stderr,
        )
        return 1

    print(f"[prepare_tauri_backend] source: {source_dir}")
    print(f"[prepare_tauri_backend] target: {TARGET_DIR}")
    print(
        f"[prepare_tauri_backend] staged executable: {staged_binary.name} ({format_size(directory_size(TARGET_DIR))})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
