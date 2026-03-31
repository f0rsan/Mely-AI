from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

from app.db.connection import connect_database
from app.services.dataset import (
    DatasetCharacterNotFoundError,
    DatasetImportImageInput,
    DatasetReportNotFoundError,
    DatasetServiceError,
    DatasetValidationError,
    get_dataset_report,
    import_dataset,
)

router = APIRouter()


class DatasetImageInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(min_length=1, max_length=255)
    content_base64: str = Field(alias="contentBase64", min_length=1)


class DatasetImportRequest(BaseModel):
    images: list[DatasetImageInput] = Field(min_length=1, max_length=200)


class ProblemItemPayload(BaseModel):
    imageId: str
    name: str
    angleBucket: str
    issues: list[str]


class RecommendedTrainingModePayload(BaseModel):
    mode: str
    reason: str
    suggestedSteps: int
    suggestedRank: int
    minRecommendedImages: int
    strategyDefaultModel: str
    runtimeModelHintOn8GB: str


class DatasetImagePayload(BaseModel):
    imageId: str
    name: str
    relativePath: str
    imageFormat: str
    width: int
    height: int
    fileSize: int
    angleBucket: str
    qualityStatus: str
    issues: list[str]


class DatasetReportPayload(BaseModel):
    characterId: str
    totalImages: int
    qualifiedImages: int
    problemImages: int
    qualityScore: int
    angleDistribution: dict[str, int]
    problemItems: list[ProblemItemPayload]
    recommendedTrainingMode: RecommendedTrainingModePayload
    recommendations: list[str]
    images: list[DatasetImagePayload]
    updatedAt: str


@dataclass(slots=True)
class DatasetRuntime:
    db_path: Path
    data_root: Path


def _resolve_runtime(request: Request) -> DatasetRuntime:
    bootstrap = getattr(request.app.state, "bootstrap", None)
    if bootstrap is None or bootstrap.status != "ok":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="服务初始化失败，请稍后重试",
        )
    return DatasetRuntime(db_path=bootstrap.db_path, data_root=bootstrap.data_root)


@contextmanager
def _open_connection(db_path: Path):
    with connect_database(db_path) as connection:
        connection.row_factory = sqlite3.Row
        yield connection


@router.post(
    "/characters/{character_id}/dataset/import",
    response_model=DatasetReportPayload,
)
def import_character_dataset(character_id: str, payload: DatasetImportRequest, request: Request):
    runtime = _resolve_runtime(request)
    images = [
        DatasetImportImageInput(name=image.name, content_base64=image.content_base64)
        for image in payload.images
    ]
    try:
        with _open_connection(runtime.db_path) as connection:
            return import_dataset(connection, runtime.data_root, character_id, images)
    except DatasetCharacterNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DatasetValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except DatasetServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc


@router.get(
    "/characters/{character_id}/dataset/report",
    response_model=DatasetReportPayload,
)
def get_character_dataset_report(character_id: str, request: Request) -> dict[str, Any]:
    runtime = _resolve_runtime(request)
    try:
        with _open_connection(runtime.db_path) as connection:
            return get_dataset_report(connection, character_id)
    except DatasetCharacterNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DatasetReportNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DatasetServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
