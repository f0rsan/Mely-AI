"""Costume API endpoints — M4-A.

Endpoints:
  POST   /api/characters/{character_id}/costumes        → 201
  GET    /api/characters/{character_id}/costumes        → 200
  PUT    /api/costumes/{costume_id}                     → 200
  DELETE /api/costumes/{costume_id}                     → 204
  GET    /api/costumes/{costume_id}/previews            → 200
  POST   /api/costumes/{costume_id}/generate-previews   → 202
  GET    /api/costumes/{costume_id}/previews/{preview_id}/image → FileResponse
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import FileResponse, Response

from app.db.connection import connect_database
from app.schemas.costume import (
    CostumeCreateRequest,
    CostumePreviewGenerateAcceptedResponse,
    CostumePreviewListResponse,
    CostumeResponse,
    CostumeTreeResponse,
    CostumeUpdateRequest,
)
from app.services.characters import CharacterNotFoundError
from app.services.costume_service import (
    CostumeDeleteForbiddenError,
    CostumeNotFoundError,
    CostumeParentNotFoundError,
    create_costume,
    delete_costume,
    list_costume_previews,
    list_costumes,
    submit_preview_generation,
    update_costume,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Runtime helpers
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class CostumeRuntime:
    db_path: Path
    data_root: Path


def _resolve_runtime(request: Request) -> CostumeRuntime:
    bootstrap = getattr(request.app.state, "bootstrap", None)
    if bootstrap is None or bootstrap.status != "ok":
        raise HTTPException(status_code=503, detail="服务初始化失败，请稍后重试")
    return CostumeRuntime(db_path=bootstrap.db_path, data_root=bootstrap.data_root)


def _resolve_task_queue(request: Request):
    queue = getattr(request.app.state, "task_queue", None)
    if queue is None:
        raise HTTPException(status_code=503, detail="任务队列暂不可用，请稍后重试。")
    return queue


@contextmanager
def _open_connection(db_path: Path):
    with connect_database(db_path) as conn:
        conn.row_factory = sqlite3.Row
        yield conn


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/characters/{character_id}/costumes",
    response_model=CostumeResponse,
    status_code=201,
)
def create_costume_endpoint(
    character_id: str,
    payload: CostumeCreateRequest,
    request: Request,
) -> CostumeResponse:
    runtime = _resolve_runtime(request)
    try:
        with _open_connection(runtime.db_path) as conn:
            return create_costume(conn, runtime.data_root, character_id, payload)
    except CharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CostumeParentNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get(
    "/characters/{character_id}/costumes",
    response_model=CostumeTreeResponse,
    status_code=200,
)
def list_costumes_endpoint(
    character_id: str,
    request: Request,
) -> CostumeTreeResponse:
    runtime = _resolve_runtime(request)
    try:
        with _open_connection(runtime.db_path) as conn:
            return list_costumes(conn, character_id)
    except CharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put(
    "/costumes/{costume_id}",
    response_model=CostumeResponse,
    status_code=200,
)
def update_costume_endpoint(
    costume_id: str,
    payload: CostumeUpdateRequest,
    request: Request,
) -> CostumeResponse:
    runtime = _resolve_runtime(request)
    try:
        with _open_connection(runtime.db_path) as conn:
            return update_costume(conn, costume_id, payload)
    except CostumeNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete(
    "/costumes/{costume_id}",
    status_code=204,
)
def delete_costume_endpoint(
    costume_id: str,
    request: Request,
) -> Response:
    runtime = _resolve_runtime(request)
    try:
        with _open_connection(runtime.db_path) as conn:
            delete_costume(conn, runtime.data_root, costume_id)
    except CostumeNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CostumeDeleteForbiddenError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/costumes/{costume_id}/previews",
    response_model=CostumePreviewListResponse,
    status_code=200,
)
def list_previews_endpoint(
    costume_id: str,
    request: Request,
) -> CostumePreviewListResponse:
    runtime = _resolve_runtime(request)
    with _open_connection(runtime.db_path) as conn:
        return list_costume_previews(conn, costume_id)


@router.post(
    "/costumes/{costume_id}/generate-previews",
    response_model=CostumePreviewGenerateAcceptedResponse,
    status_code=202,
)
async def generate_previews_endpoint(
    costume_id: str,
    request: Request,
) -> CostumePreviewGenerateAcceptedResponse:
    runtime = _resolve_runtime(request)
    queue = _resolve_task_queue(request)

    try:
        with _open_connection(runtime.db_path) as conn:
            # Fetch character_id for this costume.
            row = conn.execute(
                "SELECT character_id FROM costumes WHERE id = ?", (costume_id,)
            ).fetchone()
            if row is None:
                raise CostumeNotFoundError("造型不存在，请刷新后重试。")
            character_id = row["character_id"]

            task_ids = await submit_preview_generation(
                conn, runtime.data_root, costume_id, character_id, queue
            )
    except CostumeNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return CostumePreviewGenerateAcceptedResponse(
        costumeId=costume_id,
        taskIds=task_ids,
        message="预览图生成任务已提交",
    )


@router.get("/costumes/{costume_id}/previews/{preview_id}/image")
def get_preview_image(
    costume_id: str,
    preview_id: str,
    request: Request,
) -> FileResponse:
    runtime = _resolve_runtime(request)

    with _open_connection(runtime.db_path) as conn:
        row = conn.execute(
            "SELECT cp.image_path, c.character_id FROM costume_previews cp "
            "JOIN costumes c ON c.id = cp.costume_id "
            "WHERE cp.id = ? AND cp.costume_id = ?",
            (preview_id, costume_id),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="预览图不存在。")

    image_path = Path(row["image_path"]).resolve()
    character_id = row["character_id"]

    # Path traversal check: image must be under characters/*/costumes/.
    allowed_root = (
        runtime.data_root / "characters" / character_id / "costumes"
    ).resolve()

    try:
        image_path.relative_to(allowed_root)
    except ValueError:
        raise HTTPException(status_code=403, detail="无权访问该资源。")

    if not image_path.exists():
        raise HTTPException(status_code=404, detail="预览图文件不存在。")

    return FileResponse(str(image_path), media_type="image/png")
