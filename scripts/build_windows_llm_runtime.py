#!/usr/bin/env python3
"""Build the Windows LLM GPU training runtime seed package.

Output contract (seed package):
  llm-runtime/
    python-runtime/               # independent Python runtime directory
    wheelhouse/                  # offline wheels for runtime install
    requirements-lock.txt
    tools/
      unsloth_worker.py
      bootstrap_runtime.py
      verify_import_chain.py
      prepare_hf_snapshot.py
    manifest.json
    SHA256SUMS.txt
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_RUNTIME_ID = "llm-win-cu121-py311-v1"
DEFAULT_LOCKFILE_REL = Path("backend/runtime/windows-llm-gpu/requirements.windows-py311-cu121.lock")
DEFAULT_WORKER_SOURCE_REL = Path("backend/app/services/unsloth_worker.py")
DEFAULT_RUNTIME_TOOLS_REL = Path("backend/runtime/windows-llm-gpu/tools")
DEFAULT_MANIFEST_TEMPLATE_REL = Path("backend/runtime/windows-llm-gpu/runtime-manifest.template.json")
DEFAULT_OUTPUT_REL = Path("build/windows-llm-runtime")
DEFAULT_STAGE_REL = Path("src-tauri/resources/llm-runtime")
DEFAULT_TORCH_INDEX_URL = "https://download.pytorch.org/whl/cu121"
IMPORT_MODULES = ("torch", "unsloth", "datasets", "transformers", "trl")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file_obj:
        for chunk in iter(lambda: file_obj.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def directory_size(path: Path) -> int:
    total = 0
    for child in path.rglob("*"):
        if child.is_file():
            total += child.stat().st_size
    return total


def format_size(total_bytes: int) -> str:
    units = ("B", "KB", "MB", "GB", "TB")
    value = float(total_bytes)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            if unit == "B":
                return f"{int(value)} {unit}"
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{total_bytes} B"


def run(command: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    command_text = " ".join(command)
    print(f"[llm-runtime-build] $ {command_text}")
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    process = subprocess.run(command, cwd=str(cwd) if cwd else None, env=merged_env)
    if process.returncode != 0:
        raise RuntimeError(f"command failed ({process.returncode}): {command_text}")


def run_capture(command: list[str], *, cwd: Path | None = None) -> str:
    process = subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
    )
    if process.returncode != 0:
        command_text = " ".join(command)
        stderr_text = process.stderr.strip()
        raise RuntimeError(f"command failed ({process.returncode}): {command_text}\n{stderr_text}")
    return process.stdout.strip()


def normalize_path(raw: str, *, base_dir: Path) -> Path:
    path = Path(raw).expanduser()
    if path.is_absolute():
        return path
    return (base_dir / path).resolve()


def resolve_python_executable(runtime_python_arg: str | None) -> Path:
    if runtime_python_arg:
        python_exe = Path(runtime_python_arg).expanduser().resolve()
        if not python_exe.exists():
            raise RuntimeError(f"runtime python not found: {python_exe}")
        return python_exe

    if os.name == "nt":
        try:
            resolved = run_capture(["py", "-3.11", "-c", "import sys; print(sys.executable)"])
            python_exe = Path(resolved).expanduser().resolve()
            if python_exe.exists():
                return python_exe
        except RuntimeError:
            raise RuntimeError(
                "未找到 Python 3.11 运行时。"
                "请先安装 Python 3.11，或通过 --runtime-python 显式指定独立运行时解释器。"
            )

    python_exe = Path(sys.executable).expanduser().resolve()
    if not python_exe.exists():
        raise RuntimeError("failed to resolve python executable")
    return python_exe


def python_info(python_exe: Path) -> dict[str, Any]:
    probe = (
        "import json,platform,sys;"
        "print(json.dumps({"
        "'executable': sys.executable,"
        "'version': platform.python_version(),"
        "'base_prefix': sys.base_prefix,"
        "'platform': sys.platform,"
        "}))"
    )
    output = run_capture([str(python_exe), "-c", probe])
    data = json.loads(output)
    if not isinstance(data, dict):
        raise RuntimeError("python probe returned invalid payload")
    return data


def copy_python_runtime(*, python_exe: Path, destination: Path) -> dict[str, Any]:
    info = python_info(python_exe)
    base_prefix = Path(str(info["base_prefix"])).expanduser().resolve()
    if not base_prefix.exists():
        raise RuntimeError(f"python base prefix not found: {base_prefix}")
    if destination.exists():
        shutil.rmtree(destination)

    ignore = shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo")
    shutil.copytree(base_prefix, destination, ignore=ignore)
    copied_python = destination / ("python.exe" if os.name == "nt" else "bin/python")
    if not copied_python.exists():
        fallback_python = destination / ("python.exe" if destination.joinpath("python.exe").exists() else "python")
        if fallback_python.exists():
            copied_python = fallback_python
        else:
            raise RuntimeError(f"copied runtime missing python executable: {destination}")

    return {
        "version": str(info.get("version") or ""),
        "sourceExecutable": str(python_exe),
        "sourceBasePrefix": str(base_prefix),
        "copiedExecutable": str(copied_python),
        "copiedSizeBytes": directory_size(destination),
    }


def parse_lockfile_packages(lockfile_path: Path) -> list[str]:
    packages: list[str] = []
    for line in lockfile_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "==" in line:
            packages.append(line)
    return packages


def copy_runtime_tools(*, tools_source_dir: Path, runtime_tools_dir: Path, worker_source: Path) -> Path:
    if not worker_source.exists():
        raise RuntimeError(f"worker source not found: {worker_source}")
    if not tools_source_dir.exists():
        raise RuntimeError(f"runtime tools source not found: {tools_source_dir}")

    runtime_tools_dir.mkdir(parents=True, exist_ok=True)
    for name in ("bootstrap_runtime.py", "verify_import_chain.py", "prepare_hf_snapshot.py"):
        shutil.copy2(tools_source_dir / name, runtime_tools_dir / name)
    worker_dest = runtime_tools_dir / "unsloth_worker.py"
    shutil.copy2(worker_source, worker_dest)
    return worker_dest


def build_wheelhouse(
    *,
    python_exe: Path,
    lockfile_path: Path,
    wheelhouse_dir: Path,
    python_version_tag: str,
    platform_tag: str,
    torch_index_url: str,
) -> dict[str, Any]:
    if wheelhouse_dir.exists():
        shutil.rmtree(wheelhouse_dir)
    wheelhouse_dir.mkdir(parents=True, exist_ok=True)

    command = [
        str(python_exe),
        "-m",
        "pip",
        "download",
        "--dest",
        str(wheelhouse_dir),
        "--requirement",
        str(lockfile_path),
        "--only-binary",
        ":all:",
        "--platform",
        platform_tag,
        "--python-version",
        python_version_tag,
        "--implementation",
        "cp",
        "--abi",
        f"cp{python_version_tag}",
        "--extra-index-url",
        torch_index_url,
    ]
    run(command, env={"PIP_DISABLE_PIP_VERSION_CHECK": "1"})

    wheels = sorted(wheelhouse_dir.glob("*.whl"))
    if not wheels:
        raise RuntimeError("wheelhouse build produced no wheels")

    return {
        "wheelCount": len(wheels),
        "totalSizeBytes": directory_size(wheelhouse_dir),
    }


def venv_python(venv_dir: Path) -> Path:
    if os.name == "nt":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def run_smoke_test(
    *,
    python_exe: Path,
    wheelhouse_dir: Path,
    lockfile_path: Path,
    worker_script: Path,
    verify_script: Path,
    build_root: Path,
) -> dict[str, Any]:
    smoke_root = build_root / "smoke-test"
    smoke_venv = smoke_root / ".venv"
    if smoke_root.exists():
        shutil.rmtree(smoke_root)
    smoke_root.mkdir(parents=True, exist_ok=True)

    run([str(python_exe), "-m", "venv", str(smoke_venv)])
    smoke_python = venv_python(smoke_venv)

    run(
        [
            str(smoke_python),
            "-m",
            "pip",
            "install",
            "--no-index",
            "--find-links",
            str(wheelhouse_dir),
            "--requirement",
            str(lockfile_path),
        ],
        env={"PIP_DISABLE_PIP_VERSION_CHECK": "1"},
    )

    run([str(smoke_python), str(verify_script), "--modules", *IMPORT_MODULES])

    dataset_path = smoke_root / "dataset.jsonl"
    dataset_path.write_text(
        json.dumps(
            {
                "conversations": [
                    {"from": "human", "value": "你好"},
                    {"from": "gpt", "value": "你好，我是训练运行时 smoke test。"},
                ]
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    run_root = smoke_root / "worker-run"
    payload = {
        "jobId": "runtime-smoke-test",
        "mode": "light",
        "baseModel": "qwen2.5:3b",
        "unslothModelName": "Qwen/Qwen2.5-3B-Instruct",
        "datasetPaths": [str(dataset_path)],
        "outputDir": str(run_root),
        "adapterOutputDir": str(run_root / "adapter"),
        "checkpointDir": str(run_root / "checkpoints"),
        "ggufOutputDir": str(run_root / "gguf"),
        "cancelSentinelPath": str(run_root / "cancel.sentinel"),
        "logPath": str(run_root / "worker.log"),
        "maxSteps": 3,
        "checkpointEverySteps": 1,
        "dryRun": True,
        "dryRunStepDelaySeconds": 0.0,
    }
    config_path = smoke_root / "worker-config.json"
    config_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    process = subprocess.run(
        [str(smoke_python), str(worker_script), str(config_path), "--dry-run"],
        capture_output=True,
        text=True,
    )
    if process.returncode != 0:
        stderr_text = process.stderr.strip()
        stdout_text = process.stdout.strip()
        raise RuntimeError(
            "worker dry-run failed\n"
            f"stdout: {stdout_text}\n"
            f"stderr: {stderr_text}"
        )

    events = []
    for raw_line in process.stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        events.append(json.loads(line))

    if not events or events[-1].get("event") != "complete":
        raise RuntimeError("worker dry-run protocol did not emit a final complete event")

    shutil.rmtree(smoke_root, ignore_errors=True)
    return {
        "passed": True,
        "verifiedModules": list(IMPORT_MODULES),
        "workerDryRun": True,
        "checkedAt": utc_now(),
    }


def write_manifest(
    *,
    runtime_root: Path,
    runtime_id: str,
    python_meta: dict[str, Any],
    lockfile_path: Path,
    wheelhouse_meta: dict[str, Any],
    worker_script: Path,
    smoke_meta: dict[str, Any] | None,
    torch_index_url: str,
) -> dict[str, Any]:
    lockfile_target = runtime_root / "requirements-lock.txt"
    package_lines = parse_lockfile_packages(lockfile_target)

    manifest = {
        "schemaVersion": 1,
        "runtimeId": runtime_id,
        "generatedAt": utc_now(),
        "platform": {
            "os": "windows",
            "arch": "x86_64",
            "pythonVersion": str(python_meta.get("version") or ""),
            "cuda": "12.1",
        },
        "python": {
            "version": str(python_meta.get("version") or ""),
            "runtimeDir": "python-runtime",
            "runtimeExecutable": "python-runtime/python.exe",
            "sourceExecutable": str(python_meta.get("sourceExecutable") or ""),
            "sourceBasePrefix": str(python_meta.get("sourceBasePrefix") or ""),
        },
        "dependencySet": {
            "lockFile": "requirements-lock.txt",
            "lockFileSha256": sha256_file(lockfile_target),
            "packageCount": len(package_lines),
            "packages": package_lines,
            "wheelhouseDir": "wheelhouse",
            "wheelCount": int(wheelhouse_meta["wheelCount"]),
            "wheelhouseSizeBytes": int(wheelhouse_meta["totalSizeBytes"]),
            "torchIndexUrl": torch_index_url,
        },
        "worker": {
            "entryScript": "tools/unsloth_worker.py",
            "entryScriptSha256": sha256_file(worker_script),
        },
        "smokeTest": smoke_meta
        or {
            "passed": False,
            "checkedAt": None,
            "reason": "skipped",
        },
        "readiness": {
            "state": "NOT_READY",
            "lastCheckedAt": None,
            "repairCount": 0,
            "lastErrorCode": None,
        },
    }
    manifest_path = runtime_root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def write_sha256s(runtime_root: Path) -> dict[str, Any]:
    hash_path = runtime_root / "SHA256SUMS.txt"
    lines: list[str] = []
    file_count = 0
    for file_path in sorted(runtime_root.rglob("*")):
        if not file_path.is_file():
            continue
        if file_path.name == "SHA256SUMS.txt":
            continue
        relative = file_path.relative_to(runtime_root).as_posix()
        lines.append(f"{sha256_file(file_path)}  {relative}")
        file_count += 1

    hash_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {
        "fileCount": file_count,
        "sha256File": str(hash_path),
        "sha256FileSizeBytes": hash_path.stat().st_size if hash_path.exists() else 0,
    }


def copy_stage(runtime_root: Path, stage_dir: Path) -> dict[str, Any]:
    if stage_dir.exists():
        shutil.rmtree(stage_dir)
    stage_dir.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(runtime_root, stage_dir)
    return {
        "stageDir": str(stage_dir),
        "stagedSizeBytes": directory_size(stage_dir),
    }


def build_parser() -> argparse.ArgumentParser:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Build Windows LLM runtime seed package.")
    parser.add_argument("--runtime-id", default=DEFAULT_RUNTIME_ID)
    parser.add_argument(
        "--lockfile",
        default=str(repo_root / DEFAULT_LOCKFILE_REL),
        help="Pinned runtime dependency lockfile",
    )
    parser.add_argument(
        "--runtime-python",
        help="Python executable used as source for standalone runtime copy",
    )
    parser.add_argument(
        "--worker-source",
        default=str(repo_root / DEFAULT_WORKER_SOURCE_REL),
        help="Source worker script to bundle into runtime tools",
    )
    parser.add_argument(
        "--runtime-tools-dir",
        default=str(repo_root / DEFAULT_RUNTIME_TOOLS_REL),
        help="Directory containing runtime helper tools",
    )
    parser.add_argument(
        "--manifest-template",
        default=str(repo_root / DEFAULT_MANIFEST_TEMPLATE_REL),
        help="Manifest template path to keep with the seed package",
    )
    parser.add_argument(
        "--output-dir",
        default=str(repo_root / DEFAULT_OUTPUT_REL),
        help="Build output root (runtime will be generated under <output>/llm-runtime)",
    )
    parser.add_argument(
        "--stage-dir",
        default=str(repo_root / DEFAULT_STAGE_REL),
        help="Directory to stage runtime for Tauri resources",
    )
    parser.add_argument(
        "--python-version-tag",
        default="311",
        help="Python ABI tag used for wheel download (e.g. 311)",
    )
    parser.add_argument(
        "--platform-tag",
        default="win_amd64",
        help="Wheel platform tag",
    )
    parser.add_argument(
        "--torch-index-url",
        default=DEFAULT_TORCH_INDEX_URL,
        help="Extra package index for CUDA torch wheels",
    )
    parser.add_argument(
        "--skip-wheelhouse",
        action="store_true",
        help="Skip wheelhouse download (for local structural validation only)",
    )
    parser.add_argument(
        "--skip-python-copy",
        action="store_true",
        help="Skip copying standalone Python runtime (for local structural validation only)",
    )
    parser.add_argument(
        "--skip-smoke-test",
        action="store_true",
        help="Skip import + worker dry-run smoke test",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    repo_root = Path(__file__).resolve().parents[1]
    lockfile_path = normalize_path(args.lockfile, base_dir=repo_root)
    worker_source = normalize_path(args.worker_source, base_dir=repo_root)
    runtime_tools_dir = normalize_path(args.runtime_tools_dir, base_dir=repo_root)
    manifest_template = normalize_path(args.manifest_template, base_dir=repo_root)
    output_root = normalize_path(args.output_dir, base_dir=repo_root)
    stage_dir = normalize_path(args.stage_dir, base_dir=repo_root)

    if not lockfile_path.exists():
        print(f"[llm-runtime-build] lockfile not found: {lockfile_path}", file=sys.stderr)
        return 1
    if not manifest_template.exists():
        print(
            f"[llm-runtime-build] manifest template not found: {manifest_template}",
            file=sys.stderr,
        )
        return 1

    runtime_root = output_root / "llm-runtime"
    if output_root.exists():
        shutil.rmtree(output_root)
    runtime_root.mkdir(parents=True, exist_ok=True)

    try:
        runtime_python: Path | None = None
        if args.skip_python_copy:
            python_meta = {
                "version": "",
                "sourceExecutable": "",
                "sourceBasePrefix": "",
                "copiedExecutable": "",
                "copiedSizeBytes": 0,
                "skipped": True,
            }
            (runtime_root / "python-runtime").mkdir(parents=True, exist_ok=True)
            (runtime_root / "python-runtime" / ".placeholder").write_text(
                "python runtime copy skipped during structural build",
                encoding="utf-8",
            )
        else:
            runtime_python = resolve_python_executable(args.runtime_python)
            python_meta = copy_python_runtime(
                python_exe=runtime_python,
                destination=runtime_root / "python-runtime",
            )

        shutil.copy2(lockfile_path, runtime_root / "requirements-lock.txt")
        if manifest_template.exists():
            shutil.copy2(manifest_template, runtime_root / "runtime-manifest.template.json")
        worker_script = copy_runtime_tools(
            tools_source_dir=runtime_tools_dir,
            runtime_tools_dir=runtime_root / "tools",
            worker_source=worker_source,
        )

        if args.skip_wheelhouse:
            wheelhouse_meta = {"wheelCount": 0, "totalSizeBytes": 0}
            (runtime_root / "wheelhouse").mkdir(parents=True, exist_ok=True)
        else:
            if runtime_python is None:
                raise RuntimeError("wheelhouse 构建需要可用 Python，请移除 --skip-python-copy。")
            wheelhouse_meta = build_wheelhouse(
                python_exe=runtime_python,
                lockfile_path=runtime_root / "requirements-lock.txt",
                wheelhouse_dir=runtime_root / "wheelhouse",
                python_version_tag=args.python_version_tag,
                platform_tag=args.platform_tag,
                torch_index_url=args.torch_index_url,
            )

        smoke_meta: dict[str, Any] | None = None
        if args.skip_smoke_test:
            smoke_meta = {
                "passed": False,
                "checkedAt": None,
                "reason": "skipped-by-flag",
            }
        elif args.skip_wheelhouse:
            smoke_meta = {
                "passed": False,
                "checkedAt": None,
                "reason": "skipped-because-wheelhouse-skipped",
            }
        else:
            if runtime_python is None:
                raise RuntimeError("smoke test 需要可用 Python，请移除 --skip-python-copy。")
            smoke_meta = run_smoke_test(
                python_exe=runtime_python,
                wheelhouse_dir=runtime_root / "wheelhouse",
                lockfile_path=runtime_root / "requirements-lock.txt",
                worker_script=worker_script,
                verify_script=runtime_root / "tools" / "verify_import_chain.py",
                build_root=output_root,
            )

        manifest = write_manifest(
            runtime_root=runtime_root,
            runtime_id=args.runtime_id,
            python_meta=python_meta,
            lockfile_path=runtime_root / "requirements-lock.txt",
            wheelhouse_meta=wheelhouse_meta,
            worker_script=worker_script,
            smoke_meta=smoke_meta,
            torch_index_url=args.torch_index_url,
        )
        hashes_meta = write_sha256s(runtime_root)
        stage_meta = copy_stage(runtime_root, stage_dir)
    except RuntimeError as exc:
        print(f"[llm-runtime-build] {exc}", file=sys.stderr)
        return 1

    runtime_size = directory_size(runtime_root)
    print("[llm-runtime-build] Build complete")
    print(f"[llm-runtime-build] runtime id: {args.runtime_id}")
    print(f"[llm-runtime-build] output: {runtime_root} ({format_size(runtime_size)})")
    print(
        "[llm-runtime-build] wheelhouse: "
        f"{wheelhouse_meta['wheelCount']} wheels ({format_size(int(wheelhouse_meta['totalSizeBytes']))})"
    )
    print(
        "[llm-runtime-build] lock packages: "
        f"{manifest['dependencySet']['packageCount']}"
    )
    print(
        "[llm-runtime-build] hashes: "
        f"{hashes_meta['fileCount']} files -> {runtime_root / 'SHA256SUMS.txt'}"
    )
    print(
        "[llm-runtime-build] staged: "
        f"{stage_meta['stageDir']} ({format_size(int(stage_meta['stagedSizeBytes']))})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
