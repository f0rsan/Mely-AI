from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

from app.db.connection import connect_database
from app.services.llm_catalog import is_catalog_model

router = APIRouter(tags=["llm-preferences"])


class CharacterLLMPreferencesPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    character_id: str = Field(alias="characterId")
    default_base_model_name: str | None = Field(alias="defaultBaseModelName")


class UpdateCharacterLLMPreferencesRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    default_base_model_name: str | None = Field(default=None, alias="defaultBaseModelName")


def _resolve_db_path(request: Request) -> Path:
    bootstrap = getattr(request.app.state, "bootstrap", None)
    if bootstrap is None or bootstrap.status != "ok":
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="服务初始化失败，请稍后重试")
    return bootstrap.db_path


@contextmanager
def _open_connection(db_path: Path):
    with connect_database(db_path) as conn:
        conn.row_factory = sqlite3.Row
        yield conn


def _ensure_character_exists(connection: sqlite3.Connection, character_id: str) -> None:
    row = connection.execute("SELECT id FROM characters WHERE id = ?", (character_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="角色不存在")


def _normalize_model_name(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _get_preferences(connection: sqlite3.Connection, character_id: str) -> CharacterLLMPreferencesPayload:
    _ensure_character_exists(connection, character_id)
    row = connection.execute(
        "SELECT default_base_model_name FROM characters WHERE id = ?",
        (character_id,),
    ).fetchone()
    return CharacterLLMPreferencesPayload(
        characterId=character_id,
        defaultBaseModelName=row["default_base_model_name"] if row else None,
    )


@router.get(
    "/characters/{character_id}/llm-preferences",
    response_model=CharacterLLMPreferencesPayload,
)
def get_character_llm_preferences(character_id: str, request: Request) -> CharacterLLMPreferencesPayload:
    db_path = _resolve_db_path(request)
    with _open_connection(db_path) as connection:
        return _get_preferences(connection, character_id)


@router.put(
    "/characters/{character_id}/llm-preferences",
    response_model=CharacterLLMPreferencesPayload,
)
def update_character_llm_preferences(
    character_id: str,
    body: UpdateCharacterLLMPreferencesRequest,
    request: Request,
) -> CharacterLLMPreferencesPayload:
    db_path = _resolve_db_path(request)
    model_name = _normalize_model_name(body.default_base_model_name)
    if model_name is not None and not is_catalog_model(model_name):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不在模型目录中的模型不能设为默认模型")

    with _open_connection(db_path) as connection:
        _ensure_character_exists(connection, character_id)
        connection.execute(
            "UPDATE characters SET default_base_model_name = ? WHERE id = ?",
            (model_name, character_id),
        )
        connection.commit()
        return _get_preferences(connection, character_id)
