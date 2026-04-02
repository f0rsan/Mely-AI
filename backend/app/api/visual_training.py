"""Visual LoRA training API — AI-Toolkit pipeline."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.services.visual_training_service import (
    VisualTrainingCharacterNotFoundError,
    VisualTrainingError,
    VisualTrainingGPUBusyError,
    VisualTrainingMode,
    VisualTrainingNotFoundError,
    VisualTrainingValidationError,
)

router = APIRouter(tags=["visual-training"])


# ── Request / response models ──────────────────────────────────────────────────

class StartVisualTrainingRequest(BaseModel):
    datasetIds: list[str] = Field(min_length=1)
    mode: VisualTrainingMode = "standard"
    baseCheckpoint: str = "flux-dev-q4"
    triggerWord: str | None = None


class VisualTrainingJobPayload(BaseModel):
    id: str
    characterId: str
    datasetIds: list[str]
    mode: str
    baseCheckpoint: str
    triggerWord: str
    status: str
    progress: float
    currentStep: int
    totalSteps: int
    etaSeconds: int | None
    loraPath: str | None
    sampleImages: list[str]
    errorMessage: str | None
    queueTaskId: str | None
    createdAt: str
    startedAt: str | None
    completedAt: str | None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _resolve_service(request: Request):
    svc = getattr(request.app.state, "visual_training_service", None)
    if svc is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="服务初始化失败，请稍后重试",
        )
    return svc


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post(
    "/characters/{character_id}/visual-training/start",
    response_model=VisualTrainingJobPayload,
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_visual_training(
    character_id: str,
    body: StartVisualTrainingRequest,
    request: Request,
) -> VisualTrainingJobPayload:
    svc = _resolve_service(request)
    try:
        job = await svc.start_training(
            character_id=character_id,
            dataset_ids=body.datasetIds,
            mode=body.mode,
            base_checkpoint=body.baseCheckpoint,
            trigger_word=body.triggerWord,
        )
    except VisualTrainingCharacterNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except VisualTrainingValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except VisualTrainingGPUBusyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except VisualTrainingError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    return VisualTrainingJobPayload(**job)


@router.post(
    "/visual-training/{job_id}/cancel",
    response_model=VisualTrainingJobPayload,
)
def cancel_visual_training(job_id: str, request: Request) -> VisualTrainingJobPayload:
    svc = _resolve_service(request)
    try:
        job = svc.cancel_job(job_id)
    except VisualTrainingNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except VisualTrainingValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return VisualTrainingJobPayload(**job)


@router.get(
    "/visual-training/{job_id}",
    response_model=VisualTrainingJobPayload,
)
def get_visual_training_job(job_id: str, request: Request) -> VisualTrainingJobPayload:
    svc = _resolve_service(request)
    try:
        job = svc.get_job(job_id)
    except VisualTrainingNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return VisualTrainingJobPayload(**job)


@router.get(
    "/visual-training",
    response_model=list[VisualTrainingJobPayload],
)
def list_visual_training_jobs(
    request: Request,
    characterId: str | None = None,
) -> list[VisualTrainingJobPayload]:
    svc = _resolve_service(request)
    jobs = svc.list_jobs(character_id=characterId)
    return [VisualTrainingJobPayload(**j) for j in jobs]
