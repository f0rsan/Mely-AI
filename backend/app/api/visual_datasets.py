"""Visual dataset API — image import, quality scoring."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, UploadFile, status
from pydantic import BaseModel

from app.services.visual_dataset_service import (
    VisualDatasetNotFoundError,
    VisualDatasetImageNotFoundError,
    VisualDatasetError,
)

router = APIRouter(tags=["visual-datasets"])

_ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
_MAX_FILE_BYTES = 20 * 1024 * 1024  # 20 MB per image


# ── Request / response models ──────────────────────────────────────────────────

class CreateDatasetRequest(BaseModel):
    name: str
    characterId: str


class VisualDatasetPayload(BaseModel):
    id: str
    characterId: str
    name: str
    imageCount: int
    qualityScore: float | None
    qualityIssues: list[str]
    createdAt: str


class VisualImagePayload(BaseModel):
    id: str
    datasetId: str
    filename: str
    storedPath: str
    width: int | None
    height: int | None
    tags: list[str]
    source: str
    createdAt: str


# ── Helpers ────────────────────────────────────────────────────────────────────

def _resolve_service(request: Request):
    svc = getattr(request.app.state, "visual_dataset_service", None)
    if svc is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="服务初始化失败，请稍后重试",
        )
    return svc


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post(
    "/visual-datasets",
    response_model=VisualDatasetPayload,
    status_code=status.HTTP_201_CREATED,
)
def create_visual_dataset(body: CreateDatasetRequest, request: Request) -> VisualDatasetPayload:
    svc = _resolve_service(request)
    try:
        ds = svc.create_dataset(character_id=body.characterId, name=body.name)
    except VisualDatasetNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return VisualDatasetPayload(**ds)


@router.get("/visual-datasets", response_model=list[VisualDatasetPayload])
def list_visual_datasets(request: Request, characterId: str) -> list[VisualDatasetPayload]:
    svc = _resolve_service(request)
    datasets = svc.list_datasets(character_id=characterId)
    return [VisualDatasetPayload(**d) for d in datasets]


@router.delete("/visual-datasets/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_visual_dataset(dataset_id: str, request: Request) -> None:
    svc = _resolve_service(request)
    try:
        svc.delete_dataset(dataset_id)
    except VisualDatasetNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    "/visual-datasets/{dataset_id}/images",
    response_model=VisualImagePayload,
    status_code=status.HTTP_201_CREATED,
)
async def upload_image(
    dataset_id: str,
    file: UploadFile,
    request: Request,
) -> VisualImagePayload:
    svc = _resolve_service(request)

    # Validate extension
    from pathlib import Path
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支持的文件格式 {suffix}，请上传 JPG / PNG / WebP 图片",
        )

    data = await file.read()
    if len(data) > _MAX_FILE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="图片文件过大，单张不得超过 20MB",
        )

    try:
        img = svc.add_image(
            dataset_id=dataset_id,
            filename=file.filename or "image.jpg",
            data=data,
        )
    except VisualDatasetNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except VisualDatasetError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return VisualImagePayload(**img)


@router.get("/visual-datasets/{dataset_id}/images", response_model=list[VisualImagePayload])
def list_images(dataset_id: str, request: Request) -> list[VisualImagePayload]:
    svc = _resolve_service(request)
    try:
        imgs = svc.list_images(dataset_id)
    except VisualDatasetNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return [VisualImagePayload(**i) for i in imgs]


@router.delete("/visual-dataset-images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_image(image_id: str, request: Request) -> None:
    svc = _resolve_service(request)
    try:
        svc.delete_image(image_id)
    except VisualDatasetImageNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
