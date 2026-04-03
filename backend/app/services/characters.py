import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.core.paths import ensure_character_directories, remove_character_directory
from app.schemas.characters import (
    CharacterCreateRequest,
    CharacterDNAUpdateRequest,
    CharacterDetailResponse,
    CharacterListItemResponse,
)
from app.services.dna_suggestions import build_auto_prompt


class CharacterServiceError(Exception):
    """Base character service exception."""


class CharacterNotFoundError(CharacterServiceError):
    """Raised when the character does not exist."""


class CharacterValidationError(CharacterServiceError):
    """Raised when request data is valid JSON but invalid business input."""


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _dumps_json(value: object | None) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)


def _loads_json(value: str | None) -> object | None:
    if value is None:
        return None
    return json.loads(value)


def upsert_visual_training_state(
    connection: sqlite3.Connection,
    character_id: str,
    *,
    training_status: str,
    training_progress: float,
    training_config: dict[str, Any] | None = None,
) -> None:
    existing = connection.execute(
        "SELECT character_id FROM visual_assets WHERE character_id = ?",
        (character_id,),
    ).fetchone()

    if existing is None:
        connection.execute(
            """
            INSERT INTO visual_assets (
                character_id,
                training_config,
                training_status,
                training_progress
            )
            VALUES (?, ?, ?, ?)
            """,
            (
                character_id,
                _dumps_json(training_config),
                training_status,
                training_progress,
            ),
        )
        return

    connection.execute(
        """
        UPDATE visual_assets
        SET
            training_config = ?,
            training_status = ?,
            training_progress = ?
        WHERE character_id = ?
        """,
        (
            _dumps_json(training_config),
            training_status,
            training_progress,
            character_id,
        ),
    )


def _fetch_character_detail(
    connection: sqlite3.Connection,
    character_id: str,
) -> CharacterDetailResponse | None:
    row = connection.execute(
        """
        SELECT
            c.id,
            c.name,
            c.created_at,
            c.fingerprint,
            d.character_id AS dna_character_id,
            d.hair_color,
            d.eye_color,
            d.skin_tone,
            d.body_type,
            d.style,
            d.extra_tags,
            d.auto_prompt,
            v.character_id AS visual_character_id,
            v.lora_path,
            v.trigger_word,
            v.recommended_weight,
            v.base_checkpoint,
            v.training_config,
            v.training_status,
            v.training_progress,
            vo.character_id AS voice_character_id,
            vo.reference_audio_path,
            vo.tts_engine,
            vo.custom_model_path
        FROM characters AS c
        LEFT JOIN character_dna AS d ON d.character_id = c.id
        LEFT JOIN visual_assets AS v ON v.character_id = c.id
        LEFT JOIN voice_assets AS vo ON vo.character_id = c.id
        WHERE c.id = ?
        """,
        (character_id,),
    ).fetchone()

    if row is None:
        return None

    dna = None
    if row["dna_character_id"] is not None:
        dna = {
            "hairColor": row["hair_color"],
            "eyeColor": row["eye_color"],
            "skinTone": row["skin_tone"],
            "bodyType": row["body_type"],
            "style": row["style"],
            "extraTags": _loads_json(row["extra_tags"]),
            "autoPrompt": row["auto_prompt"],
        }

    visual = None
    if row["visual_character_id"] is not None:
        visual = {
            "loraPath": row["lora_path"],
            "triggerWord": row["trigger_word"],
            "recommendedWeight": row["recommended_weight"],
            "baseCheckpoint": row["base_checkpoint"],
            "trainingConfig": _loads_json(row["training_config"]),
            "trainingStatus": row["training_status"],
            "trainingProgress": row["training_progress"],
        }

    voice = None
    if row["voice_character_id"] is not None:
        voice = {
            "referenceAudioPath": row["reference_audio_path"],
            "ttsEngine": row["tts_engine"],
            "customModelPath": row["custom_model_path"],
        }

    return CharacterDetailResponse(
        id=row["id"],
        name=row["name"],
        createdAt=row["created_at"],
        fingerprint=row["fingerprint"],
        dna=dna,
        visual=visual,
        voice=voice,
    )


def create_character(
    connection: sqlite3.Connection,
    data_root: Path,
    payload: CharacterCreateRequest,
) -> CharacterDetailResponse:
    character_id = str(uuid4())
    created_at = _utc_now_iso()

    try:
        connection.execute(
            """
            INSERT INTO characters (id, name, created_at, fingerprint)
            VALUES (?, ?, ?, ?)
            """,
            (character_id, payload.name, created_at, payload.fingerprint),
        )

        if payload.dna is not None:
            connection.execute(
                """
                INSERT INTO character_dna (
                    character_id,
                    hair_color,
                    eye_color,
                    skin_tone,
                    body_type,
                    style,
                    extra_tags,
                    auto_prompt
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    character_id,
                    payload.dna.hair_color,
                    payload.dna.eye_color,
                    payload.dna.skin_tone,
                    payload.dna.body_type,
                    payload.dna.style,
                    _dumps_json(payload.dna.extra_tags),
                    payload.dna.auto_prompt,
                ),
            )

        if payload.visual is not None:
            connection.execute(
                """
                INSERT INTO visual_assets (
                    character_id,
                    lora_path,
                    trigger_word,
                    recommended_weight,
                    base_checkpoint,
                    training_config,
                    training_status,
                    training_progress
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    character_id,
                    payload.visual.lora_path,
                    payload.visual.trigger_word,
                    payload.visual.recommended_weight,
                    payload.visual.base_checkpoint,
                    _dumps_json(payload.visual.training_config),
                    payload.visual.training_status,
                    payload.visual.training_progress,
                ),
            )

        if payload.voice is not None:
            connection.execute(
                """
                INSERT INTO voice_assets (
                    character_id,
                    reference_audio_path,
                    tts_engine,
                    custom_model_path
                )
                VALUES (?, ?, ?, ?)
                """,
                (
                    character_id,
                    payload.voice.reference_audio_path,
                    payload.voice.tts_engine,
                    payload.voice.custom_model_path,
                ),
            )

        ensure_character_directories(data_root, character_id)
        connection.commit()
    except sqlite3.DatabaseError as exc:
        connection.rollback()
        remove_character_directory(data_root, character_id)
        raise CharacterServiceError("角色创建失败，请稍后重试") from exc
    except OSError as exc:
        connection.rollback()
        remove_character_directory(data_root, character_id)
        raise CharacterServiceError("角色创建失败，请检查本地目录权限后重试") from exc

    created = _fetch_character_detail(connection, character_id)
    if created is None:
        raise CharacterServiceError("角色创建失败，请稍后重试")
    return created


def list_characters(connection: sqlite3.Connection) -> list[CharacterListItemResponse]:
    rows = connection.execute(
        """
        SELECT id, name, created_at, fingerprint
        FROM characters
        ORDER BY created_at DESC, id DESC
        """
    ).fetchall()

    return [
        CharacterListItemResponse(
            id=row["id"],
            name=row["name"],
            createdAt=row["created_at"],
            fingerprint=row["fingerprint"],
        )
        for row in rows
    ]


def get_character_detail(
    connection: sqlite3.Connection, character_id: str
) -> CharacterDetailResponse:
    character = _fetch_character_detail(connection, character_id)
    if character is None:
        raise CharacterNotFoundError("角色不存在")
    return character


def update_character(
    connection: sqlite3.Connection,
    character_id: str,
    *,
    name: str | None = None,
    fingerprint: str | None = None,
    update_name: bool = False,
    update_fingerprint: bool = False,
) -> CharacterDetailResponse:
    if not update_name and not update_fingerprint:
        raise CharacterValidationError("至少需要提供一个可更新字段")
    if update_name and name is None:
        raise CharacterValidationError("角色名称不能为空")

    exists = connection.execute(
        "SELECT id FROM characters WHERE id = ?",
        (character_id,),
    ).fetchone()
    if exists is None:
        raise CharacterNotFoundError("角色不存在")

    updates: list[str] = []
    parameters: list[object] = []

    if update_name:
        updates.append("name = ?")
        parameters.append(name)

    if update_fingerprint:
        updates.append("fingerprint = ?")
        parameters.append(fingerprint)

    parameters.append(character_id)

    try:
        connection.execute(
            f"UPDATE characters SET {', '.join(updates)} WHERE id = ?",
            tuple(parameters),
        )
        connection.commit()
    except sqlite3.DatabaseError as exc:
        connection.rollback()
        raise CharacterServiceError("角色更新失败，请稍后重试") from exc

    updated = _fetch_character_detail(connection, character_id)
    if updated is None:
        raise CharacterNotFoundError("角色不存在")
    return updated


def upsert_character_dna(
    connection: sqlite3.Connection,
    character_id: str,
    payload: CharacterDNAUpdateRequest,
) -> CharacterDetailResponse:
    exists = connection.execute(
        "SELECT id FROM characters WHERE id = ?",
        (character_id,),
    ).fetchone()
    if exists is None:
        raise CharacterNotFoundError("角色不存在")

    auto_prompt = build_auto_prompt(
        hair_color=payload.hair_color,
        eye_color=payload.eye_color,
        skin_tone=payload.skin_tone,
        body_type=payload.body_type,
        style=payload.style,
        extra_tags=payload.extra_tags,
    )

    try:
        connection.execute(
            """
            INSERT INTO character_dna (
                character_id,
                hair_color,
                eye_color,
                skin_tone,
                body_type,
                style,
                extra_tags,
                auto_prompt
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(character_id) DO UPDATE SET
                hair_color = excluded.hair_color,
                eye_color = excluded.eye_color,
                skin_tone = excluded.skin_tone,
                body_type = excluded.body_type,
                style = excluded.style,
                extra_tags = excluded.extra_tags,
                auto_prompt = excluded.auto_prompt
            """,
            (
                character_id,
                payload.hair_color,
                payload.eye_color,
                payload.skin_tone,
                payload.body_type,
                payload.style,
                _dumps_json(payload.extra_tags),
                auto_prompt,
            ),
        )
        connection.commit()
    except sqlite3.DatabaseError as exc:
        connection.rollback()
        raise CharacterServiceError("DNA 保存失败，请稍后重试") from exc

    updated = _fetch_character_detail(connection, character_id)
    if updated is None:
        raise CharacterServiceError("DNA 保存失败，请稍后重试")
    return updated


def delete_character(
    connection: sqlite3.Connection,
    data_root: Path,
    character_id: str,
) -> None:
    exists = connection.execute(
        "SELECT id FROM characters WHERE id = ?",
        (character_id,),
    ).fetchone()
    if exists is None:
        raise CharacterNotFoundError("角色不存在")

    try:
        connection.execute("DELETE FROM characters WHERE id = ?", (character_id,))
        connection.commit()
        remove_character_directory(data_root, character_id)
    except sqlite3.DatabaseError as exc:
        connection.rollback()
        raise CharacterServiceError("角色删除失败，请稍后重试") from exc
    except OSError as exc:
        raise CharacterServiceError("角色已删除，但目录清理失败") from exc
