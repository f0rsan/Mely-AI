from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.services.downloads import (
    DownloadModelNotFoundError,
    DownloadService,
    DownloadServiceError,
    DownloadTaskConflictError,
    DownloadTaskNotFoundError,
)

router = APIRouter()


class ModelRegistryItemPayload(BaseModel):
    id: str
    name: str
    url: str
    size: int | None = Field(default=None, ge=0)
    sha256: str | None = None
    relativePath: str


class DownloadTaskPayload(BaseModel):
    id: str
    modelId: str
    modelName: str
    url: str
    targetPath: str
    tempPath: str
    expectedSize: int | None = Field(default=None, ge=0)
    expectedSha256: str | None = None
    sha256: str | None = None
    status: Literal["pending", "running", "completed", "failed"]
    progress: int = Field(ge=0, le=100)
    downloadedBytes: int = Field(ge=0)
    totalBytes: int | None = Field(default=None, ge=0)
    message: str | None = None
    error: str | None = None
    createdAt: str
    updatedAt: str


class DownloadTaskCreateRequest(BaseModel):
    modelId: str = Field(min_length=1)


@dataclass(slots=True)
class DownloadRuntime:
    service: DownloadService


def resolve_download_runtime(request: Request) -> DownloadRuntime:
    service = getattr(request.app.state, "download_service", None)
    if not isinstance(service, DownloadService):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="下载服务暂不可用，请稍后重试。",
        )
    return DownloadRuntime(service=service)


@router.get("/downloads/models", response_model=list[ModelRegistryItemPayload])
def list_download_models(request: Request) -> list[dict[str, object]]:
    runtime = resolve_download_runtime(request)
    return runtime.service.list_models()


@router.post("/downloads/tasks", response_model=DownloadTaskPayload, status_code=status.HTTP_202_ACCEPTED)
async def create_download_task(payload: DownloadTaskCreateRequest, request: Request) -> dict[str, object]:
    runtime = resolve_download_runtime(request)
    try:
        return await runtime.service.create_task(payload.modelId)
    except DownloadModelNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DownloadServiceError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.get("/downloads/tasks", response_model=list[DownloadTaskPayload])
def list_download_tasks(request: Request) -> list[dict[str, object]]:
    runtime = resolve_download_runtime(request)
    return runtime.service.list_tasks()


@router.get("/downloads/tasks/{task_id}", response_model=DownloadTaskPayload)
def get_download_task(task_id: str, request: Request) -> dict[str, object]:
    runtime = resolve_download_runtime(request)
    try:
        return runtime.service.get_task(task_id)
    except DownloadTaskNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    "/downloads/tasks/{task_id}/resume",
    response_model=DownloadTaskPayload,
    status_code=status.HTTP_202_ACCEPTED,
)
async def resume_download_task(task_id: str, request: Request) -> dict[str, object]:
    runtime = resolve_download_runtime(request)
    try:
        return await runtime.service.resume_task(task_id)
    except DownloadTaskNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DownloadTaskConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except DownloadServiceError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
