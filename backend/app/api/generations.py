import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from app.db.connection import connect_database
from app.schemas.generations import GenerationWorkbenchResponse
from app.services.characters import CharacterNotFoundError, CharacterServiceError
from app.services.generation_contract import get_generation_workbench_contract

router = APIRouter()


@dataclass(slots=True)
class GenerationRuntime:
    db_path: Path
    data_root: Path


def _resolve_runtime(request: Request) -> GenerationRuntime:
    bootstrap = getattr(request.app.state, "bootstrap", None)
    if bootstrap is None or bootstrap.status != "ok":
        raise HTTPException(status_code=503, detail="服务初始化失败，请稍后重试")
    return GenerationRuntime(db_path=bootstrap.db_path, data_root=bootstrap.data_root)


@contextmanager
def _open_connection(db_path: Path):
    with connect_database(db_path) as connection:
        connection.row_factory = sqlite3.Row
        yield connection


@router.get(
    "/characters/{character_id}/generation-workbench",
    response_model=GenerationWorkbenchResponse,
)
def get_generation_workbench_endpoint(character_id: str, request: Request):
    runtime = _resolve_runtime(request)

    try:
        with _open_connection(runtime.db_path) as connection:
            return get_generation_workbench_contract(connection, character_id)
    except CharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CharacterServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
