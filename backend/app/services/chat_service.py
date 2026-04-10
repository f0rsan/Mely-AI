"""Character chat service.

Manages chat sessions and message persistence.
Delegates LLM streaming to ollama_service.chat_stream.

Sessions are tied to a character and optionally to a private LLM model.
If no private model is selected the base model is used.
"""
from __future__ import annotations

import asyncio
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
from app.services.llm_catalog import is_catalog_model, is_catalog_vision_model
from app.services.memory_extraction_service import create_memory_extraction_service
from app.services.persona_assembler import (
    DEFAULT_SYSTEM_PROMPT,
    build_memory_block_with_metadata,
    build_system_prompt_with_metadata,
    record_memory_hits,
)
from app.services.ollama_service import (
    OllamaModelNotFoundError,
    OllamaNotRunningError,
    chat_stream as ollama_chat_stream,
)

DEFAULT_BASE_MODEL = "qwen2.5:7b-instruct-q4_K_M"

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


class ChatInvalidBaseModelError(ChatError):
    """Selected base model is invalid for chat."""


# ── Domain records ─────────────────────────────────────────────────────────────

@dataclass(slots=True)
class ChatSession:
    id: str
    character_id: str
    llm_model_id: str | None
    base_model_name: str | None
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "characterId": self.character_id,
            "llmModelId": self.llm_model_id,
            "baseModelName": self.base_model_name,
            "createdAt": self.created_at,
        }


@dataclass(slots=True)
class ChatMessage:
    id: str
    chat_id: str
    role: str       # "user" | "assistant" | "system"
    content: str
    created_at: str
    images: list[str] | None = None

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
    base_model_name: str | None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _row_to_session(row: sqlite3.Row) -> ChatSession:
    return ChatSession(
        id=row["id"],
        character_id=row["character_id"],
        llm_model_id=row["llm_model_id"],
        base_model_name=row["base_model_name"],
        created_at=row["created_at"],
    )


def _row_to_message(row: sqlite3.Row) -> ChatMessage:
    images: list[str] | None = None
    raw_images_json = row["images_json"] if "images_json" in row.keys() else None
    if isinstance(raw_images_json, str) and raw_images_json.strip():
        try:
            decoded_images = json.loads(raw_images_json)
        except json.JSONDecodeError:
            decoded_images = None
        if isinstance(decoded_images, list):
            normalized_images = [
                image.strip()
                for image in decoded_images
                if isinstance(image, str) and image.strip()
            ]
            if normalized_images:
                images = normalized_images

    return ChatMessage(
        id=row["id"],
        chat_id=row["chat_id"],
        role=row["role"],
        content=row["content"],
        created_at=row["created_at"],
        images=images,
    )


# ── Service ────────────────────────────────────────────────────────────────────

class ChatService:
    def __init__(self, *, db_path: Path) -> None:
        self._db_path = db_path
        self._memory_extraction_service = create_memory_extraction_service(db_path=db_path)

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
        base_model_name: str | None = None,
    ) -> dict[str, Any]:
        """Create a new chat session for a character."""
        with self._conn() as conn:
            if not conn.execute(
                "SELECT 1 FROM characters WHERE id = ?", (character_id,)
            ).fetchone():
                raise ChatCharacterNotFoundError("角色不存在")

            # Validate model if provided
            normalized_base_model_name = (
                base_model_name.strip()
                if isinstance(base_model_name, str) and base_model_name.strip()
                else None
            )
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
                # Private model path has highest priority. Ignore base model input.
                normalized_base_model_name = None
            elif normalized_base_model_name is not None and not is_catalog_model(normalized_base_model_name):
                raise ChatInvalidBaseModelError("基础模型不合法，请从模型库中选择可用模型")

            session_id = str(uuid4())
            now = _utc_now()
            conn.execute(
                """
                INSERT INTO character_chats (id, character_id, llm_model_id, base_model_name, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (session_id, character_id, llm_model_id, normalized_base_model_name, now),
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
        return [message.to_dict() for message in self._get_message_history(chat_id)]

    def _get_message_history(self, chat_id: str) -> list[ChatMessage]:
        with self._conn() as conn:
            self._get_session_row(conn, chat_id)  # verify exists
            rows = conn.execute(
                "SELECT * FROM character_chat_messages WHERE chat_id = ? ORDER BY created_at ASC",
                (chat_id,),
            ).fetchall()
            return [_row_to_message(r) for r in rows]

    def delete_session(self, chat_id: str) -> None:
        with self._conn() as conn:
            self._get_session_row(conn, chat_id)
            conn.execute("DELETE FROM character_chats WHERE id = ?", (chat_id,))
            conn.commit()

    def _save_message(
        self,
        chat_id: str,
        role: str,
        content: str,
        images: list[str] | None = None,
    ) -> dict[str, Any]:
        msg_id = str(uuid4())
        now = _utc_now()
        normalized_images = [
            image.strip()
            for image in (images or [])
            if isinstance(image, str) and image.strip()
        ]
        images_json: str | None = None
        if role == "user" and normalized_images:
            images_json = json.dumps(normalized_images, ensure_ascii=False)

        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO character_chat_messages (id, chat_id, role, content, created_at, images_json)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (msg_id, chat_id, role, content, now, images_json),
            )
            conn.commit()
        return ChatMessage(
            id=msg_id,
            chat_id=chat_id,
            role=role,
            content=content,
            created_at=now,
            images=normalized_images or None,
        ).to_dict()

    def _resolve_model_name_and_system_prompt(
        self, chat_id: str, recent_user_message: str | None = None
    ) -> tuple[str, str, list[str]]:
        """Return (ollama_model_name, system_prompt, used_memory_ids) for a chat session.

        When no private model is selected, the system prompt is dynamically assembled
        from the character's profile and memories via persona_assembler.
        When a private (fine-tuned) model is used, the frozen training snapshot is kept
        as the base, and only the memory block is appended dynamically.
        """
        with self._conn() as conn:
            row = self._get_session_row(conn, chat_id)
            llm_model_id = row["llm_model_id"]
            character_id = row["character_id"]
            session_base_model_name = row["base_model_name"]

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
                # Use training snapshot as base; append live memory block
                snapshot = model_row["system_prompt"] or DEFAULT_SYSTEM_PROMPT
                memory_section = build_memory_block_with_metadata(
                    self._db_path,
                    character_id,
                    recent_user_message,
                )
                prompt = f"{snapshot}\n\n{memory_section.text}" if memory_section.text else snapshot
                return (
                    model_row["ollama_model_name"],
                    prompt,
                    memory_section.used_ids,
                )

            # No private model — build system prompt dynamically from profile
            model_name: str
            if isinstance(session_base_model_name, str) and session_base_model_name.strip():
                model_name = session_base_model_name
            else:
                character_row = conn.execute(
                    "SELECT default_base_model_name FROM characters WHERE id = ?",
                    (character_id,),
                ).fetchone()
                character_default = (
                    character_row["default_base_model_name"] if character_row else None
                )
                if (
                    isinstance(character_default, str)
                    and character_default.strip()
                    and is_catalog_model(character_default)
                ):
                    model_name = character_default
                else:
                    model_name = DEFAULT_BASE_MODEL

        assembled = build_system_prompt_with_metadata(
            self._db_path,
            character_id,
            recent_user_message=recent_user_message,
        )
        return model_name, assembled.prompt, assembled.used_memory_ids

    def _model_supports_images(self, context: ChatStreamContext, model_name: str) -> bool:
        if context.llm_model_id:
            # This round does not have reliable capability metadata for private models.
            return False
        return is_catalog_vision_model(model_name)

    def _build_stream_context(self, chat_id: str) -> ChatStreamContext:
        with self._conn() as conn:
            row = self._get_session_row(conn, chat_id)
            return ChatStreamContext(
                chat_id=chat_id,
                character_id=row["character_id"],
                llm_model_id=row["llm_model_id"],
                base_model_name=row["base_model_name"],
            )

    def _log_stream_error(
        self,
        *,
        error_category: str,
        context: ChatStreamContext,
        exc: Exception,
    ) -> None:
        logger.error(
            "chat.stream.error error_category=%s chat_id=%s character_id=%s llm_model_id=%s base_model_name=%s",
            error_category,
            context.chat_id,
            context.character_id or "-",
            context.llm_model_id or "-",
            context.base_model_name or "-",
            exc_info=exc,
        )

    def _sse_payload(self, payload: dict[str, Any]) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    def _build_ollama_messages(
        self,
        *,
        system_prompt: str,
        history: list[ChatMessage],
    ) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
        for message in history:
            if message.role not in ("user", "assistant"):
                continue
            payload: dict[str, Any] = {
                "role": message.role,
                "content": message.content,
            }
            if message.role == "user" and message.images:
                payload["images"] = message.images
            messages.append(payload)
        return messages

    def _schedule_memory_extraction(
        self,
        *,
        character_id: str,
        current_chat_id: str,
        user_content: str,
        assistant_content: str,
    ) -> None:
        try:
            asyncio.create_task(
                self._run_memory_extraction_safely(
                    character_id=character_id,
                    chat_id=current_chat_id,
                    latest_user_message=user_content,
                    latest_assistant_message=assistant_content,
                )
            )
        except Exception as exc:
            logger.error(
                "chat.memory_extraction.schedule_failed chat_id=%s character_id=%s",
                current_chat_id,
                character_id,
                exc_info=exc,
            )

    async def _run_memory_extraction_safely(
        self,
        *,
        character_id: str,
        chat_id: str,
        latest_user_message: str,
        latest_assistant_message: str,
    ) -> None:
        try:
            await self._memory_extraction_service.extract_from_chat_turn(
                character_id=character_id,
                chat_id=chat_id,
                latest_user_message=latest_user_message,
                latest_assistant_message=latest_assistant_message,
            )
        except Exception as exc:
            logger.error(
                "chat.memory_extraction.failed chat_id=%s character_id=%s",
                chat_id,
                character_id,
                exc_info=exc,
            )

    async def stream_reply(
        self,
        chat_id: str,
        user_content: str,
        user_images: list[str] | None = None,
    ) -> AsyncIterator[str]:
        """Save user message, stream assistant reply, save final message.

        Yields SSE-formatted lines:
          data: {"type": "chunk", "content": "..."}\n\n
          data: {"type": "done", "messageId": "..."}\n\n
          data: {"type": "error", "message": "..."}\n\n
        """
        context = ChatStreamContext(
            chat_id=chat_id,
            character_id=None,
            llm_model_id=None,
            base_model_name=None,
        )
        normalized_images = [
            image.strip()
            for image in (user_images or [])
            if isinstance(image, str) and image.strip()
        ]
        if len(normalized_images) > 1:
            yield self._sse_payload({"type": "error", "message": "当前仅支持上传 1 张图片。"})
            return

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

        # Resolve model and validate request before persisting messages.
        try:
            model_name, system_prompt, used_memory_ids = self._resolve_model_name_and_system_prompt(
                chat_id, recent_user_message=user_content
            )
            if normalized_images and not self._model_supports_images(context, model_name):
                yield self._sse_payload(
                    {
                        "type": "error",
                        "message": "当前会话使用的是文本模型，暂不支持图片对话，请切换到多模态模型后重试。",
                    }
                )
                return
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

        # Persist user message after request validation passes.
        try:
            self._save_message(chat_id, "user", user_content, normalized_images)
        except Exception as exc:
            self._log_stream_error(
                error_category="persistence_error",
                context=context,
                exc=exc,
            )
            yield self._sse_payload({"type": "error", "message": "消息保存失败，请稍后重试"})
            return

        # Build message history for context.
        try:
            history = self._get_message_history(chat_id)
            messages = self._build_ollama_messages(system_prompt=system_prompt, history=history)
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
            if used_memory_ids:
                try:
                    record_memory_hits(self._db_path, used_memory_ids)
                except Exception:
                    # Memory usage accounting is best effort and must not break chat replies.
                    pass
            if context.character_id:
                self._schedule_memory_extraction(
                    character_id=context.character_id,
                    current_chat_id=chat_id,
                    user_content=user_content,
                    assistant_content=full_reply,
                )
            yield self._sse_payload({"type": "done", "messageId": saved["id"]})
        else:
            yield self._sse_payload({"type": "done", "messageId": None})


def create_chat_service(*, db_path: Path) -> ChatService:
    return ChatService(db_path=db_path)
