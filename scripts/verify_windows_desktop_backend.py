#!/usr/bin/env python3
"""Smoke-test the built Windows desktop executable and its bundled backend."""

from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


DEFAULT_PORT = 8000
DEFAULT_TIMEOUT_SECONDS = 20.0
HEALTH_URL = f"http://127.0.0.1:{DEFAULT_PORT}/api/health"
RUNTIME_URL = f"http://127.0.0.1:{DEFAULT_PORT}/api/llm/runtime"
READINESS_URL = (
    f"http://127.0.0.1:{DEFAULT_PORT}"
    "/api/llm-runtime/readiness?mode=standard&baseModel=qwen2.5%3A3b&autoFix=false"
)
REQUIRED_HEALTH_FEATURE = "llmRuntimeReadiness"
REQUIRED_RUNTIME_FIELD = "buildVersion"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Launch the built Windows desktop app and verify its bundled backend APIs."
    )
    parser.add_argument("--executable", required=True, help="Path to mely-ai.exe")
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=DEFAULT_TIMEOUT_SECONDS,
        help="How long to wait for the desktop app backend to become ready.",
    )
    return parser


def ensure_port_is_free(port: int) -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        if sock.connect_ex(("127.0.0.1", port)) == 0:
            raise RuntimeError(
                f"端口 {port} 已被占用，无法验证桌面安装包的内置后端。请先关闭现有 Mely 进程后重试。"
            )


def probe_json(url: str) -> tuple[int, dict | None]:
    try:
        with urlopen(url, timeout=5) as response:
            status = int(response.status)
            content_type = response.headers.get("Content-Type", "")
            if "json" not in content_type.lower():
                return status, None
            import json

            payload = json.loads(response.read().decode("utf-8"))
            return status, payload if isinstance(payload, dict) else None
    except HTTPError as exc:
        return int(exc.code), None
    except (URLError, OSError, ValueError):
        return 0, None


def wait_for_desktop_backend_ready(timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS) -> None:
    deadline = time.time() + timeout_seconds
    last_health_status = 0
    last_runtime_status = 0
    last_readiness_status = 0

    while time.time() < deadline:
        last_health_status, health_payload = probe_json(HEALTH_URL)
        if last_health_status == 200:
            feature_enabled = (
                isinstance(health_payload, dict)
                and isinstance(health_payload.get("api"), dict)
                and isinstance(health_payload["api"].get("features"), dict)
                and health_payload["api"]["features"].get(REQUIRED_HEALTH_FEATURE) is True
            )
            if not feature_enabled:
                raise RuntimeError("桌面后端健康接口缺少训练环境能力标记，当前打包产物仍是旧后端。")

            last_runtime_status, runtime_payload = probe_json(RUNTIME_URL)
            if last_runtime_status == 200:
                if not isinstance(runtime_payload, dict) or REQUIRED_RUNTIME_FIELD not in runtime_payload:
                    raise RuntimeError(
                        "桌面后端缺少构建版本字段，当前打包产物可能仍是旧版本。"
                    )

            last_readiness_status, _readiness_payload = probe_json(READINESS_URL)
            if last_runtime_status == 200 and last_readiness_status == 200:
                return

        time.sleep(0.25)

    raise RuntimeError(
        "桌面可执行体启动后未通过后端验收。"
        f" health={last_health_status}, runtime={last_runtime_status}, readiness={last_readiness_status}."
    )


def terminate_process_tree(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return

    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return

    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def verify_desktop_backend(executable: Path, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS) -> None:
    ensure_port_is_free(DEFAULT_PORT)
    process = subprocess.Popen(
        [str(executable)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        wait_for_desktop_backend_ready(timeout_seconds=timeout_seconds)
    finally:
        terminate_process_tree(process)


def main() -> int:
    args = build_parser().parse_args()
    executable = Path(args.executable).expanduser().resolve()
    if not executable.exists():
        print(f"[verify-desktop] 未找到桌面可执行体：{executable}", file=sys.stderr)
        return 1

    try:
        verify_desktop_backend(executable, timeout_seconds=args.timeout_seconds)
    except RuntimeError as exc:
        print(f"[verify-desktop] {exc}", file=sys.stderr)
        return 1

    print(f"[verify-desktop] verified desktop backend: {executable}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
