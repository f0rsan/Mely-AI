"""LLM training service — Unsloth QLoRA fine-tuning pipeline.

Lifecycle:
  queued → preparing → training → exporting → registering → completed
                                                           ↘ failed
                                                           ↘ canceled
"""
from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import subprocess
import sys
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from importlib.util import find_spec
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal
from uuid import uuid4

from app.core.paths import ensure_llm_directories
from app.db.connection import connect_database
from app.services.llm_base_models import (
    DEFAULT_TRAINING_BASE_MODEL,
    build_model_not_downloaded_error,
    build_mode_not_allowed_error,
    build_unsupported_model_error,
    get_active_hardware_policy,
    get_training_base_model,
    is_mode_allowed_for_policy,
)
from app.services.ollama_service import OllamaAPIError, check_ollama_status
from app.services.task_queue import TaskQueue

if TYPE_CHECKING:
    from app.services.llm_model_service import LLMModelService


# ── Types ─────────────────────────────────────────────────────────────────────

LLMTrainingMode = Literal["light", "standard", "fine"]
LLMTrainingStatus = Literal[
    "queued",
    "preparing",
    "training",
    "exporting",
    "registering",
    "completed",
    "failed",
    "canceled",
]

DEFAULT_BASE_MODEL = DEFAULT_TRAINING_BASE_MODEL

# Steps and estimated RTX-3070 duration per mode
MODE_PRESETS: dict[LLMTrainingMode, dict[str, Any]] = {
    "light": {"min_steps": 200, "max_steps": 400, "eta_min": 15},
    "standard": {"min_steps": 400, "max_steps": 800, "eta_min": 35},
    "fine": {"min_steps": 800, "max_steps": 1500, "eta_min": 70},
}

# VRAM required per mode (approximate, Unsloth QLoRA)
VRAM_REQUIRED: dict[LLMTrainingMode, float] = {
    "light": 6.0,
    "standard": 6.5,
    "fine": 7.0,
}

MISSING_GPU_DEPENDENCIES_MSG = (
    "当前环境缺少 LLM 训练依赖（{modules}）。"
    "请先安装 backend[gpu-training] 后再启动训练。"
)
GPU_TRAINING_RUNTIME_DEPENDENCIES = (
    "unsloth",
    "torch",
    "datasets",
    "transformers",
    "trl",
)
WORKER_PROTOCOL_EVENTS = {"status", "progress", "complete", "error"}
TERMINAL_STATUSES = {"completed", "failed", "canceled"}
NON_TERMINAL_STATUSES = {"queued", "preparing", "training", "exporting", "registering"}
RECOVERABLE_INTERRUPTED_STATUSES = ("preparing", "training", "exporting", "registering")
INTERRUPTED_TRAINING_RECOVERY_ERROR = (
    "上次训练在应用关闭或进程中断时未完成，任务已自动结束，请重新发起训练。"
)
STATUS_PROGRESS_HINT: dict[str, float] = {
    "queued": 0.0,
    "preparing": 0.02,
    "training": 0.05,
    "exporting": 0.92,
    "registering": 0.97,
}
WORKER_ERROR_TRANSLATIONS = {
    "out_of_memory": "显存不足，请尝试轻量模式或关闭其他程序",
    "missing_dependency": "训练环境缺少依赖，请先安装 LLM 训练组件后重试",
    "gguf_export_failed": "模型导出失败，请稍后重试",
    "gguf_export_oom": "模型导出失败：内存不足，请关闭其他程序后重试",
    "worker_crash": "训练进程异常退出，请稍后重试",
    "canceled_by_user": "用户已取消训练",
}
REGISTRATION_PENDING_WARNING = "训练已完成，模型已导出，但语言引擎注册未完成，可稍后重试注册"
REGISTRATION_SUCCESS_MESSAGE = "训练完成，模型已可用"
INITIAL_STAGE_NAME = "等待训练资源"
FAILED_STAGE_NAME = "训练失败"
CANCELED_STAGE_NAME = "训练已取消"
RECOVERED_STAGE_NAME = "训练已中断"
STATUS_STAGE_NAMES: dict[str, str] = {
    "queued": INITIAL_STAGE_NAME,
    "preparing": "合并数据集",
    "training": "正在训练",
    "exporting": "导出 GGUF",
    "registering": "注册 Ollama",
    "completed": "训练完成",
    "failed": FAILED_STAGE_NAME,
    "canceled": CANCELED_STAGE_NAME,
}
MODE_LEARNING_RATE: dict[LLMTrainingMode, float] = {
    "light": 2e-4,
    "standard": 1.5e-4,
    "fine": 1e-4,
}
MODE_GRADIENT_ACCUMULATION: dict[LLMTrainingMode, int] = {
    "light": 4,
    "standard": 8,
    "fine": 12,
}

_UNSET = object()


# ── Errors ────────────────────────────────────────────────────────────────────

class LLMTrainingError(Exception):
    """Base LLM training error."""


class LLMTrainingValidationError(LLMTrainingError):
    """Validation failed before enqueuing."""


class LLMTrainingNotFoundError(LLMTrainingError):
    """Job record not found."""


class LLMTrainingCharacterNotFoundError(LLMTrainingError):
    """Character does not exist."""


class LLMTrainingGPUBusyError(LLMTrainingError):
    """GPU is occupied by another task."""


def _open_directory(path: Path) -> None:
    """Open a local directory in the OS file explorer."""
    try:
        if sys.platform == "darwin":
            subprocess.Popen(
                ["open", str(path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return

        if sys.platform.startswith("win"):
            os.startfile(str(path))  # type: ignore[attr-defined]
            return

        subprocess.Popen(
            ["xdg-open", str(path)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except (FileNotFoundError, OSError) as exc:
        raise LLMTrainingError("打开运行目录失败，请手动前往训练目录查看") from exc


# ── Domain records ────────────────────────────────────────────────────────────

@dataclass(slots=True)
class LLMTrainingJobRecord:
    id: str
    character_id: str
    dataset_ids: list[str]
    mode: LLMTrainingMode
    base_model: str
    status: LLMTrainingStatus
    progress: float  # 0.0 – 1.0
    current_step: int
    total_steps: int
    loss: float | None
    eta_seconds: int | None
    stage_name: str | None
    checkpoint_path: str | None
    adapter_path: str | None
    gguf_path: str | None
    error_message: str | None
    queue_task_id: str | None
    created_at: str
    started_at: str | None
    completed_at: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "characterId": self.character_id,
            "datasetIds": self.dataset_ids,
            "mode": self.mode,
            "baseModel": self.base_model,
            "status": self.status,
            "progress": self.progress,
            "currentStep": self.current_step,
            "totalSteps": self.total_steps,
            "loss": self.loss,
            "etaSeconds": self.eta_seconds,
            "stageName": self.stage_name,
            "checkpointPath": self.checkpoint_path,
            "adapterPath": self.adapter_path,
            "ggufPath": self.gguf_path,
            "errorMessage": self.error_message,
            "queueTaskId": self.queue_task_id,
            "createdAt": self.created_at,
            "startedAt": self.started_at,
            "completedAt": self.completed_at,
        }


@dataclass(slots=True)
class WorkerRuntimePaths:
    run_root: Path
    config_path: Path
    checkpoint_dir: Path
    adapter_output_dir: Path
    gguf_output_dir: Path
    cancel_sentinel_path: Path
    log_path: Path

    def ensure_directories(self) -> None:
        self.run_root.mkdir(parents=True, exist_ok=True)
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        self.adapter_output_dir.mkdir(parents=True, exist_ok=True)
        self.gguf_output_dir.mkdir(parents=True, exist_ok=True)
        self.cancel_sentinel_path.parent.mkdir(parents=True, exist_ok=True)
        self.log_path.parent.mkdir(parents=True, exist_ok=True)


@dataclass(slots=True)
class WorkerRunState:
    saw_complete: bool = False
    saw_error: bool = False
    protocol_error: str | None = None
    return_code: int | None = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _row_to_record(row: sqlite3.Row) -> LLMTrainingJobRecord:
    dataset_ids = json.loads(row["dataset_ids_json"]) if row["dataset_ids_json"] else []
    return LLMTrainingJobRecord(
        id=row["id"],
        character_id=row["character_id"],
        dataset_ids=dataset_ids,
        mode=row["mode"],
        base_model=row["base_model"],
        status=row["status"],
        progress=float(row["progress"]),
        current_step=int(row["current_step"]),
        total_steps=int(row["total_steps"]),
        loss=row["loss"],
        eta_seconds=row["eta_seconds"],
        stage_name=row["stage_name"],
        checkpoint_path=row["checkpoint_path"],
        adapter_path=row["adapter_path"],
        gguf_path=row["gguf_path"],
        error_message=row["error_message"],
        queue_task_id=row["queue_task_id"],
        created_at=row["created_at"],
        started_at=row["started_at"],
        completed_at=row["completed_at"],
    )


def _detect_vram_gb() -> float:
    """Detect available VRAM; fall back to 8.0 (conservative default)."""
    import os

    from_env = os.getenv("MELY_GPU_VRAM_GB")
    if from_env:
        try:
            return float(from_env)
        except ValueError:
            pass
    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            return round(torch.cuda.get_device_properties(0).total_memory / (1024 ** 3), 2)
    except Exception:
        pass
    return 8.0


def _normalize_progress(raw: float | int) -> float:
    value = float(raw)
    return max(0.0, min(1.0, value))


def _to_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _to_float_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _env_truthy(name: str) -> bool:
    import os

    value = os.getenv(name)
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def get_missing_gpu_training_dependencies() -> list[str]:
    """Return missing optional dependencies required by GPU training runtime.

    Runtime contract:
    - FastAPI startup must stay import-safe without GPU extras.
    - GPU dependency checks run only when an LLM training job starts.
    """
    missing: list[str] = []
    for module in GPU_TRAINING_RUNTIME_DEPENDENCIES:
        if find_spec(module) is None:
            missing.append(module)
    return missing


# ── Service class ─────────────────────────────────────────────────────────────

class LLMTrainingService:
    def __init__(
        self,
        *,
        db_path: Path,
        data_root: Path,
        queue: TaskQueue,
        llm_model_service: LLMModelService | None = None,
    ) -> None:
        self._db_path = db_path
        self._data_root = data_root
        self._queue = queue
        self._llm_model_service = llm_model_service
        self._worker_script = Path(__file__).with_name("unsloth_worker.py")

    @contextmanager
    def _conn(self):
        with connect_database(self._db_path) as conn:
            conn.row_factory = sqlite3.Row
            yield conn

    def _get_row(self, conn: sqlite3.Connection, job_id: str) -> sqlite3.Row:
        row = conn.execute(
            "SELECT * FROM llm_training_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
        if row is None:
            raise LLMTrainingNotFoundError("LLM 训练任务不存在")
        return row

    def _get_record(self, job_id: str) -> LLMTrainingJobRecord:
        with self._conn() as conn:
            row = self._get_row(conn, job_id)
            return _row_to_record(row)

    def _record_to_dict(self, record: LLMTrainingJobRecord) -> dict[str, Any]:
        payload = record.to_dict()
        payload["runRoot"] = str(
            self._runtime_paths(character_id=record.character_id, job_id=record.id).run_root
        )
        return payload

    def _update(
        self,
        conn: sqlite3.Connection,
        job_id: str,
        *,
        status: LLMTrainingStatus | None = None,
        progress: float | None = None,
        current_step: int | None = None,
        total_steps: int | None = None,
        loss: float | None | object = _UNSET,
        eta_seconds: int | None | object = _UNSET,
        stage_name: str | None | object = _UNSET,
        checkpoint_path: str | None | object = _UNSET,
        adapter_path: str | None | object = _UNSET,
        gguf_path: str | None | object = _UNSET,
        error_message: str | None | object = _UNSET,
        started_at: str | None | object = _UNSET,
        completed_at: str | None | object = _UNSET,
    ) -> None:
        fields = []
        values: list[Any] = []

        if status is not None:
            fields.append("status = ?")
            values.append(status)
        if progress is not None:
            fields.append("progress = ?")
            values.append(_normalize_progress(progress))
        if current_step is not None:
            fields.append("current_step = ?")
            values.append(max(0, int(current_step)))
        if total_steps is not None:
            fields.append("total_steps = ?")
            values.append(max(0, int(total_steps)))
        if loss is not _UNSET:
            fields.append("loss = ?")
            values.append(loss)
        if eta_seconds is not _UNSET:
            fields.append("eta_seconds = ?")
            values.append(eta_seconds)
        if stage_name is not _UNSET:
            fields.append("stage_name = ?")
            values.append(stage_name)
        if checkpoint_path is not _UNSET:
            fields.append("checkpoint_path = ?")
            values.append(checkpoint_path)
        if adapter_path is not _UNSET:
            fields.append("adapter_path = ?")
            values.append(adapter_path)
        if gguf_path is not _UNSET:
            fields.append("gguf_path = ?")
            values.append(gguf_path)
        if error_message is not _UNSET:
            fields.append("error_message = ?")
            values.append(error_message)
        if started_at is not _UNSET:
            fields.append("started_at = ?")
            values.append(started_at)
        if completed_at is not _UNSET:
            fields.append("completed_at = ?")
            values.append(completed_at)

        if not fields:
            return

        values.append(job_id)
        conn.execute(
            f"UPDATE llm_training_jobs SET {', '.join(fields)} WHERE id = ?",
            tuple(values),
        )

    def _runtime_paths(self, *, character_id: str, job_id: str) -> WorkerRuntimePaths:
        llm_dirs = ensure_llm_directories(self._data_root, character_id)
        run_root = self._data_root / "characters" / character_id / "llm_training_runs" / job_id
        return WorkerRuntimePaths(
            run_root=run_root,
            config_path=run_root / "worker-config.json",
            checkpoint_dir=run_root / "checkpoints",
            adapter_output_dir=llm_dirs["llm_adapters"] / job_id,
            gguf_output_dir=llm_dirs["llm_models"] / job_id,
            cancel_sentinel_path=run_root / "cancel.sentinel",
            log_path=run_root / "worker.log",
        )

    def _write_cancel_sentinel(self, *, character_id: str, job_id: str) -> None:
        runtime_paths = self._runtime_paths(character_id=character_id, job_id=job_id)
        runtime_paths.ensure_directories()
        runtime_paths.cancel_sentinel_path.write_text("cancel", encoding="utf-8")

    def _resolve_dataset_paths(self, record: LLMTrainingJobRecord) -> list[str]:
        dataset_paths: list[str] = []
        with self._conn() as conn:
            for dataset_id in record.dataset_ids:
                row = conn.execute(
                    """
                    SELECT converted_path
                    FROM llm_datasets
                    WHERE id = ? AND character_id = ?
                    """,
                    (dataset_id, record.character_id),
                ).fetchone()
                if row is None:
                    raise LLMTrainingError(f"训练数据集不存在：{dataset_id}")
                converted_path = str(row["converted_path"] or "").strip()
                if not converted_path:
                    raise LLMTrainingError(f"训练数据集缺少可用文件：{dataset_id}")
                path = Path(converted_path)
                if not path.exists():
                    raise LLMTrainingError(f"训练数据集文件不存在：{path}")
                dataset_paths.append(str(path))
        return dataset_paths

    def _count_dataset_items(self, record: LLMTrainingJobRecord) -> int:
        total = 0
        with self._conn() as conn:
            for dataset_id in record.dataset_ids:
                row = conn.execute(
                    """
                    SELECT item_count
                    FROM llm_datasets
                    WHERE id = ? AND character_id = ?
                    """,
                    (dataset_id, record.character_id),
                ).fetchone()
                if row is None:
                    continue
                total += max(0, _to_int(row["item_count"], 0))
        return total

    def _build_worker_payload(
        self,
        record: LLMTrainingJobRecord,
        *,
        runtime_paths: WorkerRuntimePaths,
        dataset_paths: list[str],
    ) -> dict[str, Any]:
        base_model_config = get_training_base_model(record.base_model)
        if base_model_config is None:
            raise LLMTrainingError(build_unsupported_model_error(record.base_model))

        mode = record.mode
        return {
            "jobId": record.id,
            "mode": mode,
            "baseModel": record.base_model,
            "unslothModelName": base_model_config.huggingface_model_id,
            "datasetPaths": dataset_paths,
            "outputDir": str(runtime_paths.run_root),
            "adapterOutputDir": str(runtime_paths.adapter_output_dir),
            "checkpointDir": str(runtime_paths.checkpoint_dir),
            "ggufOutputDir": str(runtime_paths.gguf_output_dir),
            "cancelSentinelPath": str(runtime_paths.cancel_sentinel_path),
            "logPath": str(runtime_paths.log_path),
            "maxSteps": max(1, record.total_steps),
            "checkpointEverySteps": 100,
            "maxSeqLen": base_model_config.max_seq_len,
            "loraRank": base_model_config.default_lora_rank,
            "learningRate": MODE_LEARNING_RATE[mode],
            "perDeviceTrainBatchSize": 1,
            "gradientAccumulationSteps": MODE_GRADIENT_ACCUMULATION[mode],
            "warmupSteps": 10,
            "weightDecay": 0.01,
            "seed": 42,
            "exportQuantization": "q4_k_m",
            "dryRun": _env_truthy("MELY_LLM_WORKER_DRY_RUN"),
            "dryRunStepDelaySeconds": 0.01,
        }

    async def _launch_worker_process(
        self,
        config_path: Path,
    ) -> asyncio.subprocess.Process:
        return await asyncio.create_subprocess_exec(
            sys.executable,
            str(self._worker_script),
            str(config_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )

    async def _terminate_worker_process(self, process: asyncio.subprocess.Process) -> None:
        if process.returncode is not None:
            return
        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=3.0)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()

    def _parse_worker_event(self, raw_line: bytes) -> dict[str, Any]:
        line = raw_line.decode("utf-8", errors="replace").strip()
        if not line:
            raise ValueError("empty_line")
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError("json_decode_failed") from exc
        if not isinstance(payload, dict):
            raise ValueError("event_not_object")
        event = str(payload.get("event") or "").strip().lower()
        if event not in WORKER_PROTOCOL_EVENTS:
            raise ValueError("unknown_event")
        return payload

    def _translate_worker_error(self, *, code: str, message: str | None) -> str:
        normalized_code = code.strip().lower()
        if normalized_code in WORKER_ERROR_TRANSLATIONS:
            return WORKER_ERROR_TRANSLATIONS[normalized_code]

        raw = (message or "").strip()
        lowered = raw.lower()
        if "out of memory" in lowered or ("cuda" in lowered and "memory" in lowered):
            return WORKER_ERROR_TRANSLATIONS["out_of_memory"]
        if "no module named" in lowered or "importerror" in lowered:
            return WORKER_ERROR_TRANSLATIONS["missing_dependency"]
        if "gguf" in lowered and ("export" in lowered or "导出" in raw):
            return WORKER_ERROR_TRANSLATIONS["gguf_export_failed"]
        if normalized_code == "worker_crash":
            return WORKER_ERROR_TRANSLATIONS["worker_crash"]
        if raw:
            return raw
        return "训练进程异常退出，请稍后重试"

    def _mark_failed(self, job_id: str, message: str) -> None:
        with self._conn() as conn:
            record = _row_to_record(self._get_row(conn, job_id))
            if record.status == "canceled":
                return
            if record.status == "completed":
                return
            self._update(
                conn,
                job_id,
                status="failed",
                stage_name=FAILED_STAGE_NAME,
                error_message=message,
                completed_at=_utc_now(),
            )
            conn.commit()

    def _is_canceled(self, job_id: str) -> bool:
        with self._conn() as conn:
            status = conn.execute(
                "SELECT status FROM llm_training_jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
            if status is None:
                return False
            return str(status["status"]) == "canceled"

    def recover_interrupted_jobs(self) -> int:
        """Mark interrupted in-flight jobs as failed during app startup."""
        status_placeholders = ", ".join("?" for _ in RECOVERABLE_INTERRUPTED_STATUSES)
        now = _utc_now()

        with self._conn() as conn:
            rows = conn.execute(
                f"""
                SELECT id
                FROM llm_training_jobs
                WHERE status IN ({status_placeholders})
                """,
                RECOVERABLE_INTERRUPTED_STATUSES,
            ).fetchall()
            if not rows:
                return 0

            conn.execute(
                f"""
                UPDATE llm_training_jobs
                SET
                    status = 'failed',
                    stage_name = ?,
                    error_message = ?,
                    eta_seconds = NULL,
                    completed_at = ?
                WHERE status IN ({status_placeholders})
                """,
                (
                    RECOVERED_STAGE_NAME,
                    INTERRUPTED_TRAINING_RECOVERY_ERROR,
                    now,
                    *RECOVERABLE_INTERRUPTED_STATUSES,
                ),
            )
            conn.commit()
            return len(rows)

    async def _apply_worker_event(
        self,
        *,
        job_id: str,
        event_payload: dict[str, Any],
        progress_reporter,
    ) -> Literal["continue", "complete", "error"]:
        event = str(event_payload["event"]).strip().lower()
        record = self._get_record(job_id)

        if record.status == "canceled":
            return "error"

        if event == "status":
            raw_status = str(event_payload.get("status") or "").strip().lower()
            if raw_status not in NON_TERMINAL_STATUSES:
                return "continue"
            message = str(event_payload.get("message") or "").strip() or None
            explicit_stage_name = str(event_payload.get("stageName") or "").strip() or None
            stage_name = explicit_stage_name or STATUS_STAGE_NAMES.get(raw_status)
            hinted_progress = STATUS_PROGRESS_HINT.get(raw_status, record.progress)
            next_progress = max(record.progress, hinted_progress)
            with self._conn() as conn:
                self._update(
                    conn,
                    job_id,
                    status=raw_status,  # type: ignore[arg-type]
                    progress=next_progress,
                    started_at=record.started_at if record.started_at else _utc_now(),
                    stage_name=stage_name,
                    error_message=None,
                )
                conn.commit()
            if message:
                await progress_reporter(int(next_progress * 100), message)
            return "continue"

        if event == "progress":
            step = max(0, _to_int(event_payload.get("step"), record.current_step))
            total_steps = max(step, _to_int(event_payload.get("totalSteps"), max(record.total_steps, 1)))
            raw_progress = event_payload.get("progress")
            if raw_progress is None:
                progress = step / max(total_steps, 1)
            else:
                progress = _normalize_progress(_to_float_or_none(raw_progress) or 0.0)
            progress = min(progress, 0.99)

            raw_status = str(event_payload.get("status") or "training").strip().lower()
            status: LLMTrainingStatus = "training"
            if raw_status in {"preparing", "training", "exporting", "registering"}:
                status = raw_status  # type: ignore[assignment]
            loss_value = _to_float_or_none(event_payload.get("loss"))
            eta_raw = event_payload.get("etaSeconds")
            eta_value = _to_int(eta_raw, record.eta_seconds or 0) if eta_raw is not None else None
            checkpoint_path = str(event_payload.get("checkpointPath") or "").strip() or None
            explicit_stage_name = str(event_payload.get("stageName") or "").strip() or None
            stage_name = explicit_stage_name or STATUS_STAGE_NAMES.get(status)

            with self._conn() as conn:
                self._update(
                    conn,
                    job_id,
                    status=status,
                    progress=progress,
                    current_step=step,
                    total_steps=total_steps,
                    loss=loss_value if loss_value is not None else _UNSET,
                    eta_seconds=eta_value if eta_raw is not None else _UNSET,
                    stage_name=stage_name,
                    checkpoint_path=checkpoint_path if checkpoint_path is not None else _UNSET,
                    started_at=record.started_at if record.started_at else _utc_now(),
                    error_message=None,
                )
                conn.commit()
            await progress_reporter(int(progress * 100), f"训练中 {step}/{total_steps}")
            return "continue"

        if event == "complete":
            adapter_path = str(event_payload.get("adapterPath") or "").strip()
            gguf_path = str(event_payload.get("ggufPath") or "").strip()
            if not adapter_path or not gguf_path:
                raise ValueError("complete_event_missing_paths")
            final_loss = _to_float_or_none(event_payload.get("finalLoss"))
            with self._conn() as conn:
                latest = _row_to_record(self._get_row(conn, job_id))
                registering_progress = max(
                    latest.progress,
                    STATUS_PROGRESS_HINT.get("registering", latest.progress),
                )
                self._update(
                    conn,
                    job_id,
                    status="registering",
                    progress=registering_progress,
                    current_step=max(latest.current_step, latest.total_steps),
                    total_steps=max(latest.total_steps, latest.current_step),
                    loss=final_loss if final_loss is not None else _UNSET,
                    eta_seconds=None,
                    stage_name=STATUS_STAGE_NAMES["registering"],
                    adapter_path=adapter_path,
                    gguf_path=gguf_path,
                    started_at=latest.started_at if latest.started_at else _utc_now(),
                    error_message=None,
                )
                conn.commit()
            await progress_reporter(int(registering_progress * 100), "训练完成，正在注册模型…")
            return "complete"

        code = str(event_payload.get("code") or "worker_crash")
        raw_message = str(event_payload.get("message") or "")
        raw_status = str(event_payload.get("status") or "failed").strip().lower()
        translated_message = self._translate_worker_error(code=code, message=raw_message)
        terminal_status: LLMTrainingStatus = "canceled" if raw_status == "canceled" else "failed"

        with self._conn() as conn:
            latest = _row_to_record(self._get_row(conn, job_id))
            if latest.status not in TERMINAL_STATUSES:
                self._update(
                    conn,
                    job_id,
                    status=terminal_status,
                    stage_name=CANCELED_STAGE_NAME if terminal_status == "canceled" else FAILED_STAGE_NAME,
                    error_message=translated_message,
                    eta_seconds=None,
                    completed_at=_utc_now(),
                )
                conn.commit()

        await progress_reporter(int(record.progress * 100), translated_message)
        return "error"

    async def _consume_worker_stream(
        self,
        *,
        job_id: str,
        process: asyncio.subprocess.Process,
        runtime_paths: WorkerRuntimePaths,
        progress_reporter,
    ) -> WorkerRunState:
        state = WorkerRunState()
        stdout = process.stdout
        if stdout is None:
            state.protocol_error = "missing_stdout_pipe"
            state.return_code = await process.wait()
            return state

        while True:
            if self._is_canceled(job_id):
                runtime_paths.ensure_directories()
                runtime_paths.cancel_sentinel_path.write_text("cancel", encoding="utf-8")
                await self._terminate_worker_process(process)

            try:
                raw_line = await asyncio.wait_for(stdout.readline(), timeout=0.2)
            except asyncio.TimeoutError:
                raw_line = b""

            if raw_line:
                try:
                    payload = self._parse_worker_event(raw_line)
                    outcome = await self._apply_worker_event(
                        job_id=job_id,
                        event_payload=payload,
                        progress_reporter=progress_reporter,
                    )
                except ValueError:
                    state.protocol_error = "worker_protocol_invalid"
                    await self._terminate_worker_process(process)
                    continue

                if outcome == "complete":
                    state.saw_complete = True
                elif outcome == "error":
                    state.saw_error = True
                continue

            if process.returncode is not None:
                break

            if stdout.at_eof():
                break

        state.return_code = await process.wait()
        return state

    async def _finalize_registration_after_worker_complete(
        self,
        *,
        job_id: str,
        progress_reporter,
    ) -> None:
        record = self._get_record(job_id)
        if record.status == "canceled":
            return

        gguf_path = str(record.gguf_path or "").strip()
        if not gguf_path:
            failure_message = WORKER_ERROR_TRANSLATIONS["gguf_export_failed"]
            self._mark_failed(job_id, failure_message)
            raise RuntimeError(failure_message)

        gguf_file = Path(gguf_path).expanduser()
        if not gguf_file.exists() or not gguf_file.is_file():
            failure_message = WORKER_ERROR_TRANSLATIONS["gguf_export_failed"]
            self._mark_failed(job_id, failure_message)
            raise RuntimeError(failure_message)

        if self._llm_model_service is None:
            with self._conn() as conn:
                latest = _row_to_record(self._get_row(conn, job_id))
                if latest.status != "canceled":
                    self._update(
                        conn,
                        job_id,
                        status="completed",
                        progress=1.0,
                        eta_seconds=None,
                        stage_name=STATUS_STAGE_NAMES["completed"],
                        error_message=REGISTRATION_PENDING_WARNING,
                        completed_at=_utc_now(),
                    )
                    conn.commit()
            await progress_reporter(100, REGISTRATION_PENDING_WARNING)
            return

        model_record = await self._llm_model_service.register_model(
            character_id=record.character_id,
            gguf_path=gguf_path,
            base_model=record.base_model,
            training_job_id=record.id,
            dataset_item_count=self._count_dataset_items(record),
            loss_final=record.loss,
        )
        model_status = str(model_record.get("status") or "").strip().lower()

        if model_status == "ready":
            with self._conn() as conn:
                latest = _row_to_record(self._get_row(conn, job_id))
                if latest.status != "canceled":
                    self._update(
                        conn,
                        job_id,
                        status="completed",
                        progress=1.0,
                        eta_seconds=None,
                        stage_name=STATUS_STAGE_NAMES["completed"],
                        error_message=None,
                        completed_at=_utc_now(),
                    )
                    conn.commit()
            await progress_reporter(100, REGISTRATION_SUCCESS_MESSAGE)
            return

        if model_status == "pending":
            with self._conn() as conn:
                latest = _row_to_record(self._get_row(conn, job_id))
                if latest.status != "canceled":
                    self._update(
                        conn,
                        job_id,
                        status="completed",
                        progress=1.0,
                        eta_seconds=None,
                        stage_name=STATUS_STAGE_NAMES["completed"],
                        error_message=REGISTRATION_PENDING_WARNING,
                        completed_at=_utc_now(),
                    )
                    conn.commit()
            await progress_reporter(100, REGISTRATION_PENDING_WARNING)
            return

        failure_message = WORKER_ERROR_TRANSLATIONS["gguf_export_failed"]
        self._mark_failed(job_id, failure_message)
        raise RuntimeError(failure_message)

    # ── public API ────────────────────────────────────────────────────────────

    async def start_training(
        self,
        character_id: str,
        dataset_ids: list[str],
        mode: LLMTrainingMode,
        base_model: str = DEFAULT_BASE_MODEL,
    ) -> dict[str, Any]:
        """Validate, persist, and enqueue an LLM training job."""
        if mode not in MODE_PRESETS:
            raise LLMTrainingValidationError("训练模式无效，请选择 light / standard / fine")
        if not dataset_ids:
            raise LLMTrainingValidationError("至少需要选择一个数据集才能开始训练")

        base_model_config = get_training_base_model(base_model)
        if base_model_config is None:
            raise LLMTrainingValidationError(build_unsupported_model_error(base_model))

        try:
            ollama_status = await check_ollama_status()
        except OllamaAPIError as exc:
            raise LLMTrainingValidationError("语言引擎状态检查失败，请稍后重试") from exc

        if not ollama_status.running:
            raise LLMTrainingValidationError("语言引擎未启动，请先启动 Ollama")

        downloaded_models = {
            str(model.name).strip().lower()
            for model in ollama_status.models
            if getattr(model, "name", None)
        }
        if base_model_config.ollama_tag.strip().lower() not in downloaded_models:
            raise LLMTrainingValidationError(
                build_model_not_downloaded_error(base_model_config.ollama_tag)
            )

        hardware_policy = get_active_hardware_policy()
        if not is_mode_allowed_for_policy(mode, hardware_policy):
            raise LLMTrainingValidationError(
                build_mode_not_allowed_error(mode, hardware_policy)
            )

        # GPU precheck
        vram_gb = _detect_vram_gb()
        required = VRAM_REQUIRED[mode]
        if vram_gb < required:
            raise LLMTrainingValidationError(
                f"显存不足（当前 {vram_gb:.1f}GB，{mode} 模式需要 {required}GB）"
            )

        # Check GPU mutex
        from app.services.gpu_mutex import EngineGpuMutexError, check_gpu_exclusive

        try:
            check_gpu_exclusive(self._queue)
        except EngineGpuMutexError as exc:
            raise LLMTrainingGPUBusyError(str(exc)) from exc

        # Verify character + datasets exist
        with self._conn() as conn:
            if not conn.execute(
                "SELECT 1 FROM characters WHERE id = ?",
                (character_id,),
            ).fetchone():
                raise LLMTrainingCharacterNotFoundError("角色不存在，请先创建角色")

            for ds_id in dataset_ids:
                if not conn.execute(
                    "SELECT 1 FROM llm_datasets WHERE id = ? AND character_id = ?",
                    (ds_id, character_id),
                ).fetchone():
                    raise LLMTrainingValidationError(
                        f"数据集 {ds_id} 不存在或不属于该角色"
                    )

        preset = MODE_PRESETS[mode]
        total_steps = preset["max_steps"]
        job_id = str(uuid4())
        now = _utc_now()

        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO llm_training_jobs
                    (id, character_id, dataset_ids_json, mode, base_model,
                     status, progress, current_step, total_steps, stage_name,
                     queue_task_id, created_at)
                VALUES (?, ?, ?, ?, ?, 'queued', 0.0, 0, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    character_id,
                    json.dumps(dataset_ids),
                    mode,
                    base_model_config.ollama_tag,
                    total_steps,
                    INITIAL_STAGE_NAME,
                    job_id,
                    now,
                ),
            )
            conn.commit()

        try:
            await self._queue.submit(
                name=f"llm-training-{character_id}",
                runner=self._build_runner(job_id),
                category="gpu_exclusive",
                task_id=job_id,
                initial_progress=0,
                initial_message="LLM 训练任务已进入队列",
            )
        except RuntimeError as exc:
            with self._conn() as conn:
                self._update(
                    conn,
                    job_id,
                    status="failed",
                    stage_name=FAILED_STAGE_NAME,
                    error_message="训练任务入队失败，请稍后重试",
                    completed_at=_utc_now(),
                )
                conn.commit()
            raise LLMTrainingError("训练任务入队失败，请稍后重试") from exc

        return self.get_job(job_id)

    def _build_runner(self, job_id: str):
        """Build async subprocess runner that orchestrates a worker process."""

        async def runner(progress_reporter) -> None:
            record = self._get_record(job_id)
            if record.status == "canceled":
                return

            with self._conn() as conn:
                self._update(
                    conn,
                    job_id,
                    status="preparing",
                    progress=0.02,
                    started_at=record.started_at if record.started_at else _utc_now(),
                    stage_name=STATUS_STAGE_NAMES["preparing"],
                    error_message=None,
                )
                conn.commit()
            await progress_reporter(2, "正在准备训练环境…")

            if self._is_canceled(job_id):
                return

            missing_dependencies = get_missing_gpu_training_dependencies()
            if missing_dependencies:
                missing_message = MISSING_GPU_DEPENDENCIES_MSG.format(
                    modules="、".join(missing_dependencies)
                )
                self._mark_failed(job_id, missing_message)
                raise RuntimeError(missing_message)

            try:
                dataset_paths = self._resolve_dataset_paths(record)
            except LLMTrainingError as exc:
                self._mark_failed(job_id, str(exc))
                raise RuntimeError(str(exc)) from exc

            runtime_paths = self._runtime_paths(character_id=record.character_id, job_id=record.id)
            runtime_paths.ensure_directories()
            worker_payload = self._build_worker_payload(
                record,
                runtime_paths=runtime_paths,
                dataset_paths=dataset_paths,
            )
            runtime_paths.config_path.write_text(
                json.dumps(worker_payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            try:
                process = await self._launch_worker_process(runtime_paths.config_path)
            except Exception as exc:
                launch_error = "训练进程启动失败，请稍后重试"
                self._mark_failed(job_id, launch_error)
                raise RuntimeError(launch_error) from exc

            run_state = await self._consume_worker_stream(
                job_id=job_id,
                process=process,
                runtime_paths=runtime_paths,
                progress_reporter=progress_reporter,
            )

            final_record = self._get_record(job_id)
            if final_record.status == "canceled":
                return

            if run_state.protocol_error:
                protocol_message = "训练进程输出协议异常，请重试"
                self._mark_failed(job_id, protocol_message)
                raise RuntimeError(protocol_message)

            if run_state.saw_complete and run_state.return_code == 0:
                await self._finalize_registration_after_worker_complete(
                    job_id=job_id,
                    progress_reporter=progress_reporter,
                )
                return

            if run_state.saw_error:
                latest = self._get_record(job_id)
                if latest.status == "canceled":
                    return
                message = latest.error_message or "训练失败，请稍后重试"
                raise RuntimeError(message)

            crash_message = "训练进程异常退出，请稍后重试"
            self._mark_failed(job_id, crash_message)
            raise RuntimeError(crash_message)

        return runner

    def get_job(self, job_id: str) -> dict[str, Any]:
        with self._conn() as conn:
            row = self._get_row(conn, job_id)
            return self._record_to_dict(_row_to_record(row))

    def list_jobs(self, character_id: str | None = None) -> list[dict[str, Any]]:
        with self._conn() as conn:
            if character_id:
                rows = conn.execute(
                    "SELECT * FROM llm_training_jobs WHERE character_id = ? ORDER BY created_at DESC",
                    (character_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM llm_training_jobs ORDER BY created_at DESC"
                ).fetchall()
            return [self._record_to_dict(_row_to_record(r)) for r in rows]

    def cancel_job(self, job_id: str) -> dict[str, Any]:
        with self._conn() as conn:
            row = self._get_row(conn, job_id)
            record = _row_to_record(row)
            if record.status in TERMINAL_STATUSES:
                raise LLMTrainingValidationError(
                    f"任务已处于 {record.status} 状态，无法取消"
                )

            self._update(
                conn,
                job_id,
                status="canceled",
                stage_name=CANCELED_STAGE_NAME,
                error_message="用户手动取消",
                completed_at=_utc_now(),
            )
            conn.commit()

        self._write_cancel_sentinel(character_id=record.character_id, job_id=job_id)
        return self.get_job(job_id)

    def open_run_root(self, job_id: str) -> None:
        record = self._get_record(job_id)
        runtime_paths = self._runtime_paths(character_id=record.character_id, job_id=record.id)
        runtime_paths.ensure_directories()
        _open_directory(runtime_paths.run_root)


def create_llm_training_service(
    *,
    db_path: Path,
    data_root: Path,
    queue: TaskQueue,
    llm_model_service: LLMModelService | None = None,
) -> LLMTrainingService:
    return LLMTrainingService(
        db_path=db_path,
        data_root=data_root,
        queue=queue,
        llm_model_service=llm_model_service,
    )
