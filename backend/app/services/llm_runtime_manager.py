from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from importlib.util import find_spec
from pathlib import Path
from typing import Any, Literal

from app.services.llm_base_models import DEFAULT_TRAINING_BASE_MODEL, get_training_base_model
from app.services.ollama_service import check_ollama_runtime

LLMTrainingMode = Literal["light", "standard", "fine"]
LLMRuntimeReadinessState = Literal[
    "unsupported",
    "missing_runtime",
    "installing_runtime",
    "preparing_training_base_snapshot",
    "runtime_broken",
    "missing_ollama",
    "missing_inference_model",
    "missing_training_base_snapshot",
    "ready",
]

GPU_TRAINING_RUNTIME_DEPENDENCIES: tuple[str, ...] = (
    "torch",
    "unsloth",
    "datasets",
    "transformers",
    "trl",
)
RUNTIME_WORKER_ENTRY_RELATIVE = Path("tools/unsloth_worker.py")
RUNTIME_BOOTSTRAP_SCRIPT_RELATIVE = Path("tools/bootstrap_runtime.py")
RUNTIME_HF_SNAPSHOT_SCRIPT_RELATIVE = Path("tools/prepare_hf_snapshot.py")

MIN_VRAM_GB = 8.0
FINE_TRAINING_MIN_VRAM_GB = 12.0
MIN_CUDA_VERSION = (12, 1)
MIN_DRIVER_VERSION = (531, 79)
MIN_FREE_DISK_GB = 12.0
ALLOW_NON_WINDOWS_TRAINING_ENV = "MELY_LLM_ALLOW_NON_WINDOWS_TRAINING"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _parse_version(version: str | None) -> tuple[int, ...] | None:
    if not version:
        return None
    parts: list[int] = []
    for token in version.strip().split("."):
        token = token.strip()
        if not token:
            continue
        digits = ""
        for char in token:
            if char.isdigit():
                digits += char
            else:
                break
        if digits == "":
            break
        parts.append(int(digits))
    return tuple(parts) if parts else None


def _version_gte(current: tuple[int, ...] | None, expected: tuple[int, ...]) -> bool:
    if current is None:
        return False
    width = max(len(current), len(expected))
    current_norm = current + (0,) * (width - len(current))
    expected_norm = expected + (0,) * (width - len(expected))
    return current_norm >= expected_norm


def _with_repair_guidance(message: str) -> str:
    normalized = message.strip()
    if not normalized:
        return "训练运行时异常，请先执行“修复训练环境”后重试。"
    if "修复" in normalized:
        return normalized
    return f"{normalized} 请先执行“修复训练环境”后重试。"


def detect_missing_runtime_dependencies() -> list[str]:
    missing: list[str] = []
    for module in GPU_TRAINING_RUNTIME_DEPENDENCIES:
        if find_spec(module) is None:
            missing.append(module)
    return missing


@dataclass(slots=True)
class RuntimeAction:
    action_id: str
    label: str
    description: str
    recommended: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.action_id,
            "label": self.label,
            "description": self.description,
            "recommended": self.recommended,
        }


@dataclass(slots=True)
class RuntimeInstallProgress:
    active: bool = False
    percent: float = 0.0
    stage: str = "idle"
    message: str = "尚未开始安装"
    started_at: str | None = None
    updated_at: str | None = None
    attempt: int = 0
    error_message: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "active": self.active,
            "percent": round(self.percent, 2),
            "stage": self.stage,
            "message": self.message,
            "startedAt": self.started_at,
            "updatedAt": self.updated_at,
            "attempt": self.attempt,
            "errorMessage": self.error_message,
        }


@dataclass(slots=True)
class RuntimeHardwareStatus:
    gpu_model: str | None
    vram_gb: float
    driver_version: str | None
    cuda_version: str | None
    driver_compatibility: Literal["ok", "incompatible", "unknown"]
    cuda_compatibility: Literal["ok", "incompatible", "unknown"]
    disk_free_gb: float
    disk_required_gb: float
    source: str
    supported_modes: tuple[LLMTrainingMode, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "gpuModel": self.gpu_model,
            "vramGB": round(self.vram_gb, 2),
            "driverVersion": self.driver_version,
            "cudaVersion": self.cuda_version,
            "driverCompatibility": self.driver_compatibility,
            "cudaCompatibility": self.cuda_compatibility,
            "diskFreeGB": round(self.disk_free_gb, 2),
            "diskRequiredGB": round(self.disk_required_gb, 2),
            "source": self.source,
            "supportedModes": list(self.supported_modes),
        }


@dataclass(slots=True)
class LLMRuntimeReadiness:
    state: LLMRuntimeReadinessState
    ready: bool
    message: str
    blocking_reason: str | None
    repairable: bool
    actions: list[RuntimeAction] = field(default_factory=list)
    install_progress: RuntimeInstallProgress = field(default_factory=RuntimeInstallProgress)
    hardware: RuntimeHardwareStatus | None = None
    checks: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "ready": self.ready,
            "message": self.message,
            "blockingReason": self.blocking_reason,
            "repairable": self.repairable,
            "actions": [action.to_dict() for action in self.actions],
            "installProgress": self.install_progress.to_dict(),
            "hardware": self.hardware.to_dict() if self.hardware is not None else None,
            "checks": self.checks,
        }


class LLMRuntimeManager:
    def __init__(self, *, data_root: Path, runtime_resource_root: Path | None = None) -> None:
        project_root = Path(__file__).resolve().parents[3]
        env_resource_root = os.getenv("MELY_LLM_RUNTIME_RESOURCE_ROOT")
        resolved_resource_root = (
            Path(env_resource_root).expanduser()
            if env_resource_root
            else runtime_resource_root
            if runtime_resource_root is not None
            else project_root / "src-tauri" / "resources" / "llm-runtime"
        )

        self._data_root = data_root
        self._runtime_resource_root = resolved_resource_root
        self._runtime_id = os.getenv("MELY_LLM_RUNTIME_ID", "llm-win-cu121-py311-v1")
        self._runtime_root = data_root / "runtimes" / "llm" / self._runtime_id
        self._runtime_manifest_path = self._runtime_root / "manifest.runtime.json"
        self._runtime_install_dir = self._runtime_root / "install"
        self._broken_flag_path = self._runtime_install_dir / "runtime-broken.json"
        self._local_hf_snapshot_root = self._runtime_resource_root / "hf-snapshots"
        self._disk_threshold_gb = float(os.getenv("MELY_LLM_RUNTIME_MIN_DISK_GB", MIN_FREE_DISK_GB))
        self._strict_enforcement = self._resolve_strict_enforcement()
        self._install_lock = asyncio.Lock()
        self._install_task: asyncio.Task[None] | None = None
        self._install_progress = RuntimeInstallProgress()

    @property
    def is_enforced(self) -> bool:
        return self._strict_enforcement

    def _resolve_strict_enforcement(self) -> bool:
        raw = os.getenv("MELY_LLM_RUNTIME_ENFORCED", "auto").strip().lower()
        if raw in {"1", "true", "yes", "on"}:
            return True
        if raw in {"0", "false", "no", "off"}:
            return False
        # Auto mode: enforce on Windows or when packaged runtime resources exist.
        return sys.platform.startswith("win") or self._runtime_resource_root.exists()

    def _platform_allows_training(self) -> bool:
        if sys.platform.startswith("win"):
            return True
        return _env_flag(ALLOW_NON_WINDOWS_TRAINING_ENV)

    def _platform_label(self) -> str:
        if sys.platform == "darwin":
            return "macOS"
        if sys.platform.startswith("linux"):
            return "Linux"
        if sys.platform.startswith("win"):
            return "Windows"
        return sys.platform or "当前系统"

    def _set_install_progress(
        self,
        *,
        active: bool,
        percent: float,
        stage: str,
        message: str,
        error_message: str | None = None,
        started_at: str | None = None,
    ) -> None:
        now = _utc_now()
        if started_at is not None:
            self._install_progress.started_at = started_at
        if self._install_progress.started_at is None and active:
            self._install_progress.started_at = now
        self._install_progress.active = active
        self._install_progress.percent = max(0.0, min(100.0, percent))
        self._install_progress.stage = stage
        self._install_progress.message = message
        self._install_progress.updated_at = now
        self._install_progress.error_message = error_message

    def _snapshot_name_for_model(self, huggingface_model_id: str) -> str:
        return f"models--{huggingface_model_id.replace('/', '--')}"

    def _hf_cache_root(self) -> Path:
        return Path(os.getenv("MELY_HF_CACHE_ROOT", str(self._data_root / "cache" / "hf"))).expanduser()

    def _hf_snapshot_path(self, huggingface_model_id: str) -> Path:
        return self._hf_cache_root() / self._snapshot_name_for_model(huggingface_model_id)

    def _snapshot_ready(self, huggingface_model_id: str) -> bool:
        if _env_flag("MELY_LLM_FORCE_MISSING_TRAINING_SNAPSHOT"):
            return False
        snapshot_path = self._hf_snapshot_path(huggingface_model_id)
        if not snapshot_path.exists() or not snapshot_path.is_dir():
            return False
        return any(snapshot_path.rglob("*"))

    def _runtime_exists(self) -> bool:
        return self._runtime_manifest_path.exists()

    def _load_runtime_manifest(self) -> dict[str, Any] | None:
        if not self._runtime_manifest_path.exists():
            return None
        try:
            payload = json.loads(self._runtime_manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if isinstance(payload, dict):
            return payload
        return None

    def _resolve_manifest_path_value(self, value: str | None) -> Path | None:
        if not value:
            return None
        path = Path(value).expanduser()
        if path.is_absolute():
            return path
        return (self._runtime_root / path).resolve()

    def _resolve_bootstrap_python(self) -> Path:
        runtime_python_rel = "python-runtime/python.exe" if os.name == "nt" else "python-runtime/bin/python"
        manifest_path = self._runtime_resource_root / "manifest.json"
        if manifest_path.exists():
            try:
                payload = json.loads(manifest_path.read_text(encoding="utf-8"))
                if isinstance(payload, dict):
                    python_section = payload.get("python")
                    if isinstance(python_section, dict):
                        manifest_runtime_path = str(
                            python_section.get("runtimeExecutable") or runtime_python_rel
                        ).strip()
                        if manifest_runtime_path:
                            runtime_python_rel = manifest_runtime_path
            except (OSError, json.JSONDecodeError):
                pass

        candidate = (self._runtime_resource_root / runtime_python_rel).resolve()
        if candidate.exists():
            return candidate

        # In packaged mode we must use a real Python interpreter from runtime resources.
        if getattr(sys, "frozen", False):
            raise RuntimeError(f"安装包缺少 runtime Python 解释器：{candidate}")

        # Source-mode fallback for local development and tests.
        return Path(sys.executable).resolve()

    def resolve_worker_launch(self) -> tuple[Path, Path]:
        payload = self._load_runtime_manifest()
        if payload is None:
            raise RuntimeError("训练运行时配置缺失，请先修复训练环境。")

        readiness_state = str(payload.get("readiness", {}).get("state") or "").strip().lower()
        if readiness_state and readiness_state != "ready":
            raise RuntimeError("训练运行时尚未就绪，请先修复训练环境。")

        python_config = payload.get("python")
        if not isinstance(python_config, dict):
            python_config = {}
        worker_config = payload.get("worker")
        if not isinstance(worker_config, dict):
            worker_config = {}
        python_raw = (
            python_config.get("exePath")
            or python_config.get("runtimeExecutable")
            or ""
        )
        worker_raw = worker_config.get("entryScript") or str(RUNTIME_WORKER_ENTRY_RELATIVE)

        python_path = self._resolve_manifest_path_value(str(python_raw).strip())
        worker_path = self._resolve_manifest_path_value(str(worker_raw).strip())
        if python_path is None:
            raise RuntimeError("训练运行时缺少 Python 可执行路径，请先修复训练环境。")
        if worker_path is None:
            raise RuntimeError("训练运行时缺少 worker 入口路径，请先修复训练环境。")
        if not python_path.exists():
            raise RuntimeError(f"训练运行时 Python 不存在：{python_path}")
        if not worker_path.exists():
            raise RuntimeError(f"训练 worker 入口不存在：{worker_path}")
        return python_path, worker_path

    def _runtime_in_installation(self) -> bool:
        task = self._install_task
        return task is not None and not task.done()

    def _runtime_broken_reason(self) -> str | None:
        if _env_flag("MELY_LLM_FORCE_RUNTIME_BROKEN"):
            return "检测到训练运行时损坏，请执行修复。"
        if self._broken_flag_path.exists():
            try:
                payload = json.loads(self._broken_flag_path.read_text(encoding="utf-8"))
                reason = str(payload.get("reason") or "").strip()
                if reason:
                    return reason
            except (OSError, json.JSONDecodeError):
                return "检测到训练运行时损坏，请执行修复。"
            return "检测到训练运行时损坏，请执行修复。"
        if self._runtime_exists():
            try:
                self.resolve_worker_launch()
            except RuntimeError as exc:
                return str(exc)
        return None

    def _detect_hardware(self) -> RuntimeHardwareStatus:
        gpu_model = os.getenv("MELY_GPU_NAME")
        vram_raw = os.getenv("MELY_GPU_VRAM_GB")
        driver_version = os.getenv("MELY_GPU_DRIVER_VERSION")
        cuda_version = os.getenv("MELY_CUDA_VERSION")
        source = "env" if any([gpu_model, vram_raw, driver_version, cuda_version]) else "fallback"
        vram_gb = 8.0

        if vram_raw:
            try:
                vram_gb = float(vram_raw)
            except ValueError:
                vram_gb = 8.0
        else:
            try:
                import torch  # type: ignore

                if torch.cuda.is_available():
                    source = "torch"
                    gpu_model = gpu_model or torch.cuda.get_device_name(0)
                    vram_gb = round(
                        torch.cuda.get_device_properties(0).total_memory / (1024 ** 3),
                        2,
                    )
                    cuda_version = cuda_version or getattr(torch.version, "cuda", None)
            except Exception:
                pass

        if source == "fallback":
            try:
                result = subprocess.run(
                    [
                        "nvidia-smi",
                        "--query-gpu=name,memory.total,driver_version",
                        "--format=csv,noheader,nounits",
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if result.returncode == 0:
                    line = result.stdout.strip().splitlines()[0]
                    parts = [part.strip() for part in line.split(",")]
                    if len(parts) >= 3:
                        source = "nvidia-smi"
                        gpu_model = gpu_model or parts[0]
                        try:
                            vram_gb = round(float(parts[1]) / 1024.0, 2)
                        except ValueError:
                            pass
                        driver_version = driver_version or parts[2]
            except Exception:
                pass

        try:
            disk_free_gb = round(shutil.disk_usage(self._data_root).free / (1024 ** 3), 2)
        except OSError:
            disk_free_gb = 0.0

        driver_status: Literal["ok", "incompatible", "unknown"] = "unknown"
        parsed_driver = _parse_version(driver_version)
        if parsed_driver is not None:
            driver_status = "ok" if _version_gte(parsed_driver, MIN_DRIVER_VERSION) else "incompatible"

        cuda_status: Literal["ok", "incompatible", "unknown"] = "unknown"
        parsed_cuda = _parse_version(cuda_version)
        if parsed_cuda is not None:
            cuda_status = "ok" if _version_gte(parsed_cuda, MIN_CUDA_VERSION) else "incompatible"

        if vram_gb >= FINE_TRAINING_MIN_VRAM_GB:
            supported_modes: tuple[LLMTrainingMode, ...] = ("light", "standard", "fine")
        elif vram_gb >= MIN_VRAM_GB:
            supported_modes = ("light", "standard")
        else:
            supported_modes = ()

        return RuntimeHardwareStatus(
            gpu_model=gpu_model,
            vram_gb=vram_gb,
            driver_version=driver_version,
            cuda_version=cuda_version,
            driver_compatibility=driver_status,
            cuda_compatibility=cuda_status,
            disk_free_gb=disk_free_gb,
            disk_required_gb=self._disk_threshold_gb,
            source=source,
            supported_modes=supported_modes,
        )

    def _build_state_actions(self, state: LLMRuntimeReadinessState) -> list[RuntimeAction]:
        if state == "missing_runtime":
            return [
                RuntimeAction(
                    action_id="install_runtime",
                    label="自动安装训练运行时",
                    description="从安装包内资源初始化训练运行时。",
                    recommended=True,
                )
            ]
        if state == "runtime_broken":
            return [
                RuntimeAction(
                    action_id="repair_runtime",
                    label="修复训练环境",
                    description="使用本地 runtime 资源重建损坏部分。",
                    recommended=True,
                )
            ]
        if state == "missing_ollama":
            return [
                RuntimeAction(
                    action_id="install_or_start_ollama",
                    label="安装或启动语言引擎",
                    description="请先安装并启动 Ollama 后再开始训练。",
                    recommended=True,
                )
            ]
        if state == "missing_inference_model":
            return [
                RuntimeAction(
                    action_id="download_inference_model",
                    label="下载推理基础模型",
                    description="先下载 qwen2.5:3b 后再训练。",
                    recommended=True,
                )
            ]
        if state == "missing_training_base_snapshot":
            return [
                RuntimeAction(
                    action_id="prepare_training_snapshot",
                    label="准备训练基础快照",
                    description="请先补齐 HuggingFace 训练基础权重。",
                    recommended=True,
                )
            ]
        return []

    async def _ensure_install_task(self, *, reason: str, force_repair: bool) -> None:
        async with self._install_lock:
            if self._runtime_in_installation():
                return
            self._install_progress.attempt += 1
            started_at = _utc_now()
            if "snapshot" in reason:
                initial_stage = "snapshot"
                initial_message = "正在准备训练模型基础权重…"
            else:
                initial_stage = "preparing"
                initial_message = "正在准备训练运行时修复任务…"
            self._set_install_progress(
                active=True,
                percent=1.0,
                stage=initial_stage,
                message=initial_message,
                started_at=started_at,
            )
            self._install_task = asyncio.create_task(
                self._install_or_repair_runtime(reason=reason, force_repair=force_repair)
            )

    def _write_broken_flag(self, reason: str) -> None:
        self._runtime_install_dir.mkdir(parents=True, exist_ok=True)
        payload = {"reason": reason, "updatedAt": _utc_now()}
        self._broken_flag_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _clear_broken_flag(self) -> None:
        if self._broken_flag_path.exists():
            self._broken_flag_path.unlink()

    def _restore_hf_snapshot_from_bundle(self, *, huggingface_model_id: str) -> bool:
        local_snapshot = self._local_hf_snapshot_root / huggingface_model_id.replace("/", "--")
        if not local_snapshot.exists():
            return False
        target = self._hf_snapshot_path(huggingface_model_id)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(local_snapshot, target, dirs_exist_ok=True)
        return True

    def _prepare_hf_snapshot_with_runtime(self, *, huggingface_model_id: str) -> None:
        snapshot_script = self._runtime_resource_root / RUNTIME_HF_SNAPSHOT_SCRIPT_RELATIVE
        if not snapshot_script.exists():
            raise RuntimeError(f"安装包缺少训练基础权重准备脚本：{snapshot_script}")

        runtime_python, _worker_entry = self.resolve_worker_launch()
        cache_root = self._hf_cache_root()
        cache_root.mkdir(parents=True, exist_ok=True)
        command = [
            str(runtime_python),
            str(snapshot_script),
            "--repo-id",
            huggingface_model_id,
            "--cache-dir",
            str(cache_root),
        ]
        process = subprocess.run(command, capture_output=True, text=True, check=False)
        snapshot_log_path = self._runtime_install_dir / "hf-snapshot.log"
        snapshot_log_path.write_text(
            "\n".join(
                [
                    f"timestamp={_utc_now()}",
                    f"repo_id={huggingface_model_id}",
                    f"return_code={process.returncode}",
                    "--- stdout ---",
                    process.stdout.strip(),
                    "--- stderr ---",
                    process.stderr.strip(),
                    "",
                ]
            ),
            encoding="utf-8",
        )
        if process.returncode != 0:
            details = process.stderr.strip() or process.stdout.strip() or "未知错误"
            raise RuntimeError(f"训练基础权重准备失败：{details}")

    async def _install_or_repair_runtime(self, *, reason: str, force_repair: bool) -> None:
        base_model = DEFAULT_TRAINING_BASE_MODEL
        base_model_config = get_training_base_model(base_model)
        if base_model_config is None:
            self._set_install_progress(
                active=False,
                percent=0.0,
                stage="failed",
                message="训练运行时修复失败",
                error_message="默认训练基础模型未配置。",
            )
            return

        try:
            self._set_install_progress(
                active=True,
                percent=10.0,
                stage="checking",
                message="正在检查安装包内训练运行时资源…",
            )
            if not self._runtime_resource_root.exists():
                raise RuntimeError("安装包中未找到训练运行时资源，请重新安装应用。")

            self._runtime_root.mkdir(parents=True, exist_ok=True)
            self._runtime_install_dir.mkdir(parents=True, exist_ok=True)

            self._set_install_progress(
                active=True,
                percent=35.0,
                stage="bootstrap",
                message="正在安装训练运行时…",
            )
            bootstrap_script = self._runtime_resource_root / RUNTIME_BOOTSTRAP_SCRIPT_RELATIVE
            if not bootstrap_script.exists():
                raise RuntimeError(f"安装包缺少 runtime bootstrap 脚本：{bootstrap_script}")
            bootstrap_python = self._resolve_bootstrap_python()

            command = [
                str(bootstrap_python),
                str(bootstrap_script),
                "--seed-root",
                str(self._runtime_resource_root),
                "--target-root",
                str(self._runtime_root),
            ]
            if force_repair:
                command.append("--force-reinstall")

            process = subprocess.run(command, capture_output=True, text=True, check=False)
            install_log_path = self._runtime_install_dir / "install.log"
            install_log_path.write_text(
                "\n".join(
                    [
                        f"timestamp={_utc_now()}",
                        f"reason={reason}",
                        f"force_repair={force_repair}",
                        f"return_code={process.returncode}",
                        "--- stdout ---",
                        process.stdout.strip(),
                        "--- stderr ---",
                        process.stderr.strip(),
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            if process.returncode != 0:
                stderr_text = process.stderr.strip()
                stdout_text = process.stdout.strip()
                details = stderr_text or stdout_text or "未知错误"
                raise RuntimeError(f"训练运行时安装失败：{details}")

            self._set_install_progress(
                active=True,
                percent=65.0,
                stage="validating",
                message="正在验证训练运行时入口…",
            )
            self.resolve_worker_launch()

            self._set_install_progress(
                active=True,
                percent=78.0,
                stage="snapshot",
                message="正在准备训练基础权重快照…",
            )
            self._restore_hf_snapshot_from_bundle(
                huggingface_model_id=base_model_config.huggingface_model_id
            )
            if not self._snapshot_ready(base_model_config.huggingface_model_id):
                self._set_install_progress(
                    active=True,
                    percent=82.0,
                    stage="snapshot",
                    message="正在下载训练基础权重，请保持网络连接…",
                )
                self._prepare_hf_snapshot_with_runtime(
                    huggingface_model_id=base_model_config.huggingface_model_id
                )
            if not self._snapshot_ready(base_model_config.huggingface_model_id):
                raise RuntimeError(
                    f"训练基础权重“{base_model_config.huggingface_model_id}”尚未准备完成。"
                )

            self._clear_broken_flag()
            self._set_install_progress(
                active=False,
                percent=100.0,
                stage="completed",
                message="训练运行时已就绪。",
                error_message=None,
            )
        except Exception as exc:
            error_message = str(exc) or "训练运行时修复失败，请稍后重试。"
            self._write_broken_flag(error_message)
            self._set_install_progress(
                active=False,
                percent=self._install_progress.percent,
                stage="failed",
                message="训练运行时修复失败。",
                error_message=error_message,
            )
        finally:
            async with self._install_lock:
                current_task = self._install_task
                if current_task is not None and current_task.done():
                    self._install_task = None

    async def repair_runtime(self) -> LLMRuntimeReadiness:
        await self._ensure_install_task(reason="manual_repair", force_repair=True)
        return await self.get_readiness(auto_fix=False)

    async def get_readiness(
        self,
        *,
        mode: LLMTrainingMode = "standard",
        base_model: str = DEFAULT_TRAINING_BASE_MODEL,
        auto_fix: bool = False,
    ) -> LLMRuntimeReadiness:
        hardware = self._detect_hardware()
        checks: dict[str, Any] = {
            "runtimeEnforced": self._strict_enforcement,
            "runtimeResourceRoot": str(self._runtime_resource_root),
            "platform": self._platform_label(),
            "nonWindowsTrainingOverride": _env_flag(ALLOW_NON_WINDOWS_TRAINING_ENV),
        }

        if mode not in {"light", "standard", "fine"}:
            mode = "standard"

        base_model_config = get_training_base_model(base_model)
        if base_model_config is None:
            state: LLMRuntimeReadinessState = "unsupported"
            message = "基础模型暂不支持训练。"
            blocking = (
                f"基础模型“{base_model}”暂不支持训练，请改用 qwen2.5:3b 后再试。"
            )
            return LLMRuntimeReadiness(
                state=state,
                ready=False,
                message=message,
                blocking_reason=blocking,
                repairable=False,
                actions=[],
                install_progress=self._install_progress,
                hardware=hardware,
                checks=checks,
            )

        checks["baseModel"] = {
            "ollamaTag": base_model_config.ollama_tag,
            "huggingFaceModelId": base_model_config.huggingface_model_id,
        }

        if not self._platform_allows_training():
            platform_label = self._platform_label()
            return LLMRuntimeReadiness(
                state="unsupported",
                ready=False,
                message="当前系统不支持本机训练。",
                blocking_reason=(
                    f"当前系统为 {platform_label}，LLM 微调运行时仅支持 Windows + NVIDIA GPU。"
                    "请在 Windows RTX 设备上训练，或在本机继续使用对话、数据集管理和监控功能。"
                ),
                repairable=False,
                actions=[],
                install_progress=self._install_progress,
                hardware=hardware,
                checks=checks,
            )

        if hardware.vram_gb < MIN_VRAM_GB:
            blocking = (
                f"当前显存为 {hardware.vram_gb:.1f}GB，低于训练最低要求 8GB，暂不支持训练。"
            )
            return LLMRuntimeReadiness(
                state="unsupported",
                ready=False,
                message="当前设备不满足训练最低门槛。",
                blocking_reason=blocking,
                repairable=False,
                actions=[],
                install_progress=self._install_progress,
                hardware=hardware,
                checks=checks,
            )

        if mode == "fine" and hardware.vram_gb < FINE_TRAINING_MIN_VRAM_GB:
            blocking = (
                f"当前显存为 {hardware.vram_gb:.1f}GB，精细模式至少需要 12GB。"
                "请改用轻量或标准模式。"
            )
            return LLMRuntimeReadiness(
                state="unsupported",
                ready=False,
                message="当前显存不支持精细训练模式。",
                blocking_reason=blocking,
                repairable=False,
                actions=[],
                install_progress=self._install_progress,
                hardware=hardware,
                checks=checks,
            )

        if hardware.disk_free_gb < self._disk_threshold_gb:
            blocking = (
                f"磁盘剩余空间不足（当前 {hardware.disk_free_gb:.1f}GB，至少需要 {self._disk_threshold_gb:.1f}GB）。"
            )
            return LLMRuntimeReadiness(
                state="unsupported",
                ready=False,
                message="磁盘空间不足，无法保证训练运行时完整可用。",
                blocking_reason=blocking,
                repairable=False,
                actions=[],
                install_progress=self._install_progress,
                hardware=hardware,
                checks=checks,
            )

        if self._strict_enforcement:
            if hardware.cuda_compatibility == "incompatible":
                blocking = (
                    f"CUDA 版本不兼容（当前 {hardware.cuda_version or '未知'}，需要 >= 12.1）。"
                )
                return LLMRuntimeReadiness(
                    state="unsupported",
                    ready=False,
                    message="CUDA 版本与训练运行时不兼容。",
                    blocking_reason=blocking,
                    repairable=False,
                    actions=[],
                    install_progress=self._install_progress,
                    hardware=hardware,
                    checks=checks,
                )

            if hardware.driver_compatibility == "incompatible":
                blocking = (
                    f"NVIDIA 驱动版本不兼容（当前 {hardware.driver_version or '未知'}，"
                    "需要 >= 531.79）。"
                )
                return LLMRuntimeReadiness(
                    state="unsupported",
                    ready=False,
                    message="显卡驱动版本与训练运行时不兼容。",
                    blocking_reason=blocking,
                    repairable=False,
                    actions=[],
                    install_progress=self._install_progress,
                    hardware=hardware,
                    checks=checks,
                )

        if self._runtime_in_installation():
            return LLMRuntimeReadiness(
                state="installing_runtime",
                ready=False,
                message="训练运行时正在安装/修复，请稍候。",
                blocking_reason="训练运行时正在安装中，请等待完成后重试。",
                repairable=True,
                actions=[],
                install_progress=self._install_progress,
                hardware=hardware,
                checks=checks,
            )

        if self._strict_enforcement and not self._runtime_exists():
            if auto_fix:
                await self._ensure_install_task(reason="auto_install", force_repair=False)
                return LLMRuntimeReadiness(
                    state="installing_runtime",
                    ready=False,
                    message="正在自动安装训练运行时。",
                    blocking_reason="训练运行时正在自动安装，请稍后重试。",
                    repairable=True,
                    actions=[],
                    install_progress=self._install_progress,
                    hardware=hardware,
                    checks=checks,
                )
            state = "missing_runtime"
            return LLMRuntimeReadiness(
                state=state,
                ready=False,
                message="训练运行时尚未安装。",
                blocking_reason="训练运行时缺失，请先执行“修复训练环境”。",
                repairable=True,
                actions=self._build_state_actions(state),
                install_progress=self._install_progress,
                hardware=hardware,
                checks=checks,
            )

        broken_reason = self._runtime_broken_reason() if self._strict_enforcement else None
        if broken_reason:
            if auto_fix:
                await self._ensure_install_task(reason="auto_repair", force_repair=True)
                return LLMRuntimeReadiness(
                    state="installing_runtime",
                    ready=False,
                    message="检测到训练运行时异常，正在自动修复。",
                    blocking_reason=(
                        "训练运行时正在修复，请稍后重试。"
                        "如持续失败，请执行“修复训练环境”。"
                    ),
                    repairable=True,
                    actions=[],
                    install_progress=self._install_progress,
                    hardware=hardware,
                    checks=checks,
                )
            state = "runtime_broken"
            blocking_reason = _with_repair_guidance(broken_reason)
            return LLMRuntimeReadiness(
                state=state,
                ready=False,
                message="训练运行时损坏，需要修复。",
                blocking_reason=blocking_reason,
                repairable=True,
                actions=self._build_state_actions(state),
                install_progress=self._install_progress,
                hardware=hardware,
                checks=checks,
            )

        ollama_runtime = await check_ollama_runtime()
        checks["ollama"] = {
            "installed": bool(ollama_runtime.installed),
            "running": bool(ollama_runtime.running),
            "hint": ollama_runtime.hint,
        }
        if not ollama_runtime.installed or not ollama_runtime.running:
            state = "missing_ollama"
            return LLMRuntimeReadiness(
                state=state,
                ready=False,
                message="语言引擎未就绪。",
                blocking_reason=ollama_runtime.hint or "未检测到语言引擎，请先安装并启动 Ollama。",
                repairable=False,
                actions=self._build_state_actions(state),
                install_progress=self._install_progress,
                hardware=hardware,
                checks=checks,
            )

        downloaded_models = {
            str(model.name).strip().lower()
            for model in ollama_runtime.models
            if getattr(model, "name", None)
        }
        if base_model_config.ollama_tag.strip().lower() not in downloaded_models:
            state = "missing_inference_model"
            return LLMRuntimeReadiness(
                state=state,
                ready=False,
                message="推理基础模型未就绪。",
                blocking_reason=(
                    f"基础模型“{base_model_config.ollama_tag}”尚未在 Ollama 中就绪。"
                    "请先下载完成后再训练。"
                ),
                repairable=False,
                actions=self._build_state_actions(state),
                install_progress=self._install_progress,
                hardware=hardware,
                checks=checks,
            )

        if not self._snapshot_ready(base_model_config.huggingface_model_id):
            if auto_fix:
                await self._ensure_install_task(
                    reason="auto_prepare_training_snapshot",
                    force_repair=False,
                )
                return LLMRuntimeReadiness(
                    state="preparing_training_base_snapshot",
                    ready=False,
                    message="正在准备训练模型基础权重。",
                    blocking_reason="正在准备训练模型基础权重，请稍后重试。",
                    repairable=True,
                    actions=[],
                    install_progress=self._install_progress,
                    hardware=hardware,
                    checks=checks,
                )
            state = "missing_training_base_snapshot"
            return LLMRuntimeReadiness(
                state=state,
                ready=False,
                message="训练基础权重快照缺失。",
                blocking_reason=_with_repair_guidance(
                    f"未检测到训练基础快照“{base_model_config.huggingface_model_id}”，"
                    "请先修复训练环境。"
                ),
                repairable=True,
                actions=self._build_state_actions(state),
                install_progress=self._install_progress,
                hardware=hardware,
                checks=checks,
            )

        return LLMRuntimeReadiness(
            state="ready",
            ready=True,
            message="训练环境已就绪。",
            blocking_reason=None,
            repairable=False,
            actions=[],
            install_progress=self._install_progress,
            hardware=hardware,
            checks=checks,
        )


def create_llm_runtime_manager(*, data_root: Path) -> LLMRuntimeManager:
    return LLMRuntimeManager(data_root=data_root)
