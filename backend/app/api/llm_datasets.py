from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.db.connection import connect_database
from app.services.llm_dataset import (
    LLMDatasetCharacterNotFoundError,
    LLMDatasetNotFoundError,
    LLMDatasetRecord,
    LLMDatasetValidationError,
    ConversationItem,
    delete_dataset,
    get_dataset,
    ingest_dataset,
    list_datasets,
    preview_dataset,
)

router = APIRouter(tags=["llm-datasets"])


# ── Request / response models ──────────────────────────────────────────────────

class IngestDatasetRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1)


class QualityIssuePayload(BaseModel):
    message: str


class LLMDatasetPayload(BaseModel):
    id: str
    characterId: str
    name: str
    sourceFormat: str
    itemCount: int
    qualityScore: float | None
    qualityIssues: list[str]
    convertedPath: str | None
    createdAt: str


class ConversationItemPayload(BaseModel):
    human: str
    gpt: str


# ── Helpers ────────────────────────────────────────────────────────────────────

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
def _open_conn(db_path: Path):
    with connect_database(db_path) as conn:
        conn.row_factory = sqlite3.Row
        yield conn


def _to_payload(r: LLMDatasetRecord) -> LLMDatasetPayload:
    return LLMDatasetPayload(
        id=r.id,
        characterId=r.character_id,
        name=r.name,
        sourceFormat=r.source_format,
        itemCount=r.item_count,
        qualityScore=r.quality_score,
        qualityIssues=r.quality_issues,
        convertedPath=r.converted_path,
        createdAt=r.created_at,
    )


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post(
    "/characters/{character_id}/llm-datasets",
    response_model=LLMDatasetPayload,
    status_code=status.HTTP_201_CREATED,
)
def upload_llm_dataset(
    character_id: str,
    body: IngestDatasetRequest,
    request: Request,
) -> LLMDatasetPayload:
    """Upload a persona document or dialogue sample file.

    Supports Markdown/TXT (persona doc) and JSONL/CSV (dialogue samples).
    Content is the raw text of the file (UTF-8).
    """
    runtime = _resolve_runtime(request)
    try:
        with _open_conn(runtime.db_path) as conn:
            record = ingest_dataset(
                conn,
                runtime.data_root,
                character_id,
                body.filename,
                body.content,
            )
    except LLMDatasetCharacterNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except LLMDatasetValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _to_payload(record)


@router.get(
    "/characters/{character_id}/llm-datasets",
    response_model=list[LLMDatasetPayload],
)
def list_character_llm_datasets(
    character_id: str,
    request: Request,
) -> list[LLMDatasetPayload]:
    """List all LLM datasets for a character."""
    runtime = _resolve_runtime(request)
    with _open_conn(runtime.db_path) as conn:
        records = list_datasets(conn, character_id)
    return [_to_payload(r) for r in records]


@router.get(
    "/llm-datasets/{dataset_id}/preview",
    response_model=list[ConversationItemPayload],
)
def preview_llm_dataset(
    dataset_id: str,
    request: Request,
    limit: int = 10,
) -> list[ConversationItemPayload]:
    """Return first N conversation items for display."""
    runtime = _resolve_runtime(request)
    try:
        with _open_conn(runtime.db_path) as conn:
            items = preview_dataset(conn, dataset_id, limit=min(limit, 50))
    except LLMDatasetNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return [ConversationItemPayload(human=it.human, gpt=it.gpt) for it in items]


@router.delete(
    "/llm-datasets/{dataset_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_llm_dataset(dataset_id: str, request: Request) -> None:
    """Delete a dataset and its converted file."""
    runtime = _resolve_runtime(request)
    try:
        with _open_conn(runtime.db_path) as conn:
            delete_dataset(conn, dataset_id)
    except LLMDatasetNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
