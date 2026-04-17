#!/usr/bin/env python3
"""Verify import readiness for the Windows LLM training runtime."""

from __future__ import annotations

import argparse
import importlib
import json
import sys
from datetime import datetime, timezone


DEFAULT_MODULES = ("torch", "unsloth", "datasets", "transformers", "trl")
GPU_DEFERRED_MODULES = {"unsloth"}
GPU_REQUIRED_SNIPPETS = (
    "cannot find any torch accelerator",
    "you need a gpu",
    "no gpu found",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Verify required runtime imports.")
    parser.add_argument(
        "--modules",
        nargs="+",
        default=list(DEFAULT_MODULES),
        help="Module names to verify",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print JSON result instead of plain text",
    )
    return parser


def _is_deferred_gpu_check(module_name: str, exc: Exception) -> bool:
    if module_name not in GPU_DEFERRED_MODULES:
        return False
    message = str(exc).strip().lower()
    return any(snippet in message for snippet in GPU_REQUIRED_SNIPPETS)


def check_module(module_name: str) -> dict[str, str]:
    try:
        importlib.import_module(module_name)
        return {"module": module_name, "status": "ok"}
    except Exception as exc:
        if _is_deferred_gpu_check(module_name, exc):
            return {
                "module": module_name,
                "status": "deferred_gpu_check",
                "error": f"{exc.__class__.__name__}: {exc}",
            }
        return {
            "module": module_name,
            "status": "failed",
            "error": f"{exc.__class__.__name__}: {exc}",
        }


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    modules = [name.strip() for name in args.modules if name.strip()]
    results: list[dict[str, str]] = []
    failures = 0

    for module_name in modules:
        result = check_module(module_name)
        results.append(result)
        if result["status"] == "failed":
            failures += 1

    payload = {
        "timestamp": utc_now(),
        "status": "ok" if failures == 0 else "failed",
        "modules": results,
    }

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        for item in results:
            if item["status"] == "ok":
                print(f"[ok] {item['module']}")
            elif item["status"] == "deferred_gpu_check":
                print(f"[deferred] {item['module']} -> {item['error']}")
            else:
                print(f"[failed] {item['module']} -> {item['error']}")

    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
