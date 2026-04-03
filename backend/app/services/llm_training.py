"""LLM training service — Unsloth QLoRA fine-tuning pipeline.

Lifecycle:
  queued → preparing → training → exporting → registering → completed
                                                           ↘ failed
                                                           ↘ canceled

The executor is a placeholder until Unsloth is available in the runtime
environment.  The scaffolding (DB state machine, GPU mutex, task queue wiring)
is fully functional and tested.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from app.db.connection import connect_database
from app.services.task_queue import TaskQueue

# ── Types ──────────────────────────────────────────────────────────────────────

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

DEFAULT_BASE_MODEL = "qwen2.5:7b-instruct-q4_K_M"

# Steps and estimated RTX-3070 duration per mode
MODE_PRESETS: dict[LLMTrainingMode, dict[str, Any]] = {
    "light":    {"min_steps": 200, "max_steps": 400,  "eta_min": 15},
    "standard": {"min_steps": 400, "max_steps": 800,  "eta_min": 35},
    "fine":     {"min_steps": 800, "max_steps": 1500, "eta_min": 70},
}

# VRAM required per mode (approximate, Unsloth QLoRA)
VRAM_REQUIRED: dict[LLMTrainingMode, float] = {
    "light": 6.0,
    "standard": 6.5,
    "fine": 7.0,
}

UNAVAILABLE_EXECUTOR_MSG = (
    "LLM 训练任务已通过预检并入队，但当前环境未接入 Unsloth 训练执行器。"
)

_UNSET = object()


# ── Errors ─────────────────────────────────────────────────────────────────────

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


# ── Domain record ──────────────────────────────────────────────────────────────

@dataclass(slots=True)
class LLMTrainingJobRecord:
    id: str
    character_id: str
    dataset_ids: list[str]
    mode: LLMTrainingMode
    base_model: str
    status: LLMTrainingStatus
    progress: float          # 0.0 – 1.0
    current_step: int
    total_steps: int
    loss: float | None
    eta_seconds: int | None
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
            "adapterPath": self.adapter_path,
            "ggufPath": self.gguf_path,
            "errorMessage": self.error_message,
            "queueTaskId": self.queue_task_id,
            "createdAt": self.created_at,
            "startedAt": self.started_at,
            "completedAt": self.completed_at,
        }


# ── Helpers ────────────────────────────────────────────────────────────────────

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


# ── Service class ──────────────────────────────────────────────────────────────

class LLMTrainingService:
    def __init__(self, *, db_path: Path, queue: TaskQueue) -> None:
        self._db_path = db_path
        self._queue = queue

    @contextmanager
    def _conn(self):
        with connect_database(self._db_path) as conn:
            conn.row_factory = sqlite3.Row
            yield conn

    def _get_row(self, conn: sqlite3.Connection, job_id: str) -> sqlite3.Row:
        row = conn.execute(
            "SELECT * FROM llm_training_jobs WHERE id = ?", (job_id,)
        ).fetchone()
        if row is None:
            raise LLMTrainingNotFoundError("LLM 训练任务不存在")
        return row

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
        adapter_path: str | None | object = _UNSET,
        gguf_path: str | None | object = _UNSET,
        error_message: str | None | object = _UNSET,
        started_at: str | None | object = _UNSET,
        completed_at: str | None | object = _UNSET,
    ) -> None:
        fields = []
        values: list[Any] = []

        if status is not None:
            fields.append("status = ?"); values.append(status)
        if progress is not None:
            fields.append("progress = ?"); values.append(progress)
        if current_step is not None:
            fields.append("current_step = ?"); values.append(current_step)
        if total_steps is not None:
            fields.append("total_steps = ?"); values.append(total_steps)
        if loss is not _UNSET:
            fields.append("loss = ?"); values.append(loss)
        if eta_seconds is not _UNSET:
            fields.append("eta_seconds = ?"); values.append(eta_seconds)
        if adapter_path is not _UNSET:
            fields.append("adapter_path = ?"); values.append(adapter_path)
        if gguf_path is not _UNSET:
            fields.append("gguf_path = ?"); values.append(gguf_path)
        if error_message is not _UNSET:
            fields.append("error_message = ?"); values.append(error_message)
        if started_at is not _UNSET:
            fields.append("started_at = ?"); values.append(started_at)
        if completed_at is not _UNSET:
            fields.append("completed_at = ?"); values.append(completed_at)

        if not fields:
            return
        values.append(job_id)
        conn.execute(
            f"UPDATE llm_training_jobs SET {', '.join(fields)} WHERE id = ?",
            tuple(values),
        )

    # ── public API ──────────────────────────────────────────────────────────────

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

        # GPU precheck
        vram_gb = _detect_vram_gb()
        required = VRAM_REQUIRED[mode]
        if vram_gb < required:
            raise LLMTrainingValidationError(
                f"显存不足（当前 {vram_gb:.1f}GB，{mode} 模式需要 {required}GB）"
            )

        # Check GPU mutex
        from app.services.gpu_mutex import check_gpu_exclusive, EngineGpuMutexError
        try:
            check_gpu_exclusive(self._queue)
        except EngineGpuMutexError as exc:
            raise LLMTrainingGPUBusyError(str(exc)) from exc

        # Verify character + datasets exist
        with self._conn() as conn:
            if not conn.execute(
                "SELECT 1 FROM characters WHERE id = ?", (character_id,)
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
                     status, progress, current_step, total_steps,
                     queue_task_id, created_at)
                VALUES (?, ?, ?, ?, ?, 'queued', 0.0, 0, ?, ?, ?)
                """,
                (
                    job_id,
                    character_id,
                    json.dumps(dataset_ids),
                    mode,
                    base_model,
                    total_steps,
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
                    conn, job_id,
                    status="failed",
                    error_message="训练任务入队失败，请稍后重试",
                    completed_at=_utc_now(),
                )
                conn.commit()
            raise LLMTrainingError("训练任务入队失败，请稍后重试") from exc

        return self.get_job(job_id)

    def _build_runner(self, job_id: str):
        """Build the async task runner for this job.

        Currently a placeholder: marks the job as failed with a clear message
        that the Unsloth executor is not yet wired in.  The full executor will
        replace this body when Unsloth is available in the runtime.
        """
        async def runner(progress_reporter) -> None:
            with self._conn() as conn:
                self._update(
                    conn, job_id,
                    status="preparing",
                    progress=0.02,
                    started_at=_utc_now(),
                )
                conn.commit()

            await progress_reporter(2, "正在准备训练环境…")

            with self._conn() as conn:
                self._update(
                    conn, job_id,
                    status="failed",
                    error_message=UNAVAILABLE_EXECUTOR_MSG,
                    completed_at=_utc_now(),
                )
                conn.commit()

            raise RuntimeError(UNAVAILABLE_EXECUTOR_MSG)

        return runner

    def get_job(self, job_id: str) -> dict[str, Any]:
        with self._conn() as conn:
            row = self._get_row(conn, job_id)
            return _row_to_record(row).to_dict()

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
            return [_row_to_record(r).to_dict() for r in rows]

    def cancel_job(self, job_id: str) -> dict[str, Any]:
        with self._conn() as conn:
            row = self._get_row(conn, job_id)
            record = _row_to_record(row)
            if record.status in ("completed", "failed", "canceled"):
                raise LLMTrainingValidationError(
                    f"任务已处于 {record.status} 状态，无法取消"
                )
            self._update(
                conn, job_id,
                status="canceled",
                error_message="用户手动取消",
                completed_at=_utc_now(),
            )
            conn.commit()
        return self.get_job(job_id)


def create_llm_training_service(*, db_path: Path, queue: TaskQueue) -> LLMTrainingService:
    return LLMTrainingService(db_path=db_path, queue=queue)
