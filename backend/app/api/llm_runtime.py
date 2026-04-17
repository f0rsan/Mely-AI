from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel

from app.services.llm_runtime_manager import (
    LLMRuntimeReadinessState,
)

LLMTrainingMode = Literal["light", "standard", "fine"]

router = APIRouter(prefix="/llm-runtime", tags=["llm-runtime"])


class RuntimeActionPayload(BaseModel):
    id: str
    label: str
    description: str
    recommended: bool


class RuntimeInstallProgressPayload(BaseModel):
    active: bool
    percent: float
    stage: str
    message: str
    startedAt: str | None
    updatedAt: str | None
    attempt: int
    errorMessage: str | None


class RuntimeHardwarePayload(BaseModel):
    gpuModel: str | None
    vramGB: float
    driverVersion: str | None
    cudaVersion: str | None
    driverCompatibility: str
    cudaCompatibility: str
    diskFreeGB: float
    diskRequiredGB: float
    source: str
    supportedModes: list[str]


class LLMRuntimeReadinessPayload(BaseModel):
    state: LLMRuntimeReadinessState
    ready: bool
    message: str
    blockingReason: str | None
    repairable: bool
    actions: list[RuntimeActionPayload]
    installProgress: RuntimeInstallProgressPayload
    hardware: RuntimeHardwarePayload | None
    checks: dict


def _resolve_runtime_manager(request: Request):
    manager = getattr(request.app.state, "llm_runtime_manager", None)
    if manager is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="训练运行时管理器尚未初始化，请稍后重试。",
        )
    return manager


@router.get("/readiness", response_model=LLMRuntimeReadinessPayload)
async def get_llm_runtime_readiness(
    request: Request,
    mode: LLMTrainingMode = Query(default="standard"),
    baseModel: str = Query(default="qwen2.5:3b"),
    autoFix: bool = Query(default=False),
) -> LLMRuntimeReadinessPayload:
    manager = _resolve_runtime_manager(request)
    readiness = await manager.get_readiness(
        mode=mode,
        base_model=baseModel,
        auto_fix=autoFix,
    )
    return LLMRuntimeReadinessPayload(**readiness.to_dict())


@router.post("/repair", response_model=LLMRuntimeReadinessPayload)
async def repair_llm_runtime(request: Request) -> LLMRuntimeReadinessPayload:
    manager = _resolve_runtime_manager(request)
    readiness = await manager.repair_runtime()
    return LLMRuntimeReadinessPayload(**readiness.to_dict())
