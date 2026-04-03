from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from app.db.connection import connect_database
from app.services.characters import upsert_visual_training_state
from app.services.task_queue import TaskQueue

TrainingMode = Literal["light", "standard", "fine"]
TrainingModel = Literal["flux-schnell", "flux-dev", "sdxl"]
TrainingBusinessStatus = Literal[
    "draft",
    "queued",
    "preparing",
    "training",
    "sampling",
    "validating",
    "completed",
    "failed",
    "canceled",
]


STRATEGY_DEFAULT_MODEL: TrainingModel = "flux-schnell"
RUNTIME_DEFAULT_MODEL_ON_8GB: TrainingModel = "sdxl"
FLUX_MODELS = {"flux-schnell", "flux-dev"}
SCHNELL_TRAINING_ADAPTER = "ostris/FLUX.1-schnell-training-adapter"
UNAVAILABLE_EXECUTOR_ERROR = "训练任务已通过预检并入队，但当前环境未接入真实训练执行器。"

MODE_PRESETS: dict[TrainingMode, dict[str, int]] = {
    "light": {"steps": 900, "rank": 8},
    "standard": {"steps": 1800, "rank": 16},
    "fine": {"steps": 2800, "rank": 32},
}
_UNSET = object()


class TrainingServiceError(Exception):
    """Base training service error."""


class TrainingValidationError(TrainingServiceError):
    """Raised when training request is invalid."""


class TrainingJobNotFoundError(TrainingServiceError):
    """Raised when training task id does not exist."""


class TrainingCharacterNotFoundError(TrainingServiceError):
    """Raised when character id does not exist."""


@dataclass(slots=True)
class TrainingStartPayload:
    character_id: str
    mode: TrainingMode
    base_model: TrainingModel | None = None
    confirm_flux_dev_license: bool = False
    retrain_of_task_id: str | None = None
    retrain_step_delta: int | None = None


@dataclass(slots=True)
class GpuPrecheck:
    vram_gb: float
    source: str
    result: str


@dataclass(slots=True)
class TrainingJobRecord:
    id: str
    character_id: str
    queue_task_id: str
    requested_mode: TrainingMode
    effective_mode: TrainingMode
    requested_model: TrainingModel
    effective_model: TrainingModel
    strategy_default_model: TrainingModel
    runtime_default_model: TrainingModel
    requested_steps: int
    effective_steps: int
    requested_rank: int
    effective_rank: int
    vram_gb: float
    vram_source: str
    precheck_result: str
    downgrade_reasons: list[dict[str, str]]
    config: dict[str, Any]
    business_status: TrainingBusinessStatus
    queue_status: str
    progress: int
    current_stage: str
    latest_message: str | None
    latest_error: str | None
    user_visible_error: str | None
    sample_previews: list[dict[str, Any]]
    validation_images: list[dict[str, Any]]
    retrain_of_task_id: str | None
    created_at: str
    updated_at: str
    started_at: str | None
    finished_at: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "characterId": self.character_id,
            "queueTaskId": self.queue_task_id,
            "requestedMode": self.requested_mode,
            "effectiveMode": self.effective_mode,
            "requestedModel": self.requested_model,
            "effectiveModel": self.effective_model,
            "strategyDefaultModel": self.strategy_default_model,
            "runtimeDefaultModel": self.runtime_default_model,
            "requestedSteps": self.requested_steps,
            "effectiveSteps": self.effective_steps,
            "requestedRank": self.requested_rank,
            "effectiveRank": self.effective_rank,
            "precheck": {
                "vramGB": self.vram_gb,
                "source": self.vram_source,
                "result": self.precheck_result,
            },
            "downgradeReasons": self.downgrade_reasons,
            "config": self.config,
            "businessStatus": self.business_status,
            "queueStatus": self.queue_status,
            "progress": self.progress,
            "currentStage": self.current_stage,
            "latestMessage": self.latest_message,
            "latestError": self.latest_error,
            "userVisibleError": self.user_visible_error,
            "samplePreviews": self.sample_previews,
            "validationImages": self.validation_images,
            "retrainOfTaskId": self.retrain_of_task_id,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "startedAt": self.started_at,
            "finishedAt": self.finished_at,
        }


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _dumps_json(value: object | None) -> str:
    return json.dumps(value, ensure_ascii=False)


def _loads_json(value: str | None) -> Any:
    if value is None:
        return None
    return json.loads(value)


def _queue_to_business_status(queue_status: str) -> TrainingBusinessStatus:
    if queue_status == "pending":
        return "queued"
    if queue_status == "running":
        return "preparing"
    if queue_status == "completed":
        return "completed"
    if queue_status == "failed":
        return "failed"
    return "queued"


class TrainingService:
    def __init__(self, *, db_path: Path, queue: TaskQueue) -> None:
        self._db_path = db_path
        self._queue = queue

    @contextmanager
    def _open_connection(self):
        with connect_database(self._db_path) as connection:
            connection.row_factory = sqlite3.Row
            yield connection

    @staticmethod
    def _to_record(row: sqlite3.Row) -> TrainingJobRecord:
        return TrainingJobRecord(
            id=row["id"],
            character_id=row["character_id"],
            queue_task_id=row["queue_task_id"],
            requested_mode=row["requested_mode"],
            effective_mode=row["effective_mode"],
            requested_model=row["requested_model"],
            effective_model=row["effective_model"],
            strategy_default_model=row["strategy_default_model"],
            runtime_default_model=row["runtime_default_model"],
            requested_steps=row["requested_steps"],
            effective_steps=row["effective_steps"],
            requested_rank=row["requested_rank"],
            effective_rank=row["effective_rank"],
            vram_gb=row["vram_gb"],
            vram_source=row["vram_source"],
            precheck_result=row["precheck_result"],
            downgrade_reasons=_loads_json(row["downgrade_reasons"]) or [],
            config=_loads_json(row["config_json"]) or {},
            business_status=row["business_status"],
            queue_status=row["queue_status"],
            progress=row["progress"],
            current_stage=row["current_stage"],
            latest_message=row["latest_message"],
            latest_error=row["latest_error"],
            user_visible_error=row["user_visible_error"],
            sample_previews=_loads_json(row["sample_previews"]) or [],
            validation_images=_loads_json(row["validation_images"]) or [],
            retrain_of_task_id=row["retrain_of_task_id"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            started_at=row["started_at"],
            finished_at=row["finished_at"],
        )

    def _detect_gpu_precheck(self) -> GpuPrecheck:
        from_env = os.getenv("MELY_GPU_VRAM_GB")
        if from_env is not None:
            try:
                parsed = float(from_env)
                if parsed > 0:
                    return GpuPrecheck(vram_gb=parsed, source="env", result="ok")
            except ValueError:
                pass

        try:
            import torch  # type: ignore

            if torch.cuda.is_available():
                properties = torch.cuda.get_device_properties(0)
                vram_gb = round(properties.total_memory / (1024**3), 2)
                return GpuPrecheck(vram_gb=vram_gb, source="torch-cuda", result="ok")
        except Exception:
            pass

        return GpuPrecheck(vram_gb=8.0, source="fallback", result="conservative_default")

    def _resolve_effective_runtime(
        self,
        *,
        requested_mode: TrainingMode,
        requested_model: TrainingModel,
        precheck: GpuPrecheck,
    ) -> tuple[TrainingMode, TrainingModel, list[dict[str, str]]]:
        effective_mode = requested_mode
        effective_model = requested_model
        downgrade_reasons: list[dict[str, str]] = []

        if requested_model in FLUX_MODELS and precheck.vram_gb < 24:
            effective_model = RUNTIME_DEFAULT_MODEL_ON_8GB
            downgrade_reasons.append(
                {
                    "code": "flux_vram_guard",
                    "message": "当前显存不足以稳定运行 FLUX 训练，已自动切换到兼容模式（SDXL）。",
                }
            )

        if requested_mode == "fine" and precheck.vram_gb < 12:
            effective_mode = "standard"
            downgrade_reasons.append(
                {
                    "code": "mode_vram_guard",
                    "message": "显存不足，精细模式需要更高显存。已为你切换到标准模式。",
                }
            )

        return effective_mode, effective_model, downgrade_reasons

    def _build_training_config(
        self,
        *,
        requested_mode: TrainingMode,
        effective_mode: TrainingMode,
        requested_model: TrainingModel,
        effective_model: TrainingModel,
        requested_steps: int,
        effective_steps: int,
        retrain_step_delta: int | None,
    ) -> dict[str, Any]:
        requested_preset = MODE_PRESETS[requested_mode]
        effective_preset = MODE_PRESETS[effective_mode]

        config: dict[str, Any] = {
            "defaults": {
                "strategyModel": STRATEGY_DEFAULT_MODEL,
                "runtimeModelOn8GB": RUNTIME_DEFAULT_MODEL_ON_8GB,
            },
            "requested": {
                "mode": requested_mode,
                "model": requested_model,
                "steps": requested_steps,
                "rank": requested_preset["rank"],
            },
            "effective": {
                "mode": effective_mode,
                "model": effective_model,
                "steps": effective_steps,
                "rank": effective_preset["rank"],
            },
            "samplingProgressMarks": [20, 40, 60, 80, 100],
            "validationViews": ["front", "three_quarter", "back", "close_up"],
            "executor": {
                "type": "placeholder",
                "entrypoint": "training_executor_v1",
                "ready": False,
            },
        }

        if effective_model == "flux-schnell":
            config["effective"]["assistantLoraPath"] = SCHNELL_TRAINING_ADAPTER

        if requested_model == "flux-dev":
            config["requested"]["license"] = "flux-1-dev-non-commercial-license"

        if retrain_step_delta is not None:
            config["retrain"] = {"stepDelta": retrain_step_delta}

        return config

    def _get_job_row(self, connection: sqlite3.Connection, task_id: str) -> sqlite3.Row:
        row = connection.execute(
            "SELECT * FROM training_jobs WHERE id = ?",
            (task_id,),
        ).fetchone()
        if row is None:
            raise TrainingJobNotFoundError("训练任务不存在。")
        return row

    def _update_job(
        self,
        connection: sqlite3.Connection,
        task_id: str,
        *,
        queue_status: str | None = None,
        business_status: TrainingBusinessStatus | None = None,
        progress: int | None = None,
        current_stage: str | None = None,
        latest_message: str | None | object = _UNSET,
        latest_error: str | None | object = _UNSET,
        user_visible_error: str | None | object = _UNSET,
        started_at: str | None | object = _UNSET,
        finished_at: str | None | object = _UNSET,
    ) -> None:
        fields: list[str] = ["updated_at = ?"]
        values: list[object] = [utc_now_iso()]

        if queue_status is not None:
            fields.append("queue_status = ?")
            values.append(queue_status)
        if business_status is not None:
            fields.append("business_status = ?")
            values.append(business_status)
        if progress is not None:
            fields.append("progress = ?")
            values.append(progress)
        if current_stage is not None:
            fields.append("current_stage = ?")
            values.append(current_stage)
        if latest_message is not _UNSET:
            fields.append("latest_message = ?")
            values.append(latest_message)
        if latest_error is not _UNSET:
            fields.append("latest_error = ?")
            values.append(latest_error)
        if user_visible_error is not _UNSET:
            fields.append("user_visible_error = ?")
            values.append(user_visible_error)
        if started_at is not _UNSET:
            fields.append("started_at = ?")
            values.append(started_at)
        if finished_at is not _UNSET:
            fields.append("finished_at = ?")
            values.append(finished_at)

        values.append(task_id)
        connection.execute(
            f"UPDATE training_jobs SET {', '.join(fields)} WHERE id = ?",
            tuple(values),
        )

    def _sync_visual_state_from_job(self, connection: sqlite3.Connection, task_id: str) -> None:
        row = self._get_job_row(connection, task_id)
        upsert_visual_training_state(
            connection,
            row["character_id"],
            training_status=row["business_status"],
            training_progress=float(row["progress"]),
            training_config=_loads_json(row["config_json"]),
        )

    async def start_training(self, payload: TrainingStartPayload) -> dict[str, Any]:
        requested_model = payload.base_model or STRATEGY_DEFAULT_MODEL
        if requested_model not in {"flux-schnell", "flux-dev", "sdxl"}:
            raise TrainingValidationError("不支持的基础模型，请重新选择。")

        if requested_model == "flux-dev" and not payload.confirm_flux_dev_license:
            raise TrainingValidationError("flux-dev 存在非商用许可风险，继续前请先确认许可。")

        if payload.retrain_step_delta is not None and payload.retrain_step_delta <= 0:
            raise TrainingValidationError("重训步数增量必须是大于 0 的整数。")

        if payload.retrain_step_delta is not None and payload.retrain_of_task_id is None:
            raise TrainingValidationError("仅在重训任务中允许设置重训步数增量，请提供重训来源任务。")

        precheck = self._detect_gpu_precheck()
        effective_mode, effective_model, downgrade_reasons = self._resolve_effective_runtime(
            requested_mode=payload.mode,
            requested_model=requested_model,
            precheck=precheck,
        )

        requested_preset = MODE_PRESETS[payload.mode]
        effective_preset = MODE_PRESETS[effective_mode]
        step_delta = payload.retrain_step_delta or 0
        requested_steps = requested_preset["steps"] + step_delta
        effective_steps = effective_preset["steps"] + step_delta
        config = self._build_training_config(
            requested_mode=payload.mode,
            effective_mode=effective_mode,
            requested_model=requested_model,
            effective_model=effective_model,
            requested_steps=requested_steps,
            effective_steps=effective_steps,
            retrain_step_delta=payload.retrain_step_delta,
        )

        task_id = uuid4().hex
        now = utc_now_iso()

        with self._open_connection() as connection:
            exists = connection.execute(
                "SELECT id FROM characters WHERE id = ?",
                (payload.character_id,),
            ).fetchone()
            if exists is None:
                raise TrainingCharacterNotFoundError("角色不存在")

            if payload.retrain_of_task_id is not None:
                retrain_source = connection.execute(
                    "SELECT id, requested_mode FROM training_jobs WHERE id = ?",
                    (payload.retrain_of_task_id,),
                ).fetchone()
                if retrain_source is None:
                    raise TrainingValidationError("重训来源任务不存在，请先确认任务编号。")
                if (
                    payload.retrain_step_delta is not None
                    and retrain_source["requested_mode"] != payload.mode
                ):
                    raise TrainingValidationError("增加步数重训时，训练模式必须与来源任务一致。")

            connection.execute(
                """
                INSERT INTO training_jobs (
                    id,
                    character_id,
                    queue_task_id,
                    requested_mode,
                    effective_mode,
                    requested_model,
                    effective_model,
                    strategy_default_model,
                    runtime_default_model,
                    requested_steps,
                    effective_steps,
                    requested_rank,
                    effective_rank,
                    vram_gb,
                    vram_source,
                    precheck_result,
                    downgrade_reasons,
                    config_json,
                    business_status,
                    queue_status,
                    progress,
                    current_stage,
                    latest_message,
                    latest_error,
                    user_visible_error,
                    sample_previews,
                    validation_images,
                    retrain_of_task_id,
                    created_at,
                    updated_at,
                    started_at,
                    finished_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    task_id,
                    payload.character_id,
                    task_id,
                    payload.mode,
                    effective_mode,
                    requested_model,
                    effective_model,
                    STRATEGY_DEFAULT_MODEL,
                    RUNTIME_DEFAULT_MODEL_ON_8GB,
                    requested_steps,
                    effective_steps,
                    requested_preset["rank"],
                    effective_preset["rank"],
                    precheck.vram_gb,
                    precheck.source,
                    precheck.result,
                    _dumps_json(downgrade_reasons),
                    _dumps_json(config),
                    "queued",
                    "pending",
                    0,
                    "queued",
                    "训练任务已进入队列",
                    None,
                    None,
                    "[]",
                    "[]",
                    payload.retrain_of_task_id,
                    now,
                    now,
                    None,
                    None,
                ),
            )
            self._sync_visual_state_from_job(connection, task_id)
            connection.commit()

        try:
            snapshot = await self._queue.submit(
                name=f"training-{payload.character_id}",
                runner=self._build_placeholder_runner(task_id),
                category="gpu_exclusive",
                task_id=task_id,
                initial_progress=0,
                initial_message="训练任务已进入队列",
            )
        except RuntimeError as exc:
            with self._open_connection() as connection:
                self._update_job(
                    connection,
                    task_id,
                    queue_status="failed",
                    business_status="failed",
                    current_stage="failed",
                    latest_error="训练任务入队失败，请稍后重试。",
                    user_visible_error="训练任务入队失败，请稍后重试。",
                    finished_at=utc_now_iso(),
                )
                self._sync_visual_state_from_job(connection, task_id)
                connection.commit()
            raise TrainingServiceError("训练任务入队失败，请稍后重试。") from exc

        with self._open_connection() as connection:
            mapped_business = _queue_to_business_status(snapshot.status)
            self._update_job(
                connection,
                task_id,
                queue_status=snapshot.status,
                business_status=mapped_business,
                progress=snapshot.progress,
                current_stage=mapped_business,
                latest_message=snapshot.message,
                latest_error=snapshot.error,
            )
            self._sync_visual_state_from_job(connection, task_id)
            connection.commit()

        return self.get_training_job(task_id)

    def _build_placeholder_runner(self, task_id: str):
        async def runner(progress_reporter) -> None:
            preparing_started_at = utc_now_iso()
            with self._open_connection() as connection:
                self._update_job(
                    connection,
                    task_id,
                    queue_status="running",
                    business_status="preparing",
                    progress=5,
                    current_stage="preparing",
                    latest_message="训练任务准备中",
                    started_at=preparing_started_at,
                )
                self._sync_visual_state_from_job(connection, task_id)
                connection.commit()

            await progress_reporter(5, "训练任务准备中")

            with self._open_connection() as connection:
                self._update_job(
                    connection,
                    task_id,
                    queue_status="failed",
                    business_status="failed",
                    progress=5,
                    current_stage="failed",
                    latest_message=None,
                    latest_error=UNAVAILABLE_EXECUTOR_ERROR,
                    user_visible_error=UNAVAILABLE_EXECUTOR_ERROR,
                    finished_at=utc_now_iso(),
                )
                self._sync_visual_state_from_job(connection, task_id)
                connection.commit()

            raise RuntimeError(UNAVAILABLE_EXECUTOR_ERROR)

        return runner

    def get_training_job(self, task_id: str) -> dict[str, Any]:
        with self._open_connection() as connection:
            row = connection.execute(
                "SELECT * FROM training_jobs WHERE id = ?",
                (task_id,),
            ).fetchone()
            if row is None:
                raise TrainingJobNotFoundError("训练任务不存在。")
            return self._to_record(row).to_dict()

    def list_training_jobs(self, *, character_id: str | None = None) -> list[dict[str, Any]]:
        query = "SELECT * FROM training_jobs"
        params: tuple[object, ...] = ()
        if character_id is not None:
            query += " WHERE character_id = ?"
            params = (character_id,)
        query += " ORDER BY created_at DESC, id DESC"

        with self._open_connection() as connection:
            rows = connection.execute(query, params).fetchall()
            return [self._to_record(row).to_dict() for row in rows]


def create_training_service(*, db_path: Path, queue: TaskQueue) -> TrainingService:
    return TrainingService(db_path=db_path, queue=queue)
