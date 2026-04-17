#!/usr/bin/env python3
"""Generate the Windows LLM GPU runtime lockfile from backend/uv.lock.

The lockfile is intentionally separate from backend install dependencies and
contains the full transitive closure required by Unsloth training runtime on:
  - OS: Windows
  - Arch: AMD64
  - Python: 3.11
"""

from __future__ import annotations

import argparse
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

try:
    from packaging.markers import Marker
except Exception as exc:  # pragma: no cover - packaging is expected in dev env
    raise SystemExit(
        "Missing dependency `packaging`. Install it first, then re-run this script."
    ) from exc


DEFAULT_ROOT_PACKAGES = ("torch", "unsloth", "datasets", "transformers", "trl")


@dataclass(frozen=True)
class RuntimeTarget:
    sys_platform: str = "win32"
    platform_machine: str = "AMD64"
    python_version: str = "3.11"
    python_full_version: str = "3.11.9"
    platform_system: str = "Windows"
    os_name: str = "nt"
    implementation_name: str = "cpython"
    platform_python_implementation: str = "CPython"
    extra: str = ""

    def as_marker_env(self) -> dict[str, str]:
        return {
            "sys_platform": self.sys_platform,
            "platform_machine": self.platform_machine,
            "python_version": self.python_version,
            "python_full_version": self.python_full_version,
            "platform_system": self.platform_system,
            "os_name": self.os_name,
            "implementation_name": self.implementation_name,
            "platform_python_implementation": self.platform_python_implementation,
            "extra": self.extra,
        }


def normalize_name(raw: str) -> str:
    return raw.strip().lower().replace("_", "-")


def marker_matches(marker: str, env: dict[str, str]) -> bool:
    try:
        return Marker(marker).evaluate(env)
    except Exception:
        return False


def resolve_transitive_closure(
    *,
    packages: dict[str, dict],
    roots: tuple[str, ...],
    env: dict[str, str],
) -> list[str]:
    seen: set[str] = set()
    pending = [normalize_name(root) for root in roots]

    while pending:
        name = pending.pop()
        if name in seen:
            continue
        pkg = packages.get(name)
        if pkg is None:
            raise RuntimeError(f"Package {name} is missing from uv.lock")
        seen.add(name)

        for dep in pkg.get("dependencies", []):
            marker = dep.get("marker")
            if marker and not marker_matches(marker, env):
                continue
            dep_name = normalize_name(dep["name"])
            if dep_name not in seen:
                pending.append(dep_name)

    return sorted(seen)


def generate_lockfile(
    *,
    uv_lock_path: Path,
    output_path: Path,
    roots: tuple[str, ...],
    target: RuntimeTarget,
) -> int:
    lock_data = tomllib.loads(uv_lock_path.read_text(encoding="utf-8"))
    package_rows = lock_data.get("package", [])
    packages = {normalize_name(row["name"]): row for row in package_rows}
    resolved = resolve_transitive_closure(
        packages=packages,
        roots=roots,
        env=target.as_marker_env(),
    )

    lines = [
        "# Windows LLM GPU runtime lock (Python 3.11, win_amd64, CUDA 12.1 runtime packaging)",
        "# Generated from backend/uv.lock filtered to the transitive closure of:",
        "# " + ", ".join(roots),
        "",
    ]
    for name in resolved:
        lines.append(f"{name}=={packages[name]['version']}")
    lines.append("")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")
    return len(resolved)


def build_parser() -> argparse.ArgumentParser:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Generate Windows LLM runtime lockfile.")
    parser.add_argument(
        "--uv-lock",
        default=str(repo_root / "backend" / "uv.lock"),
        help="Path to uv.lock",
    )
    parser.add_argument(
        "--output",
        default=str(
            repo_root
            / "backend"
            / "runtime"
            / "windows-llm-gpu"
            / "requirements.windows-py311-cu121.lock"
        ),
        help="Output lockfile path",
    )
    parser.add_argument(
        "--roots",
        nargs="+",
        default=list(DEFAULT_ROOT_PACKAGES),
        help="Top-level runtime packages to include",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    uv_lock_path = Path(args.uv_lock).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    roots = tuple(normalize_name(item) for item in args.roots)

    if not uv_lock_path.exists():
        print(f"[runtime-lock] uv.lock not found: {uv_lock_path}", file=sys.stderr)
        return 1

    try:
        package_count = generate_lockfile(
            uv_lock_path=uv_lock_path,
            output_path=output_path,
            roots=roots,
            target=RuntimeTarget(),
        )
    except RuntimeError as exc:
        print(f"[runtime-lock] {exc}", file=sys.stderr)
        return 1

    print(f"[runtime-lock] wrote: {output_path}")
    print(f"[runtime-lock] package count: {package_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
