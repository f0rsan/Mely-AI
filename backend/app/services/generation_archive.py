"""Generation result archiving service — M2-F.

Responsibilities:
- Write image file to ~/.mely/characters/{id}/generations/
- Insert a row into the `generations` table with a full params snapshot
- Insert tags into `generation_tags`
- Return the stored record for the history list

Image handling:
- Accepts base64-encoded PNG bytes (imageDataB64) for self-contained testing.
- In production M2-E/M2-G will pass the real bytes from ComfyUI output.
- Formal archive rejects empty payloads. Placeholder files are not allowed
  in the official generations history.
"""
from __future__ import annotations

import base64
import binascii
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.core.paths import ensure_character_directories
from app.schemas.archive import GenerationArchiveRecord, GenerationArchiveRequest


class GenerationArchiveError(Exception):
    """Raised when archiving fails."""


class GenerationArchiveRequestError(GenerationArchiveError):
    """Raised when archive request payload is invalid."""


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _decode_image_bytes(image_data_b64: str | None) -> bytes:
    """Decode base64 image payload and validate it is non-empty."""
    if image_data_b64 is None or not image_data_b64.strip():
        raise GenerationArchiveRequestError("缺少真实图片数据，无法归档生成结果")

    try:
        image_bytes = base64.b64decode(image_data_b64, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise GenerationArchiveRequestError("图片数据解码失败，请检查图片格式是否正确") from exc

    if not image_bytes:
        raise GenerationArchiveRequestError("生成图片数据为空，无法归档生成结果")

    return image_bytes


def archive_generation(
    connection: sqlite3.Connection,
    data_root: Path,
    request: GenerationArchiveRequest,
) -> GenerationArchiveRecord:
    """Persist a generation result and return the stored record."""
    generation_id = str(uuid4())
    created_at = _utc_now_iso()

    # Ensure character generation directory exists.
    dirs = ensure_character_directories(data_root, request.character_id)
    gen_dir: Path = dirs["generations"]

    image_bytes = _decode_image_bytes(request.image_data_b64)

    # Write image file.
    image_filename = f"{generation_id}.png"
    image_path = gen_dir / image_filename

    try:
        image_path.write_bytes(image_bytes)
    except OSError as exc:
        if image_path.exists():
            image_path.unlink(missing_ok=True)
        raise GenerationArchiveError("生成结果保存失败，请稍后重试") from exc

    output_path = str(image_path)

    # Build params snapshot (stored as JSON string in DB).
    params_snapshot = {
        "assembledPrompt": request.assembled_prompt,
        "negativePrompt": request.negative_prompt,
        "width": request.width,
        "height": request.height,
        "steps": request.steps,
        "sampler": request.sampler,
        "cfgScale": request.cfg_scale,
        "seed": request.seed,
        "loraWeight": request.lora_weight,
    }
    params_json = json.dumps(params_snapshot, ensure_ascii=False)

    try:
        connection.execute(
            """
            INSERT INTO generations (id, character_id, costume_id, type,
                                     params_snapshot, output_path, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                generation_id,
                request.character_id,
                request.costume_id,
                "txt2img",
                params_json,
                output_path,
                created_at,
            ),
        )

        for tag in request.tags:
            connection.execute(
                "INSERT INTO generation_tags (generation_id, tag) VALUES (?, ?)",
                (generation_id, tag),
            )

        connection.commit()
    except sqlite3.DatabaseError as exc:
        connection.rollback()
        # Clean up the image file if DB write failed.
        if image_path.exists():
            image_path.unlink(missing_ok=True)
        raise GenerationArchiveError("生成结果保存失败，请稍后重试") from exc

    return GenerationArchiveRecord(
        id=generation_id,
        characterId=request.character_id,
        costumeId=request.costume_id,
        outputPath=output_path,
        paramsSnapshot=params_snapshot,
        tags=list(request.tags),
        createdAt=created_at,
    )


def get_generation_archive_by_id(
    connection: sqlite3.Connection,
    generation_id: str,
) -> GenerationArchiveRecord | None:
    """Return a single archived generation record, or None if not found."""
    row = connection.execute(
        """
        SELECT id, character_id, costume_id, params_snapshot, output_path, created_at
        FROM generations
        WHERE id = ?
        """,
        (generation_id,),
    ).fetchone()

    if row is None:
        return None

    tags = [
        r["tag"]
        for r in connection.execute(
            "SELECT tag FROM generation_tags WHERE generation_id = ? ORDER BY tag",
            (row["id"],),
        ).fetchall()
    ]
    try:
        params = json.loads(row["params_snapshot"])
    except json.JSONDecodeError:
        params = {}

    return GenerationArchiveRecord(
        id=row["id"],
        characterId=row["character_id"],
        costumeId=row["costume_id"],
        outputPath=row["output_path"],
        paramsSnapshot=params,
        tags=tags,
        createdAt=row["created_at"],
    )


def list_generation_archives(
    connection: sqlite3.Connection,
    character_id: str,
    *,
    limit: int = 50,
    offset: int = 0,
) -> list[GenerationArchiveRecord]:
    """Return archived generations for a character, newest first."""
    rows = connection.execute(
        """
        SELECT id, character_id, costume_id, params_snapshot, output_path, created_at
        FROM generations
        WHERE character_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
        """,
        (character_id, limit, offset),
    ).fetchall()

    records: list[GenerationArchiveRecord] = []
    for row in rows:
        tags = [
            r["tag"]
            for r in connection.execute(
                "SELECT tag FROM generation_tags WHERE generation_id = ? ORDER BY tag",
                (row["id"],),
            ).fetchall()
        ]
        try:
            params = json.loads(row["params_snapshot"])
        except json.JSONDecodeError:
            params = {}

        records.append(
            GenerationArchiveRecord(
                id=row["id"],
                characterId=row["character_id"],
                costumeId=row["costume_id"],
                outputPath=row["output_path"],
                paramsSnapshot=params,
                tags=tags,
                createdAt=row["created_at"],
            )
        )
    return records
