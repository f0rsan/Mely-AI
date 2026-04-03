from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.services.llm_model_service import (
    LLMModelCharacterNotFoundError,
    LLMModelError,
    LLMModelNotFoundError,
    LLMModelValidationError,
)

router = APIRouter(tags=["llm-models"])


# ── Request / response models ──────────────────────────────────────────────────

class RegisterModelRequest(BaseModel):
    ggufPath: str = Field(min_length=1)
    baseModel: str = "qwen2.5:7b-instruct-q4_K_M"
    trainingJobId: str | None = None
    systemPrompt: str | None = None
    datasetItemCount: int = 0
    lossFinal: float | None = None


class LLMModelPayload(BaseModel):
    id: str
    characterId: str
    version: int
    trainingJobId: str | None
    baseModel: str
    ollamaModelName: str
    ggufPath: str
    systemPrompt: str | None
    datasetItemCount: int
    lossFinal: float | None
    status: str
    createdAt: str


# ── Helpers ────────────────────────────────────────────────────────────────────

def _resolve_model_service(request: Request):
    svc = getattr(request.app.state, "llm_model_service", None)
    if svc is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="服务初始化失败，请稍后重试",
        )
    return svc


def _to_payload(d: dict) -> LLMModelPayload:
    return LLMModelPayload(**d)


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post(
    "/characters/{character_id}/llm-models",
    response_model=LLMModelPayload,
    status_code=status.HTTP_201_CREATED,
)
async def register_llm_model(
    character_id: str,
    body: RegisterModelRequest,
    request: Request,
) -> LLMModelPayload:
    """Register a fine-tuned GGUF model for a character into Ollama."""
    svc = _resolve_model_service(request)
    try:
        model = await svc.register_model(
            character_id=character_id,
            gguf_path=body.ggufPath,
            base_model=body.baseModel,
            training_job_id=body.trainingJobId,
            system_prompt=body.systemPrompt,
            dataset_item_count=body.datasetItemCount,
            loss_final=body.lossFinal,
        )
    except LLMModelCharacterNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except LLMModelValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LLMModelError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    return _to_payload(model)


@router.get(
    "/characters/{character_id}/llm-models",
    response_model=list[LLMModelPayload],
)
def list_character_llm_models(
    character_id: str,
    request: Request,
) -> list[LLMModelPayload]:
    """List all private LLM models for a character."""
    svc = _resolve_model_service(request)
    models = svc.list_models(character_id)
    return [_to_payload(m) for m in models]


@router.get(
    "/llm-models/{model_id}",
    response_model=LLMModelPayload,
)
def get_llm_model(model_id: str, request: Request) -> LLMModelPayload:
    """Get a single LLM model record."""
    svc = _resolve_model_service(request)
    try:
        model = svc.get_model(model_id)
    except LLMModelNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _to_payload(model)


@router.post(
    "/llm-models/{model_id}/retry-registration",
    response_model=LLMModelPayload,
)
async def retry_llm_model_registration(
    model_id: str,
    request: Request,
) -> LLMModelPayload:
    """Re-attempt Ollama registration for a pending/failed model."""
    svc = _resolve_model_service(request)
    try:
        model = await svc.retry_registration(model_id)
    except LLMModelNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except LLMModelValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LLMModelError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    return _to_payload(model)


@router.delete(
    "/llm-models/{model_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_llm_model(model_id: str, request: Request) -> None:
    """Delete a private model from the DB and Ollama."""
    svc = _resolve_model_service(request)
    try:
        await svc.delete_model(model_id)
    except LLMModelNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
