"""API tests for character profile, memories and system prompt preview."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.db.connection import connect_database
from app.main import create_app
from app.services.persona_assembler import DEFAULT_SYSTEM_PROMPT


@pytest.fixture()
def client(temp_data_root):
    app = create_app()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def character_id(client) -> str:
    resp = client.post("/api/characters", json={"name": "人设测试角色"})
    assert resp.status_code == 201
    return resp.json()["id"]


def _db_path(client: TestClient) -> Path:
    return client.app.state.bootstrap.db_path


def _memory_row(client: TestClient, memory_id: str) -> sqlite3.Row:
    with connect_database(_db_path(client)) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT id, hit_count, last_used_at FROM character_memories WHERE id = ?",
            (memory_id,),
        ).fetchone()
    assert row is not None
    return row


def _extract_sse_events(raw_text: str) -> list[dict[str, object]]:
    return [
        json.loads(line[6:])
        for line in raw_text.splitlines()
        if line.startswith("data: ")
    ]


def test_preview_uses_unsaved_draft_instead_of_saved_profile(client, character_id):
    save_resp = client.put(
        f"/api/characters/{character_id}/profile",
        json={
            "personaSummary": "数据库里的旧设定",
            "speakingStyle": "古风文言文",
            "userAddress": "你",
            "selfAddress": "我",
        },
    )
    assert save_resp.status_code == 200
    saved_profile = save_resp.json()

    preview_resp = client.post(
        f"/api/characters/{character_id}/profile/preview",
        json={
            "personaSummary": "这是未保存的草稿设定",
            "speakingStyle": "活泼口语",
            "userAddress": "小伙伴",
            "selfAddress": "我",
        },
    )
    assert preview_resp.status_code == 200
    preview_prompt = preview_resp.json()["prompt"]

    assert "这是未保存的草稿设定" in preview_prompt
    assert "数据库里的旧设定" not in preview_prompt
    assert "活泼口语" in preview_prompt
    assert "古风文言文" not in preview_prompt

    # Preview must not mutate persisted profile.
    get_resp = client.get(f"/api/characters/{character_id}/profile")
    assert get_resp.status_code == 200
    profile = get_resp.json()
    assert profile["personaSummary"] == saved_profile["personaSummary"]
    assert profile["speakingStyle"] == saved_profile["speakingStyle"]
    assert profile["profileVersion"] == saved_profile["profileVersion"]


def test_preview_does_not_create_profile_record(client, character_id):
    preview_resp = client.post(
        f"/api/characters/{character_id}/profile/preview",
        json={
            "personaSummary": "只用于预览，不应该落库",
            "speakingStyle": "自然聊天",
            "userAddress": "你",
            "selfAddress": "我",
        },
    )
    assert preview_resp.status_code == 200
    assert "只用于预览，不应该落库" in preview_resp.json()["prompt"]

    get_resp = client.get(f"/api/characters/{character_id}/profile")
    assert get_resp.status_code == 404


def test_preview_includes_memory_when_profile_missing(client, character_id):
    memory_resp = client.post(
        f"/api/characters/{character_id}/memories",
        json={"kind": "fact", "content": "她怕打雷", "importance": 5, "pinned": True},
    )
    assert memory_resp.status_code == 201

    preview_resp = client.post(f"/api/characters/{character_id}/profile/preview", json={})
    assert preview_resp.status_code == 200
    body = preview_resp.json()
    assert body["hasProfile"] is False
    assert body["memoryCount"] == 1
    assert DEFAULT_SYSTEM_PROMPT in body["prompt"]
    assert "她怕打雷" in body["prompt"]


def test_preview_does_not_increase_memory_hit_count(client, character_id):
    memory_resp = client.post(
        f"/api/characters/{character_id}/memories",
        json={"kind": "fact", "content": "她喜欢草莓蛋糕", "importance": 4, "pinned": True},
    )
    assert memory_resp.status_code == 201
    memory_id = memory_resp.json()["id"]

    before = _memory_row(client, memory_id)
    assert before["hit_count"] == 0
    assert before["last_used_at"] is None

    preview_resp = client.post(f"/api/characters/{character_id}/profile/preview", json={})
    assert preview_resp.status_code == 200
    assert "她喜欢草莓蛋糕" in preview_resp.json()["prompt"]

    after = _memory_row(client, memory_id)
    assert after["hit_count"] == 0
    assert after["last_used_at"] is None


def test_chat_includes_memory_when_profile_missing(client, character_id):
    memory_resp = client.post(
        f"/api/characters/{character_id}/memories",
        json={"kind": "fact", "content": "她讨厌薄荷味", "importance": 5, "pinned": True},
    )
    assert memory_resp.status_code == 201

    chat_resp = client.post(f"/api/characters/{character_id}/chats", json={})
    assert chat_resp.status_code == 201
    chat_id = chat_resp.json()["id"]

    captured: dict[str, object] = {}

    async def _capture(model_name: str, messages):
        captured["model"] = model_name
        captured["messages"] = messages
        yield "收到"

    with patch("app.services.chat_service.ollama_chat_stream", side_effect=_capture):
        stream_resp = client.post(
            f"/api/chats/{chat_id}/stream",
            json={"content": "你喜欢什么味道？"},
        )
    assert stream_resp.status_code == 200

    sent_messages = captured["messages"]
    system_message = next(message for message in sent_messages if message["role"] == "system")
    assert DEFAULT_SYSTEM_PROMPT in system_message["content"]
    assert "她讨厌薄荷味" in system_message["content"]


def test_rejected_chat_request_does_not_increase_memory_hit_count(client, character_id):
    memory_resp = client.post(
        f"/api/characters/{character_id}/memories",
        json={"kind": "fact", "content": "她住在海边小镇", "importance": 5, "pinned": True},
    )
    assert memory_resp.status_code == 201
    memory_id = memory_resp.json()["id"]

    chat_resp = client.post(f"/api/characters/{character_id}/chats", json={})
    assert chat_resp.status_code == 201
    chat_id = chat_resp.json()["id"]

    with patch("app.services.chat_service.ollama_chat_stream") as mock_stream:
        stream_resp = client.post(
            f"/api/chats/{chat_id}/stream",
            json={"content": "请描述图片", "images": ["base64-image"]},
        )

    assert stream_resp.status_code == 200
    events = _extract_sse_events(stream_resp.text)
    error_events = [event for event in events if event["type"] == "error"]
    assert len(error_events) == 1
    assert "文本模型" in str(error_events[0]["message"])
    assert not mock_stream.called

    row = _memory_row(client, memory_id)
    assert row["hit_count"] == 0
    assert row["last_used_at"] is None


def test_successful_chat_increases_memory_hit_count(client, character_id):
    memory_resp = client.post(
        f"/api/characters/{character_id}/memories",
        json={"kind": "fact", "content": "她每周二都去练歌", "importance": 5, "pinned": True},
    )
    assert memory_resp.status_code == 201
    memory_id = memory_resp.json()["id"]

    chat_resp = client.post(f"/api/characters/{character_id}/chats", json={})
    assert chat_resp.status_code == 201
    chat_id = chat_resp.json()["id"]

    async def _capture(_model_name: str, _messages):
        yield "好的"

    with patch("app.services.chat_service.ollama_chat_stream", side_effect=_capture):
        stream_resp = client.post(
            f"/api/chats/{chat_id}/stream",
            json={"content": "你今天安排是什么？"},
        )

    assert stream_resp.status_code == 200
    events = _extract_sse_events(stream_resp.text)
    done_events = [event for event in events if event["type"] == "done"]
    assert len(done_events) == 1

    row = _memory_row(client, memory_id)
    assert row["hit_count"] == 1
    assert row["last_used_at"] is not None


def test_profile_and_memory_crud_still_work(client, character_id):
    save_profile_resp = client.put(
        f"/api/characters/{character_id}/profile",
        json={
            "personaSummary": "温柔的图书管理员",
            "personalityTraits": ["耐心", "细心"],
            "userAddress": "你",
            "selfAddress": "我",
        },
    )
    assert save_profile_resp.status_code == 200
    assert save_profile_resp.json()["personaSummary"] == "温柔的图书管理员"

    get_profile_resp = client.get(f"/api/characters/{character_id}/profile")
    assert get_profile_resp.status_code == 200
    assert get_profile_resp.json()["personalityTraits"] == ["耐心", "细心"]

    create_memory_resp = client.post(
        f"/api/characters/{character_id}/memories",
        json={"kind": "event", "content": "她昨天买了一本新书", "importance": 3, "pinned": False},
    )
    assert create_memory_resp.status_code == 201
    memory_id = create_memory_resp.json()["id"]

    list_resp = client.get(f"/api/characters/{character_id}/memories")
    assert list_resp.status_code == 200
    assert list_resp.json()["total"] == 1

    update_resp = client.put(
        f"/api/characters/{character_id}/memories/{memory_id}",
        json={"content": "她昨天买了两本新书", "importance": 4, "pinned": True},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["content"] == "她昨天买了两本新书"
    assert update_resp.json()["importance"] == 4
    assert update_resp.json()["pinned"] is True

    delete_resp = client.delete(f"/api/characters/{character_id}/memories/{memory_id}")
    assert delete_resp.status_code == 204

    list_after_delete_resp = client.get(f"/api/characters/{character_id}/memories")
    assert list_after_delete_resp.status_code == 200
    assert list_after_delete_resp.json()["total"] == 0
