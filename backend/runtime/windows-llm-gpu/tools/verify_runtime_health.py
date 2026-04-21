#!/usr/bin/env python3
"""Probe runtime health on target machine before launching training worker."""

from __future__ import annotations

import argparse
import importlib
import json
from datetime import datetime, timezone


FOLLOWUP_MODULES = ("datasets", "transformers", "trl")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Verify runtime health for local LLM training.")
    parser.add_argument("--json", action="store_true", help="Print JSON result.")
    return parser


def _ok(name: str, **details: str) -> dict[str, str]:
    payload = {"name": name, "status": "ok"}
    payload.update(details)
    return payload


def _failed(name: str, code: str, message: str, *, error: str | None = None) -> dict[str, str]:
    payload = {
        "name": name,
        "status": "failed",
        "code": code,
        "message": message,
    }
    if error:
        payload["error"] = error
    return payload


def _check_torch() -> dict[str, str]:
    try:
        import torch
    except Exception as exc:
        return _failed(
            "torch",
            "torch_import_failed",
            "训练运行时缺少 torch，请先执行“修复训练环境”后重试。",
            error=f"{exc.__class__.__name__}: {exc}",
        )

    if not torch.cuda.is_available():
        return _failed(
            "torch",
            "torch_cuda_unavailable",
            "未检测到可用 CUDA 加速器，无法启动训练。请确认显卡驱动与 CUDA 环境后重试。",
        )

    cuda_version = str(getattr(torch.version, "cuda", "") or "").strip()
    if not cuda_version:
        return _failed(
            "torch",
            "torch_missing_cuda_build",
            "当前 torch 不含 CUDA 支持，无法启动训练。请先修复训练环境。",
        )

    try:
        device_name = str(torch.cuda.get_device_name(0))
    except Exception:
        device_name = ""
    return _ok("torch", cuda_version=cuda_version, device_name=device_name)


def _check_unsloth() -> dict[str, str]:
    try:
        importlib.import_module("unsloth")
    except Exception as exc:
        return _failed(
            "unsloth",
            "unsloth_import_failed",
            "训练运行时无法加载 unsloth，请先执行“修复训练环境”后重试。",
            error=f"{exc.__class__.__name__}: {exc}",
        )
    return _ok("unsloth")


def _check_followup_modules() -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for module_name in FOLLOWUP_MODULES:
        try:
            importlib.import_module(module_name)
        except Exception as exc:
            items.append(
                _failed(
                    module_name,
                    "module_import_failed",
                    f"训练运行时缺少依赖 {module_name}，请先执行“修复训练环境”后重试。",
                    error=f"{exc.__class__.__name__}: {exc}",
                )
            )
        else:
            items.append(_ok(module_name))
    return items


def build_payload() -> dict[str, object]:
    checks: list[dict[str, str]] = []
    checks.append(_check_torch())
    if checks[-1]["status"] == "ok":
        checks.append(_check_unsloth())
    checks.extend(_check_followup_modules())

    failed = [item for item in checks if item.get("status") == "failed"]
    if failed:
        message = str(failed[0].get("message") or "训练运行时健康检测失败。")
        return {
            "timestamp": utc_now(),
            "status": "failed",
            "message": message,
            "checks": checks,
            "failed": failed,
        }

    return {
        "timestamp": utc_now(),
        "status": "ok",
        "message": "运行时健康检测通过。",
        "checks": checks,
    }


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    payload = build_payload()
    if args.json:
        print(json.dumps(payload, ensure_ascii=False))
    else:
        for item in payload.get("checks", []):
            name = item.get("name", "unknown")
            status = item.get("status", "unknown")
            if status == "ok":
                print(f"[ok] {name}")
            else:
                print(f"[failed] {name} -> {item.get('message', '')}")
    return 0 if payload.get("status") == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
