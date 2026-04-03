"""Tests for M1-E: Character chat API."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def client(temp_data_root):
    app = create_app()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def character_id(client) -> str:
    resp = client.post("/api/characters", json={"name": "对话角色"})
    assert resp.status_code == 201
    return resp.json()["id"]


@pytest.fixture()
def chat_id(client, character_id) -> str:
    resp = client.post(f"/api/characters/{character_id}/chats", json={})
    assert resp.status_code == 201
    return resp.json()["id"]


@pytest.fixture(autouse=True)
def ensure_fake_gguf_files():
    fake_paths = [Path("/tmp/fake.gguf"), Path("/tmp/a.gguf")]
    for path in fake_paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"GGUF")
    yield
    for path in fake_paths:
        path.unlink(missing_ok=True)


def _fake_stream(*chunks: str):
    """Return an async generator that yields chunks like Ollama would."""
    async def _gen(model_name, messages):
        for chunk in chunks:
            yield chunk
    return _gen


# ── Session CRUD ──────────────────────────────────────────────────────────────

class TestChatSessionCRUD:
    def test_create_session_returns_201(self, client, character_id):
        resp = client.post(f"/api/characters/{character_id}/chats", json={})
        assert resp.status_code == 201
        body = resp.json()
        assert body["characterId"] == character_id
        assert body["llmModelId"] is None
        assert body["id"] is not None

    def test_create_session_nonexistent_character_returns_404(self, client):
        resp = client.post("/api/characters/ghost-id/chats", json={})
        assert resp.status_code == 404

    def test_list_sessions_empty_for_new_character(self, client, character_id):
        resp = client.get(f"/api/characters/{character_id}/chats")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_sessions_returns_created_sessions(self, client, character_id):
        client.post(f"/api/characters/{character_id}/chats", json={})
        client.post(f"/api/characters/{character_id}/chats", json={})
        resp = client.get(f"/api/characters/{character_id}/chats")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_delete_session_returns_204(self, client, chat_id):
        resp = client.delete(f"/api/chats/{chat_id}")
        assert resp.status_code == 204

    def test_delete_nonexistent_session_returns_404(self, client):
        resp = client.delete("/api/chats/ghost-chat-id")
        assert resp.status_code == 404

    def test_get_messages_empty_for_new_session(self, client, chat_id):
        resp = client.get(f"/api/chats/{chat_id}/messages")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_get_messages_nonexistent_session_returns_404(self, client):
        resp = client.get("/api/chats/ghost-chat-id/messages")
        assert resp.status_code == 404

    def test_create_session_with_ready_model(self, client, character_id):
        from unittest.mock import AsyncMock, patch as _patch
        ds_lines = [
            json.dumps({"user": f"q{i}", "assistant": f"a{i}，详细回答。"}) for i in range(60)
        ]
        ds_resp = client.post(
            f"/api/characters/{character_id}/llm-datasets",
            json={"filename": "d.jsonl", "content": "\n".join(ds_lines)},
        )
        with _patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ):
            model_resp = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": "/tmp/fake.gguf"},
            )
        model_id = model_resp.json()["id"]
        resp = client.post(
            f"/api/characters/{character_id}/chats",
            json={"llmModelId": model_id},
        )
        assert resp.status_code == 201
        assert resp.json()["llmModelId"] == model_id

    def test_create_session_with_pending_model_returns_400(self, client, character_id):
        from app.services.ollama_service import OllamaNotRunningError
        from unittest.mock import AsyncMock, patch as _patch
        with _patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
            side_effect=OllamaNotRunningError("offline"),
        ):
            model_resp = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": "/tmp/fake.gguf"},
            )
        model_id = model_resp.json()["id"]
        assert model_resp.json()["status"] == "pending"
        resp = client.post(
            f"/api/characters/{character_id}/chats",
            json={"llmModelId": model_id},
        )
        assert resp.status_code == 400
        assert "未就绪" in resp.json()["detail"]

    def test_create_session_rejects_model_from_other_character(self, client):
        a_resp = client.post("/api/characters", json={"name": "角色A"})
        b_resp = client.post("/api/characters", json={"name": "角色B"})
        assert a_resp.status_code == 201
        assert b_resp.status_code == 201
        character_a_id = a_resp.json()["id"]
        character_b_id = b_resp.json()["id"]

        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ):
            model_resp = client.post(
                f"/api/characters/{character_a_id}/llm-models",
                json={"ggufPath": "/tmp/a.gguf"},
            )
        assert model_resp.status_code == 201
        model_id = model_resp.json()["id"]

        resp = client.post(
            f"/api/characters/{character_b_id}/chats",
            json={"llmModelId": model_id},
        )
        assert resp.status_code == 400
        assert "不属于当前角色" in resp.json()["detail"]


# ── Streaming ──────────────────────────────────────────────────────────────────

class TestStreamEndpoint:
    def test_stream_returns_sse_chunks(self, client, chat_id):
        with patch(
            "app.services.chat_service.ollama_chat_stream",
            side_effect=_fake_stream("你好", "，我是", "小花！"),
        ):
            resp = client.post(
                f"/api/chats/{chat_id}/stream",
                json={"content": "你好啊"},
            )
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]

        events = [
            json.loads(line[6:])
            for line in resp.text.splitlines()
            if line.startswith("data: ")
        ]
        chunk_events = [e for e in events if e["type"] == "chunk"]
        done_events = [e for e in events if e["type"] == "done"]
        assert len(chunk_events) == 3
        assert "".join(e["content"] for e in chunk_events) == "你好，我是小花！"
        assert len(done_events) == 1

    def test_stream_saves_user_and_assistant_messages(self, client, chat_id):
        with patch(
            "app.services.chat_service.ollama_chat_stream",
            side_effect=_fake_stream("当然可以！"),
        ):
            client.post(
                f"/api/chats/{chat_id}/stream",
                json={"content": "请介绍一下自己"},
            )

        msgs = client.get(f"/api/chats/{chat_id}/messages").json()
        roles = [m["role"] for m in msgs]
        assert "user" in roles
        assert "assistant" in roles
        user_msg = next(m for m in msgs if m["role"] == "user")
        assistant_msg = next(m for m in msgs if m["role"] == "assistant")
        assert user_msg["content"] == "请介绍一下自己"
        assert assistant_msg["content"] == "当然可以！"

    def test_stream_emits_error_event_when_ollama_offline(self, client, chat_id, caplog):
        from app.services.ollama_service import OllamaNotRunningError

        async def _raise(model, messages):
            raise OllamaNotRunningError("offline")
            yield  # make it a generator

        with (
            patch("app.services.chat_service.ollama_chat_stream", side_effect=_raise),
            caplog.at_level(logging.ERROR, logger="app.services.chat_service"),
        ):
            resp = client.post(
                f"/api/chats/{chat_id}/stream",
                json={"content": "你好"},
            )
        assert resp.status_code == 200
        events = [
            json.loads(line[6:])
            for line in resp.text.splitlines()
            if line.startswith("data: ")
        ]
        error_events = [e for e in events if e["type"] == "error"]
        assert len(error_events) == 1
        assert "Ollama" in error_events[0]["message"]
        logged = "\n".join(record.getMessage() for record in caplog.records)
        assert "error_category=ollama_not_running" in logged
        assert f"chat_id={chat_id}" in logged

    def test_stream_emits_error_event_when_ollama_model_missing(self, client, chat_id, caplog):
        from app.services.ollama_service import OllamaModelNotFoundError

        async def _raise(model, messages):
            raise OllamaModelNotFoundError("missing")
            yield  # make it a generator

        with (
            patch("app.services.chat_service.ollama_chat_stream", side_effect=_raise),
            caplog.at_level(logging.ERROR, logger="app.services.chat_service"),
        ):
            resp = client.post(
                f"/api/chats/{chat_id}/stream",
                json={"content": "你好"},
            )
        assert resp.status_code == 200
        events = [
            json.loads(line[6:])
            for line in resp.text.splitlines()
            if line.startswith("data: ")
        ]
        error_events = [e for e in events if e["type"] == "error"]
        assert len(error_events) == 1
        assert "模型未找到" in error_events[0]["message"]
        logged = "\n".join(record.getMessage() for record in caplog.records)
        assert "error_category=ollama_model_not_found" in logged
        assert f"chat_id={chat_id}" in logged

    def test_stream_emits_internal_error_event_and_logs_category(self, client, chat_id, caplog):
        with (
            patch("app.services.chat_service.ChatService.get_messages", side_effect=RuntimeError("db exploded")),
            caplog.at_level(logging.ERROR, logger="app.services.chat_service"),
        ):
            resp = client.post(
                f"/api/chats/{chat_id}/stream",
                json={"content": "你好"},
            )
        assert resp.status_code == 200
        events = [
            json.loads(line[6:])
            for line in resp.text.splitlines()
            if line.startswith("data: ")
        ]
        error_events = [e for e in events if e["type"] == "error"]
        assert len(error_events) == 1
        assert error_events[0]["message"] == "对话上下文准备失败，请稍后重试"

        logged = "\n".join(record.getMessage() for record in caplog.records)
        assert "error_category=context_build_error" in logged
        assert f"chat_id={chat_id}" in logged

    def test_stream_nonexistent_chat_returns_404(self, client):
        resp = client.post(
            "/api/chats/ghost-id/stream",
            json={"content": "你好"},
        )
        assert resp.status_code == 404

    def test_stream_empty_content_returns_422(self, client, chat_id):
        resp = client.post(f"/api/chats/{chat_id}/stream", json={"content": ""})
        assert resp.status_code == 422

    def test_stream_context_includes_history(self, client, chat_id):
        captured_messages: list = []

        async def _capture(model, messages):
            captured_messages.extend(messages)
            yield "ok"

        with patch("app.services.chat_service.ollama_chat_stream", side_effect=_capture):
            client.post(f"/api/chats/{chat_id}/stream", json={"content": "第一条消息"})

        with patch("app.services.chat_service.ollama_chat_stream", side_effect=_capture):
            client.post(f"/api/chats/{chat_id}/stream", json={"content": "第二条消息"})

        # Second call should include system + user1 + assistant1 + user2
        second_call_msgs = captured_messages[len(captured_messages) - 3:]
        roles = [m["role"] for m in second_call_msgs]
        assert "system" in captured_messages[0]["role"] or captured_messages[0]["role"] == "system"
        assert "user" in roles
        assert "assistant" in roles

    def test_stream_emits_error_when_bound_private_model_becomes_unavailable(self, client, character_id):
        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ):
            model_resp = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": "/tmp/fake.gguf"},
            )
        assert model_resp.status_code == 201
        model_id = model_resp.json()["id"]

        chat_resp = client.post(
            f"/api/characters/{character_id}/chats",
            json={"llmModelId": model_id},
        )
        assert chat_resp.status_code == 201
        current_chat_id = chat_resp.json()["id"]

        with patch(
            "app.services.llm_model_service.ollama_delete_model",
            new_callable=AsyncMock,
        ):
            delete_resp = client.delete(f"/api/llm-models/{model_id}")
        assert delete_resp.status_code == 204

        with patch("app.services.chat_service.ollama_chat_stream") as mock_stream:
            resp = client.post(
                f"/api/chats/{current_chat_id}/stream",
                json={"content": "还在吗"},
            )
        assert resp.status_code == 200
        events = [
            json.loads(line[6:])
            for line in resp.text.splitlines()
            if line.startswith("data: ")
        ]
        error_events = [e for e in events if e["type"] == "error"]
        assert len(error_events) == 1
        assert "私有模型" in error_events[0]["message"]
        assert "不可用" in error_events[0]["message"]
        assert not mock_stream.called

    def test_multiple_turns_preserve_history(self, client, chat_id):
        with patch(
            "app.services.chat_service.ollama_chat_stream",
            side_effect=_fake_stream("回答一"),
        ):
            client.post(f"/api/chats/{chat_id}/stream", json={"content": "问题一"})

        with patch(
            "app.services.chat_service.ollama_chat_stream",
            side_effect=_fake_stream("回答二"),
        ):
            client.post(f"/api/chats/{chat_id}/stream", json={"content": "问题二"})

        msgs = client.get(f"/api/chats/{chat_id}/messages").json()
        assert len(msgs) == 4
        assert msgs[0]["content"] == "问题一"
        assert msgs[1]["content"] == "回答一"
        assert msgs[2]["content"] == "问题二"
        assert msgs[3]["content"] == "回答二"
