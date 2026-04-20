from __future__ import annotations

import json
import os

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.services.llm_catalog import get_llm_catalog as get_catalog_items
from app.services.ollama_service import (
    OllamaAPIError,
    OllamaModelNotFoundError,
    OllamaNotRunningError,
    OllamaRuntimeStatus,
    OllamaModelInfo,
    OllamaStatus,
    check_ollama_runtime,
    check_ollama_status,
    delete_model,
    open_ollama_runtime,
    pull_model,
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


class LLMRuntimePayload(BaseModel):
    installed: bool
    running: bool
    version: str | None
    minimumVersion: str
    platform: str
    models: list[LLMModelInfoPayload]
    hint: str | None = None
    buildVersion: str | None = None
    backendExecutable: str | None = None
    runtimeResourceRoot: str | None = None
    releaseSummaryPath: str | None = None


class LLMCatalogItemPayload(BaseModel):
    id: str
    modelName: str
    displayName: str
    kind: str
    tier: str
    sizeLabel: str
    recommended: bool
    visionCapable: bool
    minOllamaVersion: str | None
    memoryHint: str


class LLMCatalogPayload(BaseModel):
    items: list[LLMCatalogItemPayload]


class DeleteModelRequest(BaseModel):
    name: str


class PullModelRequest(BaseModel):
    modelName: str


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


def _runtime_to_payload(s: OllamaRuntimeStatus) -> LLMRuntimePayload:
    return LLMRuntimePayload(
        installed=s.installed,
        running=s.running,
        version=s.version,
        minimumVersion=s.minimum_version,
        platform=s.platform,
        models=[_model_to_payload(m) for m in s.models],
        hint=s.hint,
        buildVersion=os.getenv("MELY_DESKTOP_BUILD_VERSION"),
        backendExecutable=os.getenv("MELY_BACKEND_EXECUTABLE"),
        runtimeResourceRoot=os.getenv("MELY_LLM_RUNTIME_RESOURCE_ROOT"),
        releaseSummaryPath=os.getenv("MELY_WINDOWS_BUILD_SUMMARY_PATH"),
    )


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _pull_phase(status_text: str) -> str:
    lowered = status_text.lower()
    if "pulling manifest" in lowered:
        return "正在获取模型信息"
    if "downloading" in lowered:
        return "正在下载"
    if "verifying" in lowered:
        return "正在校验"
    if "writing manifest" in lowered:
        return "正在整理模型文件"
    if "success" in lowered or "done" in lowered:
        return "下载完成"
    return "处理中"


def _normalize_pull_event(event: dict) -> dict:
    status_text = str(event.get("status") or "").strip() or "processing"
    total = event.get("total")
    completed = event.get("completed")
    percent: float | None = None
    if isinstance(total, (int, float)) and isinstance(completed, (int, float)) and total > 0:
        percent = round((completed / total) * 100, 2)

    payload = {
        "status": status_text,
        "phase": _pull_phase(status_text),
    }
    if isinstance(event.get("digest"), str):
        payload["digest"] = event["digest"]
    if isinstance(total, (int, float)):
        payload["total"] = total
    if isinstance(completed, (int, float)):
        payload["completed"] = completed
    if percent is not None:
        payload["percent"] = percent
    return payload


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/health", response_model=LLMHealthPayload)
async def get_llm_health(_request: Request) -> LLMHealthPayload:
    """Check Ollama status and list available models."""
    s = await check_ollama_status()
    return _status_to_payload(s)


@router.get("/runtime", response_model=LLMRuntimePayload)
async def get_llm_runtime(_request: Request) -> LLMRuntimePayload:
    runtime = await check_ollama_runtime()
    return _runtime_to_payload(runtime)


@router.post("/runtime/open", status_code=status.HTTP_204_NO_CONTENT)
async def open_llm_runtime(_request: Request) -> None:
    try:
        await open_ollama_runtime()
    except OllamaAPIError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/catalog", response_model=LLMCatalogPayload)
async def get_llm_catalog_endpoint(_request: Request) -> LLMCatalogPayload:
    items = [LLMCatalogItemPayload(**item.to_dict()) for item in get_catalog_items()]
    return LLMCatalogPayload(items=items)


@router.post("/pull", response_class=StreamingResponse)
async def pull_llm_model(
    body: PullModelRequest,
    _request: Request,
) -> StreamingResponse:
    runtime = await check_ollama_runtime()
    if not runtime.installed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未检测到语言引擎，请先安装 Ollama。")
    if not runtime.running:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=runtime.hint or "语言引擎未启动，请先启动后再下载模型。",
        )

    async def _stream():
        saw_done = False
        try:
            async for event in pull_model(body.modelName):
                payload = _normalize_pull_event(event)
                if str(payload.get("status", "")).lower() in {"done", "success"}:
                    saw_done = True
                yield _sse(payload)
            if not saw_done:
                yield _sse({"status": "done", "phase": "下载完成"})
        except OllamaNotRunningError:
            yield _sse({"status": "error", "message": "语言引擎未响应，请先启动后重试"})
        except OllamaAPIError:
            yield _sse({"status": "error", "message": "模型下载失败，请稍后重试"})

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


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
