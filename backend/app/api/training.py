from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field

from app.services.training import (
    TrainingCharacterNotFoundError,
    TrainingJobNotFoundError,
    TrainingService,
    TrainingServiceError,
    TrainingStartPayload,
    TrainingValidationError,
)

router = APIRouter()


class TrainingPrecheckPayload(BaseModel):
    vramGB: float = Field(ge=0)
    source: str
    result: str


class TrainingDowngradeReasonPayload(BaseModel):
    code: str
    message: str


class TrainingJobPayload(BaseModel):
    id: str
    characterId: str
    queueTaskId: str
    requestedMode: Literal["light", "standard", "fine"]
    effectiveMode: Literal["light", "standard", "fine"]
    requestedModel: Literal["flux-schnell", "flux-dev", "sdxl"]
    effectiveModel: Literal["flux-schnell", "flux-dev", "sdxl"]
    strategyDefaultModel: str
    runtimeDefaultModel: str
    requestedSteps: int = Field(ge=1)
    effectiveSteps: int = Field(ge=1)
    requestedRank: int = Field(ge=1)
    effectiveRank: int = Field(ge=1)
    precheck: TrainingPrecheckPayload
    downgradeReasons: list[TrainingDowngradeReasonPayload]
    config: dict[str, Any]
    businessStatus: Literal[
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
    queueStatus: Literal["pending", "running", "completed", "failed"]
    progress: int = Field(ge=0, le=100)
    currentStage: str
    latestMessage: str | None = None
    latestError: str | None = None
    userVisibleError: str | None = None
    samplePreviews: list[dict[str, Any]]
    validationImages: list[dict[str, Any]]
    retrainOfTaskId: str | None = None
    createdAt: str
    updatedAt: str
    startedAt: str | None = None
    finishedAt: str | None = None


class TrainingStartRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    character_id: str = Field(alias="characterId", min_length=1)
    mode: Literal["light", "standard", "fine"]
    base_model: Literal["flux-schnell", "flux-dev", "sdxl"] | None = Field(
        default=None,
        alias="baseModel",
    )
    confirm_flux_dev_license: bool = Field(default=False, alias="confirmFluxDevLicense")
    retrain_of_task_id: str | None = Field(default=None, alias="retrainOfTaskId")
    retrain_step_delta: int | None = Field(default=None, alias="retrainStepDelta")


@dataclass(slots=True)
class TrainingRuntime:
    service: TrainingService


def resolve_training_runtime(request: Request) -> TrainingRuntime:
    service = getattr(request.app.state, "training_service", None)
    if not isinstance(service, TrainingService):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="训练服务暂不可用，请稍后重试。",
        )
    return TrainingRuntime(service=service)


@router.post(
    "/training/start",
    response_model=TrainingJobPayload,
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_training(payload: TrainingStartRequest, request: Request) -> dict[str, Any]:
    runtime = resolve_training_runtime(request)
    try:
        return await runtime.service.start_training(
            TrainingStartPayload(
                character_id=payload.character_id,
                mode=payload.mode,
                base_model=payload.base_model,
                confirm_flux_dev_license=payload.confirm_flux_dev_license,
                retrain_of_task_id=payload.retrain_of_task_id,
                retrain_step_delta=payload.retrain_step_delta,
            )
        )
    except TrainingCharacterNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except TrainingValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except TrainingServiceError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.get("/training/tasks", response_model=list[TrainingJobPayload])
def list_training_tasks(
    request: Request,
    character_id: str | None = Query(default=None, alias="characterId"),
) -> list[dict[str, Any]]:
    runtime = resolve_training_runtime(request)
    return runtime.service.list_training_jobs(character_id=character_id)


@router.get("/training/tasks/{task_id}", response_model=TrainingJobPayload)
def get_training_task(task_id: str, request: Request) -> dict[str, Any]:
    runtime = resolve_training_runtime(request)
    try:
        return runtime.service.get_training_job(task_id)
    except TrainingJobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
