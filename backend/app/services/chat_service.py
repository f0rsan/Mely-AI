"""Character chat service.

Manages chat sessions and message persistence.
Delegates LLM streaming to ollama_service.chat_stream.

Sessions are tied to a character and optionally to a private LLM model.
If no private model is selected the base model is used.
"""
from __future__ import annotations

import json
import logging
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator
from uuid import uuid4

from app.db.connection import connect_database
from app.services.ollama_service import (
    OllamaModelNotFoundError,
    OllamaNotRunningError,
    chat_stream as ollama_chat_stream,
)

DEFAULT_BASE_MODEL = "qwen2.5:7b-instruct-q4_K_M"
DEFAULT_SYSTEM_PROMPT = "你是一个 AI 角色助手，请保持友好和帮助的态度与用户对话。"

logger = logging.getLogger(__name__)


# ── Errors ─────────────────────────────────────────────────────────────────────

class ChatError(Exception):
    """Base chat error."""


class ChatNotFoundError(ChatError):
    """Chat session not found."""


class ChatCharacterNotFoundError(ChatError):
    """Character does not exist."""


class ChatModelNotReadyError(ChatError):
    """Selected LLM model is not in ready status."""


# ── Domain records ─────────────────────────────────────────────────────────────

@dataclass(slots=True)
class ChatSession:
    id: str
    character_id: str
    llm_model_id: str | None
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "characterId": self.character_id,
            "llmModelId": self.llm_model_id,
            "createdAt": self.created_at,
        }


@dataclass(slots=True)
class ChatMessage:
    id: str
    chat_id: str
    role: str       # "user" | "assistant" | "system"
    content: str
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "chatId": self.chat_id,
            "role": self.role,
            "content": self.content,
            "createdAt": self.created_at,
        }


@dataclass(slots=True)
class ChatStreamContext:
    chat_id: str
    character_id: str | None
    llm_model_id: str | None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _row_to_session(row: sqlite3.Row) -> ChatSession:
    return ChatSession(
        id=row["id"],
        character_id=row["character_id"],
        llm_model_id=row["llm_model_id"],
        created_at=row["created_at"],
    )


def _row_to_message(row: sqlite3.Row) -> ChatMessage:
    return ChatMessage(
        id=row["id"],
        chat_id=row["chat_id"],
        role=row["role"],
        content=row["content"],
        created_at=row["created_at"],
    )


# ── Service ────────────────────────────────────────────────────────────────────

class ChatService:
    def __init__(self, *, db_path: Path) -> None:
        self._db_path = db_path

    @contextmanager
    def _conn(self):
        with connect_database(self._db_path) as conn:
            conn.row_factory = sqlite3.Row
            yield conn

    def _get_session_row(self, conn: sqlite3.Connection, chat_id: str) -> sqlite3.Row:
        row = conn.execute(
            "SELECT * FROM character_chats WHERE id = ?", (chat_id,)
        ).fetchone()
        if row is None:
            raise ChatNotFoundError("对话不存在")
        return row

    def create_session(
        self,
        character_id: str,
        llm_model_id: str | None = None,
    ) -> dict[str, Any]:
        """Create a new chat session for a character."""
        with self._conn() as conn:
            if not conn.execute(
                "SELECT 1 FROM characters WHERE id = ?", (character_id,)
            ).fetchone():
                raise ChatCharacterNotFoundError("角色不存在")

            # Validate model if provided
            if llm_model_id is not None:
                model_row = conn.execute(
                    "SELECT character_id, status FROM llm_models WHERE id = ?",
                    (llm_model_id,),
                ).fetchone()
                if model_row is None:
                    raise ChatModelNotReadyError("私有模型不存在，请重新选择模型")
                if model_row["character_id"] != character_id:
                    raise ChatModelNotReadyError("所选私有模型不属于当前角色，请重新选择")
                if model_row["status"] != "ready":
                    raise ChatModelNotReadyError("模型未就绪，请先完成训练或重试注册")

            session_id = str(uuid4())
            now = _utc_now()
            conn.execute(
                "INSERT INTO character_chats (id, character_id, llm_model_id, created_at) VALUES (?, ?, ?, ?)",
                (session_id, character_id, llm_model_id, now),
            )
            conn.commit()

        return self.get_session(session_id)

    def get_session(self, chat_id: str) -> dict[str, Any]:
        with self._conn() as conn:
            row = self._get_session_row(conn, chat_id)
            return _row_to_session(row).to_dict()

    def list_sessions(self, character_id: str) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM character_chats WHERE character_id = ? ORDER BY created_at DESC",
                (character_id,),
            ).fetchall()
            return [_row_to_session(r).to_dict() for r in rows]

    def get_messages(self, chat_id: str) -> list[dict[str, Any]]:
        with self._conn() as conn:
            self._get_session_row(conn, chat_id)  # verify exists
            rows = conn.execute(
                "SELECT * FROM character_chat_messages WHERE chat_id = ? ORDER BY created_at ASC",
                (chat_id,),
            ).fetchall()
            return [_row_to_message(r).to_dict() for r in rows]

    def delete_session(self, chat_id: str) -> None:
        with self._conn() as conn:
            self._get_session_row(conn, chat_id)
            conn.execute("DELETE FROM character_chats WHERE id = ?", (chat_id,))
            conn.commit()

    def _save_message(self, chat_id: str, role: str, content: str) -> dict[str, Any]:
        msg_id = str(uuid4())
        now = _utc_now()
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO character_chat_messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
                (msg_id, chat_id, role, content, now),
            )
            conn.commit()
        return ChatMessage(
            id=msg_id, chat_id=chat_id, role=role, content=content, created_at=now
        ).to_dict()

    def _resolve_model_name_and_system_prompt(
        self, chat_id: str
    ) -> tuple[str, str]:
        """Return (ollama_model_name, system_prompt) for a chat session."""
        with self._conn() as conn:
            row = self._get_session_row(conn, chat_id)
            llm_model_id = row["llm_model_id"]
            character_id = row["character_id"]

            if llm_model_id:
                model_row = conn.execute(
                    "SELECT character_id, ollama_model_name, system_prompt, status FROM llm_models WHERE id = ?",
                    (llm_model_id,),
                ).fetchone()
                if model_row is None:
                    raise ChatModelNotReadyError("会话绑定的私有模型已不存在，请重新选择模型后重试")
                if model_row["character_id"] != character_id:
                    raise ChatModelNotReadyError("会话绑定的私有模型与当前角色不匹配，请重新选择模型后重试")
                if model_row["status"] != "ready":
                    raise ChatModelNotReadyError("会话绑定的私有模型当前不可用，请重新选择模型后重试")
                prompt = model_row["system_prompt"] or DEFAULT_SYSTEM_PROMPT
                return model_row["ollama_model_name"], prompt

        return DEFAULT_BASE_MODEL, DEFAULT_SYSTEM_PROMPT

    def _build_stream_context(self, chat_id: str) -> ChatStreamContext:
        with self._conn() as conn:
            row = self._get_session_row(conn, chat_id)
            return ChatStreamContext(
                chat_id=chat_id,
                character_id=row["character_id"],
                llm_model_id=row["llm_model_id"],
            )

    def _log_stream_error(
        self,
        *,
        error_category: str,
        context: ChatStreamContext,
        exc: Exception,
    ) -> None:
        logger.error(
            "chat.stream.error error_category=%s chat_id=%s character_id=%s llm_model_id=%s",
            error_category,
            context.chat_id,
            context.character_id or "-",
            context.llm_model_id or "-",
            exc_info=exc,
        )

    def _sse_payload(self, payload: dict[str, Any]) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    async def stream_reply(
        self,
        chat_id: str,
        user_content: str,
    ) -> AsyncIterator[str]:
        """Save user message, stream assistant reply, save final message.

        Yields SSE-formatted lines:
          data: {"type": "chunk", "content": "..."}\n\n
          data: {"type": "done", "messageId": "..."}\n\n
          data: {"type": "error", "message": "..."}\n\n
        """
        context = ChatStreamContext(chat_id=chat_id, character_id=None, llm_model_id=None)

        # Load session context first for logs and error stratification.
        try:
            context = self._build_stream_context(chat_id)
        except ChatNotFoundError as exc:
            self._log_stream_error(
                error_category="session_or_model_state_error",
                context=context,
                exc=exc,
            )
            yield self._sse_payload({"type": "error", "message": str(exc)})
            return
        except Exception as exc:
            self._log_stream_error(
                error_category="session_or_model_state_error",
                context=context,
                exc=exc,
            )
            yield self._sse_payload({"type": "error", "message": "对话状态异常，请稍后重试"})
            return

        # Persist user message
        try:
            self._save_message(chat_id, "user", user_content)
        except Exception as exc:
            self._log_stream_error(
                error_category="persistence_error",
                context=context,
                exc=exc,
            )
            yield self._sse_payload({"type": "error", "message": "消息保存失败，请稍后重试"})
            return

        # Build message history for context
        try:
            history = self.get_messages(chat_id)
            model_name, system_prompt = self._resolve_model_name_and_system_prompt(chat_id)
            messages = [{"role": "system", "content": system_prompt}]
            for msg in history:
                if msg["role"] in ("user", "assistant"):
                    messages.append({"role": msg["role"], "content": msg["content"]})
        except ChatModelNotReadyError as exc:
            self._log_stream_error(
                error_category="session_or_model_state_error",
                context=context,
                exc=exc,
            )
            yield self._sse_payload({"type": "error", "message": str(exc)})
            return
        except ChatNotFoundError as exc:
            self._log_stream_error(
                error_category="session_or_model_state_error",
                context=context,
                exc=exc,
            )
            yield self._sse_payload({"type": "error", "message": str(exc)})
            return
        except Exception as exc:
            self._log_stream_error(
                error_category="context_build_error",
                context=context,
                exc=exc,
            )
            yield self._sse_payload({"type": "error", "message": "对话上下文准备失败，请稍后重试"})
            return

        # Stream from Ollama
        full_reply = ""
        try:
            async for chunk in ollama_chat_stream(model_name, messages):
                full_reply += chunk
                yield self._sse_payload({"type": "chunk", "content": chunk})
        except OllamaNotRunningError as exc:
            self._log_stream_error(
                error_category="ollama_not_running",
                context=context,
                exc=exc,
            )
            error_msg = "语言引擎未响应，请确认 Ollama 已启动后重试"
            yield self._sse_payload({"type": "error", "message": error_msg})
            return
        except OllamaModelNotFoundError as exc:
            self._log_stream_error(
                error_category="ollama_model_not_found",
                context=context,
                exc=exc,
            )
            error_msg = "模型未找到，请检查 Ollama 中的模型是否正确加载"
            yield self._sse_payload({"type": "error", "message": error_msg})
            return
        except Exception as exc:
            self._log_stream_error(
                error_category="stream_unknown_error",
                context=context,
                exc=exc,
            )
            error_msg = "对话生成失败，请稍后重试"
            yield self._sse_payload({"type": "error", "message": error_msg})
            return

        # Persist complete assistant reply
        if full_reply:
            try:
                saved = self._save_message(chat_id, "assistant", full_reply)
            except Exception as exc:
                self._log_stream_error(
                    error_category="persistence_error",
                    context=context,
                    exc=exc,
                )
                yield self._sse_payload({"type": "error", "message": "回复保存失败，请稍后重试"})
                return
            yield self._sse_payload({"type": "done", "messageId": saved["id"]})
        else:
            yield self._sse_payload({"type": "done", "messageId": None})


def create_chat_service(*, db_path: Path) -> ChatService:
    return ChatService(db_path=db_path)
