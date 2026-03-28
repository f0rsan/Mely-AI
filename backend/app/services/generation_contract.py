import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

from app.schemas.generations import (
    GenerationCostumeResponse,
    GenerationParameterDefaults,
    GenerationPromptSources,
    GenerationWorkbenchResponse,
)
from app.services.characters import CharacterNotFoundError, CharacterServiceError, get_character_detail


BASE_COSTUME_NAME = "基础造型"
DEFAULT_TAG_OPTIONS = ["封面图", "表情包", "周边", "预告图"]
DEFAULT_PARAMETER_WIDTH = 1024
DEFAULT_PARAMETER_HEIGHT = 1024
DEFAULT_PARAMETER_STEPS = 28
DEFAULT_PARAMETER_SAMPLER = "Euler a"
DEFAULT_PARAMETER_CFG_SCALE = 7.0
DEFAULT_PARAMETER_SEED = -1
DEFAULT_PARAMETER_LORA_WEIGHT = 0.8


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _preview_images_for_costume(
    connection: sqlite3.Connection,
    costume_id: str,
) -> list[str]:
    rows = connection.execute(
        """
        SELECT image_path
        FROM costume_previews
        WHERE costume_id = ?
        ORDER BY COALESCE(sort_order, 0) ASC, id ASC
        """,
        (costume_id,),
    ).fetchall()
    return [row["image_path"] for row in rows]


def _costume_row_to_response(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
) -> GenerationCostumeResponse:
    return GenerationCostumeResponse(
        id=row["id"],
        name=row["name"],
        parent_id=row["parent_id"],
        costume_lora=row["costume_lora"],
        costume_prompt=row["costume_prompt"],
        created_at=row["created_at"],
        preview_images=_preview_images_for_costume(connection, row["id"]),
    )


def _fetch_costumes(
    connection: sqlite3.Connection,
    character_id: str,
) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT id, character_id, name, parent_id, costume_lora, costume_prompt, created_at
        FROM costumes
        WHERE character_id = ?
        ORDER BY created_at ASC, id ASC
        """,
        (character_id,),
    ).fetchall()


def _ensure_base_costume(
    connection: sqlite3.Connection,
    character_id: str,
) -> None:
    existing = _fetch_costumes(connection, character_id)
    if existing:
        return

    costume_id = str(uuid4())
    created_at = _utc_now_iso()

    try:
        connection.execute(
            """
            INSERT INTO costumes (
                id,
                character_id,
                name,
                parent_id,
                costume_lora,
                costume_prompt,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                costume_id,
                character_id,
                BASE_COSTUME_NAME,
                None,
                None,
                "",
                created_at,
            ),
        )
        connection.commit()
    except sqlite3.DatabaseError as exc:
        connection.rollback()
        raise CharacterServiceError("生成工作台加载失败，请稍后重试") from exc


def _resolve_selected_costume(
    costumes: list[sqlite3.Row],
) -> sqlite3.Row:
    for costume in costumes:
        if costume["parent_id"] is None and costume["name"] == BASE_COSTUME_NAME:
            return costume
    return costumes[0]


def _resolve_prompt_sources(
    character_detail,
    selected_costume: sqlite3.Row,
) -> GenerationPromptSources:
    return GenerationPromptSources(
        dna_prompt=character_detail.dna.auto_prompt if character_detail.dna and character_detail.dna.auto_prompt else "",
        trigger_word=(
            character_detail.visual.trigger_word
            if character_detail.visual and character_detail.visual.trigger_word
            else ""
        ),
        costume_prompt=selected_costume["costume_prompt"] or "",
    )


def _resolve_parameter_defaults(character_detail) -> GenerationParameterDefaults:
    lora_weight = DEFAULT_PARAMETER_LORA_WEIGHT
    if character_detail.visual and character_detail.visual.recommended_weight is not None:
        lora_weight = character_detail.visual.recommended_weight

    return GenerationParameterDefaults(
        width=DEFAULT_PARAMETER_WIDTH,
        height=DEFAULT_PARAMETER_HEIGHT,
        steps=DEFAULT_PARAMETER_STEPS,
        sampler=DEFAULT_PARAMETER_SAMPLER,
        cfg_scale=DEFAULT_PARAMETER_CFG_SCALE,
        seed=DEFAULT_PARAMETER_SEED,
        lora_weight=lora_weight,
    )


def _resolve_readiness(character_detail) -> tuple[bool, str | None]:
    visual = character_detail.visual
    if visual is None or visual.training_status != "completed":
        return False, "该角色当前还不能生成，请先完成视觉训练。"

    if not visual.lora_path or not visual.trigger_word:
        return False, "该角色的视觉资产还不完整，请先完成训练结果绑定。"

    return True, None


def get_generation_workbench_contract(
    connection: sqlite3.Connection,
    character_id: str,
) -> GenerationWorkbenchResponse:
    character_detail = get_character_detail(connection, character_id)

    _ensure_base_costume(connection, character_id)
    costume_rows = _fetch_costumes(connection, character_id)
    selected_costume = _resolve_selected_costume(costume_rows)

    can_generate, blocking_reason = _resolve_readiness(character_detail)

    return GenerationWorkbenchResponse(
        character_id=character_detail.id,
        character_name=character_detail.name,
        can_generate=can_generate,
        blocking_reason=blocking_reason,
        costumes=[
            _costume_row_to_response(connection, costume_row)
            for costume_row in costume_rows
        ],
        selected_costume_id=selected_costume["id"],
        prompt_sources=_resolve_prompt_sources(
            character_detail,
            selected_costume,
        ),
        parameter_defaults=_resolve_parameter_defaults(character_detail),
        tag_options=DEFAULT_TAG_OPTIONS,
    )
