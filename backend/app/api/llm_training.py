from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.services.llm_training import (
    LLMTrainingCharacterNotFoundError,
    LLMTrainingError,
    LLMTrainingGPUBusyError,
    LLMTrainingNotFoundError,
    LLMTrainingValidationError,
    LLMTrainingMode,
)

router = APIRouter(tags=["llm-training"])


# ── Request / response models ──────────────────────────────────────────────────

class StartTrainingRequest(BaseModel):
    datasetIds: list[str] = Field(min_length=1)
    mode: LLMTrainingMode = "standard"
    baseModel: str = "qwen2.5:7b-instruct-q4_K_M"


class LLMTrainingJobPayload(BaseModel):
    id: str
    characterId: str
    datasetIds: list[str]
    mode: str
    baseModel: str
    status: str
    progress: float
    currentStep: int
    totalSteps: int
    loss: float | None
    etaSeconds: int | None
    adapterPath: str | None
    ggufPath: str | None
    errorMessage: str | None
    queueTaskId: str | None
    createdAt: str
    startedAt: str | None
    completedAt: str | None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _resolve_training_service(request: Request):
    svc = getattr(request.app.state, "llm_training_service", None)
    if svc is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="服务初始化失败，请稍后重试",
        )
    return svc


def _to_payload(d: dict) -> LLMTrainingJobPayload:
    return LLMTrainingJobPayload(**d)


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post(
    "/characters/{character_id}/llm-training/start",
    response_model=LLMTrainingJobPayload,
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_llm_training(
    character_id: str,
    body: StartTrainingRequest,
    request: Request,
) -> LLMTrainingJobPayload:
    """Validate and enqueue an LLM fine-tuning job."""
    svc = _resolve_training_service(request)
    try:
        job = await svc.start_training(
            character_id=character_id,
            dataset_ids=body.datasetIds,
            mode=body.mode,
            base_model=body.baseModel,
        )
    except LLMTrainingCharacterNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except LLMTrainingValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LLMTrainingGPUBusyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except LLMTrainingError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    return _to_payload(job)


@router.post(
    "/llm-training/{job_id}/cancel",
    response_model=LLMTrainingJobPayload,
)
def cancel_llm_training(job_id: str, request: Request) -> LLMTrainingJobPayload:
    """Cancel a queued or running training job."""
    svc = _resolve_training_service(request)
    try:
        job = svc.cancel_job(job_id)
    except LLMTrainingNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except LLMTrainingValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _to_payload(job)


@router.get(
    "/llm-training/{job_id}",
    response_model=LLMTrainingJobPayload,
)
def get_llm_training_job(job_id: str, request: Request) -> LLMTrainingJobPayload:
    """Get a single training job by ID."""
    svc = _resolve_training_service(request)
    try:
        job = svc.get_job(job_id)
    except LLMTrainingNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _to_payload(job)


@router.get(
    "/llm-training",
    response_model=list[LLMTrainingJobPayload],
)
def list_llm_training_jobs(
    request: Request,
    characterId: str | None = None,
) -> list[LLMTrainingJobPayload]:
    """List training jobs, optionally filtered by characterId."""
    svc = _resolve_training_service(request)
    jobs = svc.list_jobs(character_id=characterId)
    return [_to_payload(j) for j in jobs]
