"""Visual LoRA training service — AI-Toolkit pipeline (placeholder executor).

Lifecycle:
  queued → preparing → training → completed
                               ↘ failed
                               ↘ canceled

The executor is a placeholder until AI-Toolkit is available in the runtime.
The scaffolding (DB state machine, GPU mutex, task queue wiring) is fully functional.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from app.db.connection import connect_database
from app.services.task_queue import TaskQueue


# ── Types ──────────────────────────────────────────────────────────────────────

VisualTrainingMode = Literal["light", "standard", "fine"]
VisualTrainingStatus = Literal[
    "queued", "preparing", "training", "completed", "failed", "canceled"
]

DEFAULT_CHECKPOINT = "flux-dev-q4"

# Steps and estimated RTX-3070 duration per mode (AI-Toolkit LoRA)
MODE_PRESETS: dict[VisualTrainingMode, dict[str, Any]] = {
    "light":    {"steps": 500,  "eta_min": 20},
    "standard": {"steps": 1500, "eta_min": 50},
    "fine":     {"steps": 3000, "eta_min": 90},
}

# VRAM required per mode (approximate, FLUX Q4 + LoRA)
VRAM_REQUIRED: dict[VisualTrainingMode, float] = {
    "light":    6.0,
    "standard": 7.0,
    "fine":     11.0,  # needs 12 GB card
}

UNAVAILABLE_EXECUTOR_MSG = (
    "视觉训练任务已通过预检并入队，但当前环境未接入 AI-Toolkit 训练执行器。"
)


# ── Errors ─────────────────────────────────────────────────────────────────────

class VisualTrainingError(Exception):
    """Base visual training error."""


class VisualTrainingValidationError(VisualTrainingError):
    pass


class VisualTrainingNotFoundError(VisualTrainingError):
    pass


class VisualTrainingCharacterNotFoundError(VisualTrainingError):
    pass


class VisualTrainingGPUBusyError(VisualTrainingError):
    pass


# ── Domain record ──────────────────────────────────────────────────────────────

@dataclass(slots=True)
class VisualTrainingJobRecord:
    id: str
    character_id: str
    dataset_ids: list[str]
    mode: VisualTrainingMode
    base_checkpoint: str
    trigger_word: str
    status: VisualTrainingStatus
    progress: float
    current_step: int
    total_steps: int
    eta_seconds: int | None
    lora_path: str | None
    sample_images: list[str]
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
            "baseCheckpoint": self.base_checkpoint,
            "triggerWord": self.trigger_word,
            "status": self.status,
            "progress": self.progress,
            "currentStep": self.current_step,
            "totalSteps": self.total_steps,
            "etaSeconds": self.eta_seconds,
            "loraPath": self.lora_path,
            "sampleImages": self.sample_images,
            "errorMessage": self.error_message,
            "queueTaskId": self.queue_task_id,
            "createdAt": self.created_at,
            "startedAt": self.started_at,
            "completedAt": self.completed_at,
        }


# ── Helpers ────────────────────────────────────────────────────────────────────

def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _row_to_record(row: sqlite3.Row) -> VisualTrainingJobRecord:
    return VisualTrainingJobRecord(
        id=row["id"],
        character_id=row["character_id"],
        dataset_ids=json.loads(row["dataset_ids_json"]) if row["dataset_ids_json"] else [],
        mode=row["mode"],
        base_checkpoint=row["base_checkpoint"],
        trigger_word=row["trigger_word"],
        status=row["status"],
        progress=float(row["progress"]),
        current_step=int(row["current_step"]),
        total_steps=int(row["total_steps"]),
        eta_seconds=row["eta_seconds"],
        lora_path=row["lora_path"],
        sample_images=json.loads(row["sample_images_json"]) if row["sample_images_json"] else [],
        error_message=row["error_message"],
        queue_task_id=row["queue_task_id"],
        created_at=row["created_at"],
        started_at=row["started_at"],
        completed_at=row["completed_at"],
    )


# ── Service ────────────────────────────────────────────────────────────────────

class VisualTrainingService:
    def __init__(self, db_path: Path, queue: TaskQueue) -> None:
        self._db_path = db_path
        self._queue = queue

    def _conn(self) -> sqlite3.Connection:
        conn = connect_database(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    # ── Read operations ─────────────────────────────────────────────────────────

    def get_job(self, job_id: str) -> dict:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM visual_training_jobs WHERE id = ?", (job_id,)
            ).fetchone()
        if not row:
            raise VisualTrainingNotFoundError(f"训练任务 {job_id} 不存在")
        return _row_to_record(row).to_dict()

    def list_jobs(self, character_id: str | None = None) -> list[dict]:
        with self._conn() as conn:
            if character_id:
                rows = conn.execute(
                    "SELECT * FROM visual_training_jobs WHERE character_id = ? ORDER BY created_at DESC",
                    (character_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM visual_training_jobs ORDER BY created_at DESC"
                ).fetchall()
        return [_row_to_record(r).to_dict() for r in rows]

    # ── Mutations ───────────────────────────────────────────────────────────────

    async def start_training(
        self,
        character_id: str,
        dataset_ids: list[str],
        mode: VisualTrainingMode = "standard",
        base_checkpoint: str = DEFAULT_CHECKPOINT,
        trigger_word: str | None = None,
    ) -> dict:
        from app.services.gpu_mutex import check_gpu_exclusive, EngineGpuMutexError

        # Validate character
        with self._conn() as conn:
            row = conn.execute("SELECT id, name FROM characters WHERE id = ?", (character_id,)).fetchone()
            if not row:
                raise VisualTrainingCharacterNotFoundError(f"角色 {character_id} 不存在")

            # Validate datasets
            if not dataset_ids:
                raise VisualTrainingValidationError("请至少选择一个图片数据集")
            for did in dataset_ids:
                ds_row = conn.execute(
                    "SELECT id, image_count FROM visual_datasets WHERE id = ? AND character_id = ?",
                    (did, character_id),
                ).fetchone()
                if not ds_row:
                    raise VisualTrainingValidationError(f"数据集 {did} 不存在或不属于该角色")
                if int(ds_row["image_count"]) < 3:
                    raise VisualTrainingValidationError(
                        "图片数量不足，至少需要 3 张参考图才能开始训练"
                    )

        # VRAM warning for fine mode
        if mode == "fine":
            raise VisualTrainingValidationError(
                "精细模式需要 12GB 显存，当前默认配置不支持，请选择标准或轻量模式"
            )

        # GPU mutex check
        try:
            check_gpu_exclusive(self._queue)
        except EngineGpuMutexError as exc:
            raise VisualTrainingGPUBusyError(str(exc)) from exc

        # Auto trigger word
        if not trigger_word:
            with self._conn() as conn:
                name_row = conn.execute(
                    "SELECT name FROM characters WHERE id = ?", (character_id,)
                ).fetchone()
            char_name = name_row["name"].lower().replace(" ", "_") if name_row else "character"
            trigger_word = f"{char_name}_v1"

        job_id = str(uuid4())
        now = _utc_now()
        preset = MODE_PRESETS[mode]
        total_steps = preset["steps"]

        with self._conn() as conn:
            conn.execute(
                """INSERT INTO visual_training_jobs
                   (id, character_id, dataset_ids_json, mode, base_checkpoint, trigger_word,
                    status, progress, current_step, total_steps, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, 'queued', 0.0, 0, ?, ?)""",
                (
                    job_id, character_id, json.dumps(dataset_ids),
                    mode, base_checkpoint, trigger_word, total_steps, now,
                ),
            )
            conn.commit()

        # Enqueue async task
        try:
            snapshot = await self._queue.submit(
                name=f"visual-training-{character_id}",
                runner=self._build_runner(job_id),
                category="gpu_exclusive",
                task_id=job_id,
                initial_progress=0,
                initial_message="视觉训练任务已进入队列",
            )
        except RuntimeError:
            with self._conn() as conn:
                conn.execute(
                    """UPDATE visual_training_jobs
                       SET status = 'failed', error_message = ?, completed_at = ?
                       WHERE id = ?""",
                    ("训练任务入队失败，请稍后重试", _utc_now(), job_id),
                )
                conn.commit()
            raise VisualTrainingError("训练任务入队失败，请稍后重试")

        with self._conn() as conn:
            conn.execute(
                "UPDATE visual_training_jobs SET queue_task_id = ? WHERE id = ?",
                (snapshot.id, job_id),
            )
            conn.commit()

        return self.get_job(job_id)

    def cancel_job(self, job_id: str) -> dict:
        job = self.get_job(job_id)  # raises if not found
        if job["status"] in ("completed", "failed", "canceled"):
            raise VisualTrainingValidationError("该任务已结束，无法取消")

        if job["queueTaskId"]:
            self._queue.cancel(job["queueTaskId"])

        with self._conn() as conn:
            conn.execute(
                "UPDATE visual_training_jobs SET status = 'canceled' WHERE id = ?",
                (job_id,),
            )
            conn.commit()

        return self.get_job(job_id)

    # ── Executor (placeholder) ──────────────────────────────────────────────────

    def _build_runner(self, job_id: str):
        """Build the async task runner for this job.

        Placeholder: marks the job as failed with a clear message that
        AI-Toolkit is not yet wired in.  Real implementation will call
        AI-Toolkit as a subprocess with a generated YAML config.
        """
        async def runner(progress_reporter) -> None:
            with self._conn() as conn:
                conn.execute(
                    """UPDATE visual_training_jobs
                       SET status = 'preparing', started_at = ?
                       WHERE id = ?""",
                    (_utc_now(), job_id),
                )
                conn.commit()

            await progress_reporter(2, "正在准备训练环境…")

            with self._conn() as conn:
                conn.execute(
                    """UPDATE visual_training_jobs
                       SET status = 'failed', error_message = ?, completed_at = ?
                       WHERE id = ?""",
                    (UNAVAILABLE_EXECUTOR_MSG, _utc_now(), job_id),
                )
                conn.commit()

            raise RuntimeError(UNAVAILABLE_EXECUTOR_MSG)

        return runner


def create_visual_training_service(db_path: Path, queue: TaskQueue) -> VisualTrainingService:
    return VisualTrainingService(db_path=db_path, queue=queue)
