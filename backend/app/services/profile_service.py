"""Profile service — CRUD for character_profile and character_memories."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.db.connection import connect_database
from app.schemas.profile import (
    CharacterProfileResponse,
    CharacterProfileUpdateRequest,
    MemoryCreateRequest,
    MemoryListResponse,
    MemoryResponse,
    MemoryUpdateRequest,
)


class ProfileServiceError(Exception):
    pass


class ProfileCharacterNotFoundError(ProfileServiceError):
    pass


class MemoryNotFoundError(ProfileServiceError):
    pass


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _dumps_json(value: object | None) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)


def _loads_json(value: str | None) -> object | None:
    if value is None:
        return None
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return None


def _row_to_profile(row: sqlite3.Row) -> CharacterProfileResponse:
    trigger_rules_raw = _loads_json(row["trigger_rules"])
    trigger_rules = trigger_rules_raw if isinstance(trigger_rules_raw, list) else None

    return CharacterProfileResponse(
        characterId=row["character_id"],
        updatedAt=row["updated_at"],
        profileVersion=row["profile_version"],
        personaSummary=row["persona_summary"],
        personalityTraits=_loads_json(row["personality_traits"]),
        speakingStyle=row["speaking_style"],
        backstory=row["backstory"],
        valuesBeliefs=row["values_beliefs"],
        quirks=row["quirks"],
        likes=_loads_json(row["likes"]),
        dislikes=_loads_json(row["dislikes"]),
        worldName=row["world_name"],
        worldSetting=row["world_setting"],
        worldRules=row["world_rules"],
        worldKeyEvents=row["world_key_events"],
        userAddress=row["user_address"] or "你",
        selfAddress=row["self_address"] or "我",
        catchphrases=_loads_json(row["catchphrases"]),
        forbiddenWords=_loads_json(row["forbidden_words"]),
        emotionDefault=row["emotion_default"],
        triggerRules=trigger_rules,
    )


def _row_to_memory(row: sqlite3.Row) -> MemoryResponse:
    return MemoryResponse(
        id=row["id"],
        characterId=row["character_id"],
        kind=row["kind"],
        content=row["content"],
        importance=row["importance"],
        pinned=bool(row["pinned"]),
        source=row["source"],
        createdAt=row["created_at"],
        updatedAt=row["updated_at"],
        lastUsedAt=row["last_used_at"],
        hitCount=row["hit_count"],
    )


class ProfileService:
    def __init__(self, *, db_path: Path) -> None:
        self._db_path = db_path

    def _check_character(self, conn: sqlite3.Connection, character_id: str) -> None:
        if not conn.execute(
            "SELECT 1 FROM characters WHERE id = ?", (character_id,)
        ).fetchone():
            raise ProfileCharacterNotFoundError("角色不存在")

    # ── Profile ────────────────────────────────────────────────────────────────

    def get_profile(self, character_id: str) -> CharacterProfileResponse | None:
        conn = connect_database(self._db_path)
        conn.row_factory = sqlite3.Row
        try:
            self._check_character(conn, character_id)
            row = conn.execute(
                "SELECT * FROM character_profile WHERE character_id = ?",
                (character_id,),
            ).fetchone()
            return _row_to_profile(row) if row is not None else None
        finally:
            conn.close()

    def upsert_profile(
        self,
        character_id: str,
        payload: CharacterProfileUpdateRequest,
    ) -> CharacterProfileResponse:
        now = _utc_now()

        trigger_rules_json = None
        if payload.trigger_rules is not None:
            trigger_rules_json = json.dumps(
                [{"trigger": r.trigger, "reaction": r.reaction} for r in payload.trigger_rules],
                ensure_ascii=False,
            )

        conn = connect_database(self._db_path)
        conn.row_factory = sqlite3.Row
        try:
            self._check_character(conn, character_id)

            conn.execute(
                """
                INSERT INTO character_profile (
                    character_id,
                    persona_summary, personality_traits, speaking_style,
                    backstory, values_beliefs, quirks, likes, dislikes,
                    world_name, world_setting, world_rules, world_key_events,
                    user_address, self_address,
                    catchphrases, forbidden_words, emotion_default, trigger_rules,
                    updated_at, profile_version
                ) VALUES (
                    ?,
                    ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?,
                    ?, ?, ?, ?,
                    ?, 1
                )
                ON CONFLICT(character_id) DO UPDATE SET
                    persona_summary    = excluded.persona_summary,
                    personality_traits = excluded.personality_traits,
                    speaking_style     = excluded.speaking_style,
                    backstory          = excluded.backstory,
                    values_beliefs     = excluded.values_beliefs,
                    quirks             = excluded.quirks,
                    likes              = excluded.likes,
                    dislikes           = excluded.dislikes,
                    world_name         = excluded.world_name,
                    world_setting      = excluded.world_setting,
                    world_rules        = excluded.world_rules,
                    world_key_events   = excluded.world_key_events,
                    user_address       = excluded.user_address,
                    self_address       = excluded.self_address,
                    catchphrases       = excluded.catchphrases,
                    forbidden_words    = excluded.forbidden_words,
                    emotion_default    = excluded.emotion_default,
                    trigger_rules      = excluded.trigger_rules,
                    updated_at         = excluded.updated_at,
                    profile_version    = character_profile.profile_version + 1
                """,
                (
                    character_id,
                    payload.persona_summary,
                    _dumps_json(payload.personality_traits),
                    payload.speaking_style,
                    payload.backstory,
                    payload.values_beliefs,
                    payload.quirks,
                    _dumps_json(payload.likes),
                    _dumps_json(payload.dislikes),
                    payload.world_name,
                    payload.world_setting,
                    payload.world_rules,
                    payload.world_key_events,
                    payload.user_address,
                    payload.self_address,
                    _dumps_json(payload.catchphrases),
                    _dumps_json(payload.forbidden_words),
                    payload.emotion_default,
                    trigger_rules_json,
                    now,
                ),
            )
            conn.commit()

            row = conn.execute(
                "SELECT * FROM character_profile WHERE character_id = ?",
                (character_id,),
            ).fetchone()
            return _row_to_profile(row)
        except ProfileServiceError:
            raise
        except sqlite3.DatabaseError as exc:
            conn.rollback()
            raise ProfileServiceError("人设保存失败，请稍后重试") from exc
        finally:
            conn.close()

    # ── Memories ────────────────────────────────────────────────────────────────

    def list_memories(self, character_id: str) -> list[MemoryResponse]:
        conn = connect_database(self._db_path)
        conn.row_factory = sqlite3.Row
        try:
            self._check_character(conn, character_id)
            rows = conn.execute(
                """
                SELECT * FROM character_memories
                WHERE character_id = ?
                ORDER BY pinned DESC, importance DESC, created_at DESC
                """,
                (character_id,),
            ).fetchall()
            return [_row_to_memory(row) for row in rows]
        finally:
            conn.close()

    def create_memory(self, character_id: str, payload: MemoryCreateRequest) -> MemoryResponse:
        memory_id = str(uuid4())
        now = _utc_now()

        conn = connect_database(self._db_path)
        conn.row_factory = sqlite3.Row
        try:
            self._check_character(conn, character_id)
            conn.execute(
                """
                INSERT INTO character_memories
                    (id, character_id, kind, content, importance, pinned, source, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?)
                """,
                (
                    memory_id,
                    character_id,
                    payload.kind,
                    payload.content,
                    payload.importance,
                    1 if payload.pinned else 0,
                    now,
                    now,
                ),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM character_memories WHERE id = ?", (memory_id,)
            ).fetchone()
            return _row_to_memory(row)
        except ProfileServiceError:
            raise
        except sqlite3.DatabaseError as exc:
            conn.rollback()
            raise ProfileServiceError("记忆添加失败，请稍后重试") from exc
        finally:
            conn.close()

    def update_memory(
        self, character_id: str, memory_id: str, payload: MemoryUpdateRequest
    ) -> MemoryResponse:
        now = _utc_now()

        conn = connect_database(self._db_path)
        conn.row_factory = sqlite3.Row
        try:
            self._check_character(conn, character_id)
            existing = conn.execute(
                "SELECT * FROM character_memories WHERE id = ? AND character_id = ?",
                (memory_id, character_id),
            ).fetchone()
            if existing is None:
                raise MemoryNotFoundError("记忆不存在")

            updates = payload.model_dump(exclude_unset=True)
            if not updates:
                return _row_to_memory(existing)

            set_clauses: list[str] = []
            params: list[object] = []
            if "kind" in updates:
                set_clauses.append("kind = ?")
                params.append(updates["kind"])
            if "content" in updates:
                set_clauses.append("content = ?")
                params.append(updates["content"])
            if "importance" in updates:
                set_clauses.append("importance = ?")
                params.append(updates["importance"])
            if "pinned" in updates:
                set_clauses.append("pinned = ?")
                params.append(1 if updates["pinned"] else 0)
            set_clauses.append("updated_at = ?")
            params.append(now)
            params.append(memory_id)

            conn.execute(
                f"UPDATE character_memories SET {', '.join(set_clauses)} WHERE id = ?",
                tuple(params),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM character_memories WHERE id = ?", (memory_id,)
            ).fetchone()
            return _row_to_memory(row)
        except ProfileServiceError:
            raise
        except sqlite3.DatabaseError as exc:
            conn.rollback()
            raise ProfileServiceError("记忆更新失败，请稍后重试") from exc
        finally:
            conn.close()

    def delete_memory(self, character_id: str, memory_id: str) -> None:
        conn = connect_database(self._db_path)
        try:
            existing = conn.execute(
                "SELECT id FROM character_memories WHERE id = ? AND character_id = ?",
                (memory_id, character_id),
            ).fetchone()
            if existing is None:
                raise MemoryNotFoundError("记忆不存在")
            conn.execute("DELETE FROM character_memories WHERE id = ?", (memory_id,))
            conn.commit()
        except ProfileServiceError:
            raise
        except sqlite3.DatabaseError as exc:
            conn.rollback()
            raise ProfileServiceError("记忆删除失败，请稍后重试") from exc
        finally:
            conn.close()


def create_profile_service(*, db_path: Path) -> ProfileService:
    return ProfileService(db_path=db_path)
