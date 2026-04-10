"""Automatic long-term memory extraction from recent chat turns."""
from __future__ import annotations

import json
import logging
import re
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.db.connection import connect_database
from app.services.llm_catalog import is_catalog_model
from app.services.ollama_service import chat_stream as ollama_chat_stream

DEFAULT_EXTRACTION_MODEL = "qwen2.5:7b-instruct-q4_K_M"
DEFAULT_RECENT_MESSAGE_LIMIT = 6
MAX_ITEMS_PER_EXTRACTION = 2
MIN_CONFIDENCE = 0.78
MIN_IMPORTANCE = 3
MAX_CONTENT_LENGTH = 300
ALLOWED_KINDS = {"fact", "preference", "relationship", "event"}

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class RecentChatMessage:
    role: str
    content: str


@dataclass(slots=True)
class ExistingMemory:
    id: str
    kind: str
    content: str


@dataclass(slots=True)
class MemoryCandidate:
    kind: str
    content: str
    importance: int
    confidence: float
    reason: str


@dataclass(slots=True)
class MemoryExtractionResult:
    inserted_count: int
    skipped_count: int
    candidates_count: int


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _normalize_memory_text(value: str) -> str:
    lowered = value.strip().lower()
    lowered = re.sub(r"\s+", " ", lowered)
    return re.sub(r"[^\w\u4e00-\u9fff]+", "", lowered)


def _looks_like_duplicate(content: str, existing_contents: list[str]) -> bool:
    normalized = _normalize_memory_text(content)
    if not normalized:
        return True

    for existing in existing_contents:
        if normalized == existing:
            return True
        if len(normalized) >= 8 and (normalized in existing or existing in normalized):
            return True
        if SequenceMatcher(None, normalized, existing).ratio() >= 0.92:
            return True
    return False


class MemoryExtractionService:
    def __init__(self, *, db_path: Path) -> None:
        self._db_path = db_path

    @contextmanager
    def _conn(self):
        with connect_database(self._db_path) as conn:
            conn.row_factory = sqlite3.Row
            yield conn

    async def extract_from_chat_turn(
        self,
        *,
        character_id: str,
        chat_id: str,
        latest_user_message: str,
        latest_assistant_message: str,
    ) -> MemoryExtractionResult:
        recent_messages = self._load_recent_messages(chat_id)
        existing_memories = self._load_existing_memories(character_id)
        model_name = self._resolve_model_name(chat_id, character_id)

        prompt_messages = self._build_prompt_messages(
            character_id=character_id,
            chat_id=chat_id,
            latest_user_message=latest_user_message,
            latest_assistant_message=latest_assistant_message,
            recent_messages=recent_messages,
            existing_memories=existing_memories,
        )
        raw_output = await self._call_ollama(model_name=model_name, messages=prompt_messages)
        candidates = self._parse_candidates(raw_output)

        latest_existing_memories = self._load_existing_memories(character_id)
        accepted_candidates = self._filter_candidates(candidates, latest_existing_memories)
        inserted_count = self._insert_memories(
            character_id=character_id,
            chat_id=chat_id,
            candidates=accepted_candidates,
        )
        return MemoryExtractionResult(
            inserted_count=inserted_count,
            skipped_count=max(0, len(candidates) - inserted_count),
            candidates_count=len(candidates),
        )

    def _load_recent_messages(self, chat_id: str) -> list[RecentChatMessage]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT role, content
                FROM character_chat_messages
                WHERE chat_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (chat_id, DEFAULT_RECENT_MESSAGE_LIMIT),
            ).fetchall()
        return [
            RecentChatMessage(role=row["role"], content=row["content"])
            for row in reversed(rows)
            if row["role"] in {"user", "assistant"} and str(row["content"]).strip()
        ]

    def _load_existing_memories(self, character_id: str) -> list[ExistingMemory]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT id, kind, content
                FROM character_memories
                WHERE character_id = ?
                ORDER BY pinned DESC, importance DESC, created_at DESC
                """,
                (character_id,),
            ).fetchall()
        return [
            ExistingMemory(id=row["id"], kind=row["kind"], content=row["content"])
            for row in rows
            if str(row["content"]).strip()
        ]

    def _resolve_model_name(self, chat_id: str, character_id: str) -> str:
        # Fine-tuned character models are trained for roleplay and often fail to
        # produce structured JSON reliably.  Only use general-purpose catalog
        # models for extraction; fall back to the hardcoded default otherwise.
        with self._conn() as conn:
            row = conn.execute(
                """
                SELECT
                    ch.base_model_name,
                    c.default_base_model_name
                FROM character_chats ch
                JOIN characters c ON c.id = ch.character_id
                WHERE ch.id = ? AND ch.character_id = ?
                """,
                (chat_id, character_id),
            ).fetchone()
            if row is None:
                return DEFAULT_EXTRACTION_MODEL

            session_base_model = str(row["base_model_name"] or "").strip()
            if session_base_model and is_catalog_model(session_base_model):
                return session_base_model

            character_default_model = str(row["default_base_model_name"] or "").strip()
            if character_default_model and is_catalog_model(character_default_model):
                return character_default_model

        return DEFAULT_EXTRACTION_MODEL

    def _build_prompt_messages(
        self,
        *,
        character_id: str,
        chat_id: str,
        latest_user_message: str,
        latest_assistant_message: str,
        recent_messages: list[RecentChatMessage],
        existing_memories: list[ExistingMemory],
    ) -> list[dict[str, str]]:
        recent_lines = [
            f"- {message.role}: {message.content.strip()}"
            for message in recent_messages
            if message.content.strip()
        ]
        existing_lines = [
            f"- [{memory.kind}] {memory.content.strip()}"
            for memory in existing_memories
            if memory.content.strip()
        ]

        user_prompt = "\n".join(
            [
                f"character_id: {character_id}",
                f"chat_id: {chat_id}",
                f"latest_user_message: {latest_user_message.strip()}",
                f"latest_assistant_message: {latest_assistant_message.strip()}",
                "recent_messages:",
                "\n".join(recent_lines) if recent_lines else "- (none)",
                "existing_memories:",
                "\n".join(existing_lines) if existing_lines else "- (none)",
            ]
        )

        return [
            {
                "role": "system",
                "content": (
                    "你是长期记忆提炼器。"
                    "你的任务是从最近对话中提炼 0 到 2 条对未来对话长期有效的信息。"
                    "只允许提炼稳定事实、长期偏好、稳定关系、重要且会持续影响对话的事件。"
                    "不要提炼临时情绪、一次性安排、短期任务、模糊猜测。"
                    "如果没有合适内容，返回 {\"items\": []}。"
                    "必须只输出 JSON，不要输出解释、Markdown 或代码块。"
                    "JSON 格式固定为 "
                    "{\"items\":[{\"kind\":\"fact|preference|relationship|event\",\"content\":\"...\",\"importance\":1,\"pinned\":false,\"confidence\":0.0,\"reason\":\"...\"}]}"
                ),
            },
            {"role": "user", "content": user_prompt},
        ]

    async def _call_ollama(self, *, model_name: str, messages: list[dict[str, str]]) -> str:
        chunks: list[str] = []
        async for chunk in ollama_chat_stream(model_name, messages):
            chunks.append(chunk)
        return "".join(chunks).strip()

    def _parse_candidates(self, raw_output: str) -> list[MemoryCandidate]:
        payload = self._load_json_payload(raw_output)
        items = payload.get("items")
        if not isinstance(items, list):
            return []

        candidates: list[MemoryCandidate] = []
        for item in items[:MAX_ITEMS_PER_EXTRACTION]:
            if not isinstance(item, dict):
                continue
            kind = str(item.get("kind", "")).strip().lower()
            content = re.sub(r"\s+", " ", str(item.get("content", "")).strip())
            reason = str(item.get("reason", "")).strip()
            try:
                importance = int(item.get("importance", 0))
            except (TypeError, ValueError):
                importance = 0
            try:
                confidence = float(item.get("confidence", 0.0))
            except (TypeError, ValueError):
                confidence = 0.0

            candidates.append(
                MemoryCandidate(
                    kind=kind,
                    content=content,
                    importance=importance,
                    confidence=confidence,
                    reason=reason,
                )
            )
        return candidates

    def _load_json_payload(self, raw_output: str) -> dict[str, Any]:
        text = raw_output.strip()
        if not text:
            return {"items": []}

        candidates = [text]
        fenced_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
        if fenced_match:
            candidates.append(fenced_match.group(1))

        brace_match = re.search(r"(\{.*\})", text, re.S)
        if brace_match:
            candidates.append(brace_match.group(1))

        for candidate in candidates:
            try:
                payload = json.loads(candidate)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                return payload

        logger.warning("memory_extraction.invalid_json raw_output=%r", raw_output[:500])
        return {"items": []}

    def _filter_candidates(
        self,
        candidates: list[MemoryCandidate],
        existing_memories: list[ExistingMemory],
    ) -> list[MemoryCandidate]:
        accepted: list[MemoryCandidate] = []
        known_contents = [
            _normalize_memory_text(memory.content)
            for memory in existing_memories
            if _normalize_memory_text(memory.content)
        ]

        for candidate in candidates:
            if candidate.kind not in ALLOWED_KINDS:
                continue
            if candidate.confidence < MIN_CONFIDENCE:
                continue
            if candidate.importance < MIN_IMPORTANCE:
                continue
            if not candidate.content or len(candidate.content) > MAX_CONTENT_LENGTH:
                continue
            if _looks_like_duplicate(candidate.content, known_contents):
                continue
            accepted.append(candidate)
            known_contents.append(_normalize_memory_text(candidate.content))

        return accepted[:MAX_ITEMS_PER_EXTRACTION]

    def _insert_memories(
        self,
        *,
        character_id: str,
        chat_id: str,
        candidates: list[MemoryCandidate],
    ) -> int:
        if not candidates:
            return 0

        now = _utc_now()
        with self._conn() as conn:
            conn.executemany(
                """
                INSERT INTO character_memories (
                    id,
                    character_id,
                    kind,
                    content,
                    importance,
                    pinned,
                    source,
                    source_chat_id,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, 0, 'auto_extracted', ?, ?, ?)
                """,
                [
                    (
                        str(uuid4()),
                        character_id,
                        candidate.kind,
                        candidate.content,
                        candidate.importance,
                        chat_id,
                        now,
                        now,
                    )
                    for candidate in candidates
                ],
            )
            conn.commit()
        return len(candidates)


def create_memory_extraction_service(*, db_path: Path) -> MemoryExtractionService:
    return MemoryExtractionService(db_path=db_path)
