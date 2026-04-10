from __future__ import annotations

import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.db.connection import connect_database
from app.main import create_app


@pytest.fixture()
def client(temp_data_root):
    app = create_app()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def character_id(client) -> str:
    resp = client.post("/api/characters", json={"name": "记忆测试角色"})
    assert resp.status_code == 201
    return resp.json()["id"]


@pytest.fixture()
def chat_id(client, character_id) -> str:
    resp = client.post(f"/api/characters/{character_id}/chats", json={})
    assert resp.status_code == 201
    return resp.json()["id"]


def _db_path(client: TestClient) -> Path:
    return client.app.state.bootstrap.db_path


def _insert_chat_message(
    client: TestClient,
    *,
    chat_id: str,
    role: str,
    content: str,
    created_at: str,
) -> None:
    with connect_database(_db_path(client)) as conn:
        conn.execute(
            """
            INSERT INTO character_chat_messages (id, chat_id, role, content, created_at)
            VALUES (hex(randomblob(16)), ?, ?, ?, ?)
            """,
            (chat_id, role, content, created_at),
        )
        conn.commit()


def _memory_rows(client: TestClient, character_id: str) -> list[sqlite3.Row]:
    with connect_database(_db_path(client)) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT kind, content, importance, pinned, source, source_chat_id
            FROM character_memories
            WHERE character_id = ?
            ORDER BY created_at ASC
            """,
            (character_id,),
        ).fetchall()
    return rows


@pytest.mark.asyncio
async def test_extracts_long_term_memory_and_persists_metadata(client, character_id, chat_id):
    from app.services.memory_extraction_service import create_memory_extraction_service

    _insert_chat_message(
        client,
        chat_id=chat_id,
        role="user",
        content="我最喜欢草莓蛋糕，小时候每次生日都会吃。",
        created_at="2026-04-10T10:00:00Z",
    )
    _insert_chat_message(
        client,
        chat_id=chat_id,
        role="assistant",
        content="记住了，你很喜欢草莓蛋糕。",
        created_at="2026-04-10T10:00:01Z",
    )
    service = create_memory_extraction_service(db_path=_db_path(client))

    async def _fake_extract(_model_name: str, _messages):
        yield """
        {
          "items": [
            {
              "kind": "preference",
              "content": "用户喜欢草莓蛋糕",
              "importance": 4,
              "pinned": false,
              "confidence": 0.93,
              "reason": "这是稳定偏好"
            }
          ]
        }
        """

    with patch("app.services.memory_extraction_service.ollama_chat_stream", side_effect=_fake_extract):
        result = await service.extract_from_chat_turn(
            character_id=character_id,
            chat_id=chat_id,
            latest_user_message="我最喜欢草莓蛋糕，小时候每次生日都会吃。",
            latest_assistant_message="记住了，你很喜欢草莓蛋糕。",
        )

    assert result.inserted_count == 1
    rows = _memory_rows(client, character_id)
    assert len(rows) == 1
    assert rows[0]["kind"] == "preference"
    assert rows[0]["content"] == "用户喜欢草莓蛋糕"
    assert rows[0]["importance"] == 4
    assert rows[0]["pinned"] == 0
    assert rows[0]["source"] == "auto_extracted"
    assert rows[0]["source_chat_id"] == chat_id


@pytest.mark.asyncio
async def test_extracts_nothing_when_no_valid_items(client, character_id, chat_id):
    from app.services.memory_extraction_service import create_memory_extraction_service

    service = create_memory_extraction_service(db_path=_db_path(client))

    async def _fake_extract(_model_name: str, _messages):
        yield '{"items": []}'

    with patch("app.services.memory_extraction_service.ollama_chat_stream", side_effect=_fake_extract):
        result = await service.extract_from_chat_turn(
            character_id=character_id,
            chat_id=chat_id,
            latest_user_message="我今天下午三点要开会。",
            latest_assistant_message="好的，我知道了。",
        )

    assert result.inserted_count == 0
    assert _memory_rows(client, character_id) == []


@pytest.mark.asyncio
async def test_skips_duplicate_memory(client, character_id, chat_id):
    from app.services.memory_extraction_service import create_memory_extraction_service

    create_resp = client.post(
        f"/api/characters/{character_id}/memories",
        json={"kind": "fact", "content": "用户养了一只叫团子的猫", "importance": 5, "pinned": False},
    )
    assert create_resp.status_code == 201
    service = create_memory_extraction_service(db_path=_db_path(client))

    async def _fake_extract(_model_name: str, _messages):
        yield """
        {
          "items": [
            {
              "kind": "fact",
              "content": "用户养了一只叫团子的猫",
              "importance": 5,
              "pinned": false,
              "confidence": 0.99,
              "reason": "完全重复"
            }
          ]
        }
        """

    with patch("app.services.memory_extraction_service.ollama_chat_stream", side_effect=_fake_extract):
        result = await service.extract_from_chat_turn(
            character_id=character_id,
            chat_id=chat_id,
            latest_user_message="我家团子今天又把玩具叼过来了。",
            latest_assistant_message="听起来团子很黏你。",
        )

    assert result.inserted_count == 0
    rows = _memory_rows(client, character_id)
    assert len(rows) == 1
    assert rows[0]["source"] == "manual"


@pytest.mark.asyncio
async def test_skips_low_confidence_or_low_importance_items(client, character_id, chat_id):
    from app.services.memory_extraction_service import create_memory_extraction_service

    service = create_memory_extraction_service(db_path=_db_path(client))

    async def _fake_extract(_model_name: str, _messages):
        yield """
        {
          "items": [
            {
              "kind": "event",
              "content": "用户今天下午三点开会",
              "importance": 2,
              "pinned": false,
              "confidence": 0.95,
              "reason": "重要性不够"
            },
            {
              "kind": "preference",
              "content": "用户可能喜欢下雨天",
              "importance": 4,
              "pinned": false,
              "confidence": 0.6,
              "reason": "置信度不够"
            }
          ]
        }
        """

    with patch("app.services.memory_extraction_service.ollama_chat_stream", side_effect=_fake_extract):
        result = await service.extract_from_chat_turn(
            character_id=character_id,
            chat_id=chat_id,
            latest_user_message="今天下午三点我要开会，不过下雨也无所谓。",
            latest_assistant_message="那我不把这些记成长久信息。",
        )

    assert result.inserted_count == 0
    assert _memory_rows(client, character_id) == []


# ── _resolve_model_name ─────────────────────────────────────────────────────


def _set_chat_base_model(client: TestClient, chat_id: str, base_model_name: str) -> None:
    with connect_database(_db_path(client)) as conn:
        conn.execute(
            "UPDATE character_chats SET base_model_name = ? WHERE id = ?",
            (base_model_name, chat_id),
        )
        conn.commit()


def _set_character_default_model(client: TestClient, character_id: str, model: str) -> None:
    with connect_database(_db_path(client)) as conn:
        conn.execute(
            "UPDATE characters SET default_base_model_name = ? WHERE id = ?",
            (model, character_id),
        )
        conn.commit()


def _insert_llm_model_and_bind_to_chat(
    client: TestClient,
    *,
    character_id: str,
    chat_id: str,
    ollama_model_name: str,
    status: str = "ready",
) -> str:
    model_id = "test-llm-model-1"
    with connect_database(_db_path(client)) as conn:
        conn.execute(
            """
            INSERT INTO llm_models
                (id, character_id, version, base_model, ollama_model_name, gguf_path, status, created_at)
            VALUES (?, ?, 1, 'qwen2.5:7b-instruct-q4_K_M', ?, 'fake.gguf', ?, '2026-04-10T00:00:00Z')
            """,
            (model_id, character_id, ollama_model_name, status),
        )
        conn.execute(
            "UPDATE character_chats SET llm_model_id = ? WHERE id = ?",
            (model_id, chat_id),
        )
        conn.commit()
    return model_id


@pytest.mark.asyncio
async def test_resolve_model_ignores_fine_tuned_character_model(client, character_id, chat_id):
    """Fine-tuned character models are skipped; catalog base model is used instead."""
    from app.services.memory_extraction_service import create_memory_extraction_service

    _insert_llm_model_and_bind_to_chat(
        client, character_id=character_id, chat_id=chat_id, ollama_model_name="character_abc_v1"
    )
    _set_chat_base_model(client, chat_id, "qwen2.5:7b-instruct-q4_K_M")

    service = create_memory_extraction_service(db_path=_db_path(client))
    resolved = service._resolve_model_name(chat_id, character_id)

    assert resolved == "qwen2.5:7b-instruct-q4_K_M"
    assert resolved != "character_abc_v1"


@pytest.mark.asyncio
async def test_resolve_model_falls_back_to_default_when_no_catalog_model(
    client, character_id, chat_id
):
    """When no catalog model is configured anywhere, uses DEFAULT_EXTRACTION_MODEL."""
    from app.services.memory_extraction_service import (
        DEFAULT_EXTRACTION_MODEL,
        create_memory_extraction_service,
    )

    _insert_llm_model_and_bind_to_chat(
        client, character_id=character_id, chat_id=chat_id, ollama_model_name="character_abc_v1"
    )
    # No base_model_name on the chat, no default_base_model_name on the character.

    service = create_memory_extraction_service(db_path=_db_path(client))
    resolved = service._resolve_model_name(chat_id, character_id)

    assert resolved == DEFAULT_EXTRACTION_MODEL
    assert resolved != "character_abc_v1"


@pytest.mark.asyncio
async def test_resolve_model_uses_character_default_when_session_model_absent(
    client, character_id, chat_id
):
    """Falls back to character-level default catalog model when session has none."""
    from app.services.memory_extraction_service import create_memory_extraction_service

    _set_character_default_model(client, character_id, "qwen2.5:7b-instruct-q4_K_M")

    service = create_memory_extraction_service(db_path=_db_path(client))
    resolved = service._resolve_model_name(chat_id, character_id)

    assert resolved == "qwen2.5:7b-instruct-q4_K_M"
