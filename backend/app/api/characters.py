import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.db.connection import connect_database
from app.schemas.characters import (
    CharacterCreateRequest,
    CharacterDetailResponse,
    CharacterListResponse,
    CharacterUpdateRequest,
)
from app.services.characters import (
    CharacterNotFoundError,
    CharacterServiceError,
    CharacterValidationError,
    create_character,
    delete_character,
    get_character_detail,
    list_characters,
    update_character,
)

router = APIRouter()


@dataclass(slots=True)
class CharacterRuntime:
    db_path: Path
    data_root: Path


def _resolve_runtime(request: Request) -> CharacterRuntime:
    bootstrap = getattr(request.app.state, "bootstrap", None)
    if bootstrap is None or bootstrap.status != "ok":
        raise HTTPException(status_code=503, detail="服务初始化失败，请稍后重试")
    return CharacterRuntime(db_path=bootstrap.db_path, data_root=bootstrap.data_root)


@contextmanager
def _open_connection(db_path: Path):
    with connect_database(db_path) as connection:
        connection.row_factory = sqlite3.Row
        yield connection


@router.post(
    "/characters",
    response_model=CharacterDetailResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_character_endpoint(payload: CharacterCreateRequest, request: Request):
    runtime = _resolve_runtime(request)

    try:
        with _open_connection(runtime.db_path) as connection:
            return create_character(connection, runtime.data_root, payload)
    except CharacterServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/characters", response_model=CharacterListResponse)
def list_characters_endpoint(request: Request):
    runtime = _resolve_runtime(request)

    with _open_connection(runtime.db_path) as connection:
        items = list_characters(connection)

    return CharacterListResponse(items=items, total=len(items))


@router.get("/characters/{character_id}", response_model=CharacterDetailResponse)
def get_character_detail_endpoint(character_id: str, request: Request):
    runtime = _resolve_runtime(request)

    try:
        with _open_connection(runtime.db_path) as connection:
            return get_character_detail(connection, character_id)
    except CharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/characters/{character_id}", response_model=CharacterDetailResponse)
def update_character_endpoint(
    character_id: str,
    payload: CharacterUpdateRequest,
    request: Request,
):
    runtime = _resolve_runtime(request)
    updates = payload.model_dump(exclude_unset=True)

    try:
        with _open_connection(runtime.db_path) as connection:
            return update_character(
                connection,
                character_id,
                name=updates.get("name"),
                fingerprint=updates.get("fingerprint"),
                update_name="name" in updates,
                update_fingerprint="fingerprint" in updates,
            )
    except CharacterValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except CharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CharacterServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/characters/{character_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_character_endpoint(character_id: str, request: Request):
    runtime = _resolve_runtime(request)

    try:
        with _open_connection(runtime.db_path) as connection:
            delete_character(connection, runtime.data_root, character_id)
    except CharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CharacterServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return Response(status_code=status.HTTP_204_NO_CONTENT)
