"""Costume management service — M4-A.

Responsibilities:
- CRUD for costumes (create / list / update / delete)
- Enforce costume tree invariants (root cannot be deleted, children block deletion,
  last costume cannot be deleted)
- Manage filesystem directories for costume previews
- Submit async preview generation tasks to the task queue
"""
from __future__ import annotations

import asyncio
import base64
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.schemas.costume import (
    CostumeCreateRequest,
    CostumePreviewListResponse,
    CostumePreviewResponse,
    CostumeResponse,
    CostumeTreeResponse,
    CostumeUpdateRequest,
)

# Minimal valid 4×4 white PNG (base64-encoded).
PLACEHOLDER_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAC0lEQVQI12NgAAIABQ"
    "AABjkB6QAAAABJRU5ErkJggg=="
)


# ---------------------------------------------------------------------------
# Custom exceptions
# ---------------------------------------------------------------------------


class CostumeNotFoundError(Exception):
    """Raised when the requested costume does not exist."""


class CostumeDeleteForbiddenError(Exception):
    """Raised when a delete operation is not allowed by business rules."""


class CostumeParentNotFoundError(Exception):
    """Raised when the specified parent costume does not exist or belongs to another character."""


class CostumeServiceError(Exception):
    """Generic service-level error for unexpected failures."""


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _row_to_response(row: sqlite3.Row, preview_count: int) -> CostumeResponse:
    return CostumeResponse(
        id=row["id"],
        characterId=row["character_id"],
        name=row["name"],
        parentId=row["parent_id"],
        costumeLora=row["costume_lora"],
        costumePrompt=row["costume_prompt"],
        isRoot=row["parent_id"] is None,
        previewCount=preview_count,
        createdAt=row["created_at"],
    )


# ---------------------------------------------------------------------------
# Service functions
# ---------------------------------------------------------------------------


def create_costume(
    connection: sqlite3.Connection,
    data_root: Path,
    character_id: str,
    request: CostumeCreateRequest,
) -> CostumeResponse:
    """Create a new costume for the given character."""
    # Verify character exists.
    char_row = connection.execute(
        "SELECT id FROM characters WHERE id = ?", (character_id,)
    ).fetchone()
    if char_row is None:
        from app.services.characters import CharacterNotFoundError
        raise CharacterNotFoundError("角色不存在，请刷新后重试。")

    # If parent_id given: verify parent exists AND belongs to same character.
    if request.parent_id is not None:
        parent_row = connection.execute(
            "SELECT id, character_id FROM costumes WHERE id = ?", (request.parent_id,)
        ).fetchone()
        if parent_row is None or parent_row["character_id"] != character_id:
            raise CostumeParentNotFoundError("父造型不存在或不属于该角色，请刷新后重试。")

    costume_id = str(uuid4())
    created_at = _utc_now_iso()

    connection.execute(
        """
        INSERT INTO costumes (id, character_id, name, parent_id, costume_lora, costume_prompt, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            costume_id,
            character_id,
            request.name,
            request.parent_id,
            None,
            request.costume_prompt,
            created_at,
        ),
    )

    # Create preview directory.
    preview_dir = data_root / "characters" / character_id / "costumes" / costume_id / "previews"
    preview_dir.mkdir(parents=True, exist_ok=True)

    connection.commit()

    return CostumeResponse(
        id=costume_id,
        characterId=character_id,
        name=request.name,
        parentId=request.parent_id,
        costumeLora=None,
        costumePrompt=request.costume_prompt,
        isRoot=request.parent_id is None,
        previewCount=0,
        createdAt=created_at,
    )


def list_costumes(
    connection: sqlite3.Connection,
    character_id: str,
) -> CostumeTreeResponse:
    """Return all costumes for a character as a flat list (frontend builds the tree)."""
    # Verify character exists.
    char_row = connection.execute(
        "SELECT id FROM characters WHERE id = ?", (character_id,)
    ).fetchone()
    if char_row is None:
        from app.services.characters import CharacterNotFoundError
        raise CharacterNotFoundError("角色不存在，请刷新后重试。")

    rows = connection.execute(
        """
        SELECT c.id, c.character_id, c.name, c.parent_id, c.costume_lora,
               c.costume_prompt, c.created_at,
               COUNT(cp.id) AS preview_count
        FROM costumes c
        LEFT JOIN costume_previews cp ON cp.costume_id = c.id
        WHERE c.character_id = ?
        GROUP BY c.id
        ORDER BY c.created_at ASC
        """,
        (character_id,),
    ).fetchall()

    costumes = [_row_to_response(row, row["preview_count"]) for row in rows]
    return CostumeTreeResponse(
        characterId=character_id,
        costumes=costumes,
        total=len(costumes),
    )


def update_costume(
    connection: sqlite3.Connection,
    costume_id: str,
    request: CostumeUpdateRequest,
) -> CostumeResponse:
    """Update a costume's name and/or prompt."""
    row = connection.execute(
        "SELECT * FROM costumes WHERE id = ?", (costume_id,)
    ).fetchone()
    if row is None:
        raise CostumeNotFoundError("造型不存在，请刷新后重试。")

    # Build partial UPDATE only for non-None fields.
    updates: list[tuple[str, object]] = []
    if request.name is not None:
        updates.append(("name", request.name))
    if request.costume_prompt is not None:
        updates.append(("costume_prompt", request.costume_prompt))

    if updates:
        set_clause = ", ".join(f"{col} = ?" for col, _ in updates)
        values = [v for _, v in updates] + [costume_id]
        connection.execute(
            f"UPDATE costumes SET {set_clause} WHERE id = ?", values
        )
        connection.commit()

    # Re-fetch updated row + preview count.
    updated_row = connection.execute(
        """
        SELECT c.id, c.character_id, c.name, c.parent_id, c.costume_lora,
               c.costume_prompt, c.created_at,
               COUNT(cp.id) AS preview_count
        FROM costumes c
        LEFT JOIN costume_previews cp ON cp.costume_id = c.id
        WHERE c.id = ?
        GROUP BY c.id
        """,
        (costume_id,),
    ).fetchone()

    return _row_to_response(updated_row, updated_row["preview_count"])


def delete_costume(
    connection: sqlite3.Connection,
    data_root: Path,
    costume_id: str,
) -> None:
    """Delete a costume, enforcing business rules."""
    row = connection.execute(
        "SELECT * FROM costumes WHERE id = ?", (costume_id,)
    ).fetchone()
    if row is None:
        raise CostumeNotFoundError("造型不存在，请刷新后重试。")

    # RULE 1: root costumes (parent_id IS NULL) cannot be deleted.
    if row["parent_id"] is None:
        raise CostumeDeleteForbiddenError("根造型不可删除")

    # RULE 2: costumes with children cannot be deleted.
    child_count = connection.execute(
        "SELECT COUNT(*) AS cnt FROM costumes WHERE parent_id = ?", (costume_id,)
    ).fetchone()["cnt"]
    if child_count > 0:
        raise CostumeDeleteForbiddenError("请先删除该造型的所有子造型")

    # RULE 3: last costume cannot be deleted.
    total_count = connection.execute(
        "SELECT COUNT(*) AS cnt FROM costumes WHERE character_id = ?",
        (row["character_id"],),
    ).fetchone()["cnt"]
    if total_count <= 1:
        raise CostumeDeleteForbiddenError("角色至少需要保留一个造型")

    # DELETE costume (cascade deletes costume_previews via FK).
    connection.execute("DELETE FROM costumes WHERE id = ?", (costume_id,))

    # Remove preview directory if it exists.
    costume_dir = data_root / "characters" / row["character_id"] / "costumes" / costume_id
    if costume_dir.exists():
        shutil.rmtree(costume_dir)

    connection.commit()


def list_costume_previews(
    connection: sqlite3.Connection,
    costume_id: str,
) -> CostumePreviewListResponse:
    """Return all previews for a costume ordered by sort_order."""
    rows = connection.execute(
        """
        SELECT id, costume_id, image_path, sort_order
        FROM costume_previews
        WHERE costume_id = ?
        ORDER BY sort_order ASC
        """,
        (costume_id,),
    ).fetchall()

    previews = [
        CostumePreviewResponse(
            id=row["id"],
            costumeId=row["costume_id"],
            imagePath=row["image_path"],
            sortOrder=row["sort_order"] or 0,
        )
        for row in rows
    ]
    return CostumePreviewListResponse(costumeId=costume_id, previews=previews)


async def submit_preview_generation(
    connection: sqlite3.Connection,
    data_root: Path,
    costume_id: str,
    character_id: str,
    task_queue,
) -> list[str]:
    """Submit 4 preview generation tasks and return their task IDs."""
    # Verify costume exists.
    row = connection.execute(
        "SELECT id FROM costumes WHERE id = ?", (costume_id,)
    ).fetchone()
    if row is None:
        raise CostumeNotFoundError("造型不存在，请刷新后重试。")

    preview_dir = data_root / "characters" / character_id / "costumes" / costume_id / "previews"
    preview_dir.mkdir(parents=True, exist_ok=True)

    task_ids: list[str] = []

    for i in range(4):
        preview_id = str(uuid4())
        image_filename = f"{preview_id}.png"
        image_path = preview_dir / image_filename
        sort_order = i

        async def make_runner(p_id: str, i_path: Path, s_order: int):
            async def runner(report):
                await asyncio.sleep(0.05)  # brief placeholder delay
                # Write placeholder PNG.
                i_path.write_bytes(PLACEHOLDER_PNG)
                # Insert into costume_previews.
                with connection:
                    connection.execute(
                        """
                        INSERT OR IGNORE INTO costume_previews (id, costume_id, image_path, sort_order)
                        VALUES (?, ?, ?, ?)
                        """,
                        (p_id, costume_id, str(i_path), s_order),
                    )
                await report(100, "预览图生成完成")
            return runner

        runner = await make_runner(preview_id, image_path, sort_order)
        snapshot = await task_queue.submit(
            name=f"generation-preview-{costume_id}-{i}",
            runner=runner,
            category="gpu_exclusive",
            initial_message="预览图生成任务已提交",
        )
        task_ids.append(snapshot.id)

    return task_ids
