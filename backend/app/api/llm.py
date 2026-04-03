from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from app.services.ollama_service import (
    OllamaAPIError,
    OllamaModelNotFoundError,
    OllamaNotRunningError,
    OllamaModelInfo,
    OllamaStatus,
    check_ollama_status,
    delete_model,
)

router = APIRouter(prefix="/llm", tags=["llm"])


# ── Response models ────────────────────────────────────────────────────────────

class LLMModelInfoPayload(BaseModel):
    name: str
    sizeBytes: int
    modifiedAt: str
    digest: str


class LLMHealthPayload(BaseModel):
    running: bool
    version: str | None
    models: list[LLMModelInfoPayload]
    hint: str | None = None


class DeleteModelRequest(BaseModel):
    name: str


# ── Helpers ────────────────────────────────────────────────────────────────────

def _model_to_payload(m: OllamaModelInfo) -> LLMModelInfoPayload:
    return LLMModelInfoPayload(
        name=m.name,
        sizeBytes=m.size_bytes,
        modifiedAt=m.modified_at,
        digest=m.digest,
    )


def _status_to_payload(s: OllamaStatus) -> LLMHealthPayload:
    hint = None
    if not s.running:
        hint = "Ollama 未运行，请访问 https://ollama.com 安装并启动 Ollama"
    return LLMHealthPayload(
        running=s.running,
        version=s.version,
        models=[_model_to_payload(m) for m in s.models],
        hint=hint,
    )


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/health", response_model=LLMHealthPayload)
async def get_llm_health(_request: Request) -> LLMHealthPayload:
    """Check Ollama status and list available models."""
    s = await check_ollama_status()
    return _status_to_payload(s)


@router.get("/models", response_model=list[LLMModelInfoPayload])
async def list_llm_models(_request: Request) -> list[LLMModelInfoPayload]:
    """List all models currently available in Ollama."""
    try:
        s = await check_ollama_status()
    except OllamaAPIError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    if not s.running:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Ollama 未运行，请先启动 Ollama",
        )
    return [_model_to_payload(m) for m in s.models]


@router.delete("/models", status_code=status.HTTP_204_NO_CONTENT)
async def remove_llm_model(body: DeleteModelRequest, _request: Request) -> None:
    """Delete a model from Ollama."""
    try:
        await delete_model(body.name)
    except OllamaNotRunningError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except OllamaModelNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except OllamaAPIError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
