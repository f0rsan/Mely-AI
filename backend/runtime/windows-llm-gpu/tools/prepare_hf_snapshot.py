#!/usr/bin/env python3
"""Prepare a HuggingFace model snapshot for the LLM training runtime."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Prepare HuggingFace snapshot cache.")
    parser.add_argument("--repo-id", required=True, help="HuggingFace repository id")
    parser.add_argument("--cache-dir", required=True, help="Target HuggingFace cache root")
    parser.add_argument("--revision", default=None, help="Optional model revision")
    parser.add_argument(
        "--local-files-only",
        action="store_true",
        help="Only use local cache and never download from network",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cache_dir = Path(args.cache_dir).expanduser().resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)

    try:
        from huggingface_hub import snapshot_download

        snapshot_path = snapshot_download(
            repo_id=args.repo_id,
            revision=args.revision,
            cache_dir=str(cache_dir),
            local_files_only=args.local_files_only,
        )
    except Exception as exc:
        print(f"[hf-snapshot] 准备训练基础权重失败：{exc}", file=sys.stderr)
        return 1

    payload = {
        "repoId": args.repo_id,
        "revision": args.revision,
        "cacheDir": str(cache_dir),
        "snapshotPath": str(snapshot_path),
        "preparedAt": utc_now(),
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
