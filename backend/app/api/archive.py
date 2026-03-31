import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from app.db.connection import connect_database
from app.schemas.archive import GenerationArchiveRecord, GenerationArchiveRequest
from app.services.characters import CharacterNotFoundError
from app.services.generation_archive import GenerationArchiveError, archive_generation, list_generation_archives

router = APIRouter()


@dataclass(slots=True)
class ArchiveRuntime:
    db_path: Path
    data_root: Path


def _resolve_runtime(request: Request) -> ArchiveRuntime:
    bootstrap = getattr(request.app.state, "bootstrap", None)
    if bootstrap is None or bootstrap.status != "ok":
        raise HTTPException(status_code=503, detail="服务初始化失败，请稍后重试")
    return ArchiveRuntime(db_path=bootstrap.db_path, data_root=bootstrap.data_root)


@contextmanager
def _open_connection(db_path: Path):
    with connect_database(db_path) as conn:
        conn.row_factory = sqlite3.Row
        yield conn


@router.post(
    "/generations/archive",
    response_model=GenerationArchiveRecord,
    status_code=201,
)
def create_generation_archive(
    request: Request,
    payload: GenerationArchiveRequest,
) -> GenerationArchiveRecord:
    runtime = _resolve_runtime(request)

    try:
        with _open_connection(runtime.db_path) as conn:
            # Verify character exists before writing the image file.
            exists = conn.execute(
                "SELECT 1 FROM characters WHERE id = ?", (payload.character_id,)
            ).fetchone()
            if not exists:
                raise CharacterNotFoundError(f"角色不存在，请刷新后重试。")

            return archive_generation(conn, runtime.data_root, payload)
    except CharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except GenerationArchiveError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/characters/{character_id}/generations",
    response_model=dict,
)
def list_character_generations(
    character_id: str,
    request: Request,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    runtime = _resolve_runtime(request)

    with _open_connection(runtime.db_path) as conn:
        records = list_generation_archives(
            conn, character_id, limit=limit, offset=offset
        )

    return {"items": [r.model_dump(by_alias=True) for r in records]}
