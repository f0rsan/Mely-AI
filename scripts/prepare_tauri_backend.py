#!/usr/bin/env python3
"""Stage the packaged backend into src-tauri/resources for Tauri bundles."""

from __future__ import annotations

import os
import shutil
import sys
import argparse
import socket
import subprocess
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = REPO_ROOT / "backend" / "dist" / "mely-backend"
TARGET_DIR = REPO_ROOT / "src-tauri" / "resources" / "mely-backend"
DEFAULT_FRESHNESS_SOURCES = (
    REPO_ROOT / "backend" / "app",
    REPO_ROOT / "backend" / "entry.py",
    REPO_ROOT / "backend" / "mely_backend.spec",
    REPO_ROOT / "backend" / "pyproject.toml",
)
REQUIRED_API_PROBES = (
    ("/api/health", "health"),
    ("/api/llm-runtime/readiness?mode=standard&baseModel=qwen2.5%3A3b&autoFix=false", "LLM runtime readiness"),
)


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


def iter_source_files(source_roots: list[Path] | tuple[Path, ...]):
    for root in source_roots:
        if root.is_file():
            yield root
            continue
        if not root.exists():
            continue
        for child in root.rglob("*"):
            if not child.is_file():
                continue
            if "__pycache__" in child.parts:
                continue
            if child.suffix in {".pyc", ".pyo"}:
                continue
            yield child


def find_stale_backend_sources(
    *,
    backend_binary: Path,
    source_roots: list[Path] | tuple[Path, ...] = DEFAULT_FRESHNESS_SOURCES,
) -> list[Path]:
    binary_mtime = backend_binary.stat().st_mtime
    return sorted(
        source_file
        for source_file in iter_source_files(source_roots)
        if source_file.stat().st_mtime > binary_mtime
    )


def should_require_fresh(args: argparse.Namespace) -> bool:
    if args.require_source_fresh:
        return True
    raw = os.environ.get("MELY_REQUIRE_FRESH_BACKEND", "")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def should_verify_api_compatibility(args: argparse.Namespace) -> bool:
    if args.verify_api_compatibility:
        return True
    raw = os.environ.get("MELY_VERIFY_BACKEND_API_COMPATIBILITY", "")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def pick_backend_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def probe_endpoint_status(url: str) -> int:
    try:
        with urlopen(url, timeout=10) as response:
            return int(response.status)
    except HTTPError as exc:
        return int(exc.code)
    except URLError:
        return 0


def verify_backend_api_compatibility(backend_binary: Path) -> None:
    port = pick_backend_port()
    process = subprocess.Popen(
        [str(backend_binary)],
        env={
            **os.environ,
            "MELY_BACKEND_PORT": str(port),
        },
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        base_url = f"http://127.0.0.1:{port}"
        deadline = time.time() + 15
        while time.time() < deadline:
            if process.poll() is not None:
                raise RuntimeError("backend sidecar exited before API compatibility check completed.")
            if probe_endpoint_status(f"{base_url}/api/health") == 200:
                break
            time.sleep(0.2)
        else:
            raise RuntimeError("backend sidecar did not become healthy within 15 seconds.")

        for relative_path, label in REQUIRED_API_PROBES:
            status = probe_endpoint_status(f"{base_url}{relative_path}")
            if status != 200:
                raise RuntimeError(f"{label} endpoint check failed with HTTP {status}.")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Stage packaged backend into Tauri resources.")
    parser.add_argument(
        "--require-source-fresh",
        action="store_true",
        help="Fail if backend source files are newer than the packaged backend executable.",
    )
    parser.add_argument(
        "--verify-api-compatibility",
        action="store_true",
        help="Run the packaged backend and verify required API endpoints before staging.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
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

    if should_require_fresh(args):
        stale_sources = find_stale_backend_sources(backend_binary=backend_binary)
        if stale_sources:
            print(
                "[prepare_tauri_backend] Backend bundle is older than backend source files.",
                file=sys.stderr,
            )
            print(
                "[prepare_tauri_backend] Rebuild the backend sidecar before Tauri packaging.",
                file=sys.stderr,
            )
            for path in stale_sources[:20]:
                print(f"  - {path.relative_to(REPO_ROOT)}", file=sys.stderr)
            if len(stale_sources) > 20:
                print(f"  - ... and {len(stale_sources) - 20} more", file=sys.stderr)
            return 1

    if should_verify_api_compatibility(args):
        try:
            verify_backend_api_compatibility(backend_binary)
        except RuntimeError as exc:
            print(f"[prepare_tauri_backend] {exc}", file=sys.stderr)
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
