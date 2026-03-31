import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

from app.schemas.generations import (
    GenerationCostumeResponse,
    GenerationMockJobResponse,
    GenerationParameterDefaults,
    GenerationPromptSources,
    GenerationSubmitRequest,
    GenerationWorkbenchResponse,
)
from app.services.characters import CharacterNotFoundError, CharacterServiceError, get_character_detail
from app.services.task_queue import TaskSnapshot


BASE_COSTUME_NAME = "基础造型"
DEFAULT_TAG_OPTIONS = ["封面图", "表情包", "周边", "预告图"]
DEFAULT_PARAMETER_WIDTH = 1024
DEFAULT_PARAMETER_HEIGHT = 1024
DEFAULT_PARAMETER_STEPS = 28
DEFAULT_PARAMETER_SAMPLER = "DPM++ 2M Karras"
DEFAULT_PARAMETER_CFG_SCALE = 3.5
DEFAULT_PARAMETER_SEED = None
DEFAULT_PARAMETER_LORA_WEIGHT = 0.85


class GenerationContractValidationError(ValueError):
    """Raised when generation submission does not satisfy the contract."""


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _costume_row_to_response(
    row: sqlite3.Row,
    is_default: bool,
) -> GenerationCostumeResponse:
    return GenerationCostumeResponse(
        id=row["id"],
        name=row["name"],
        costume_prompt=row["costume_prompt"],
        is_default=is_default,
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
            _costume_row_to_response(
                costume_row,
                costume_row["id"] == selected_costume["id"],
            )
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


def build_generation_workbench_contract(
    connection: sqlite3.Connection,
    character_id: str,
) -> GenerationWorkbenchResponse:
    return get_generation_workbench_contract(connection, character_id)


def validate_generation_submission(
    contract: GenerationWorkbenchResponse,
    payload: GenerationSubmitRequest,
) -> None:
    if payload.character_id != contract.character_id:
        raise GenerationContractValidationError("提交的角色信息与当前上下文不一致，请刷新后重试。")

    if not contract.can_generate:
        raise GenerationContractValidationError(
            contract.blocking_reason or "该角色当前还不能生成，请先完成视觉训练。"
        )

    has_costume = any(costume.id == payload.costume_id for costume in contract.costumes)
    if not has_costume:
        raise GenerationContractValidationError("所选造型不存在，请刷新后重试。")


def build_mock_generation_job(
    task: TaskSnapshot,
    payload: GenerationSubmitRequest,
) -> GenerationMockJobResponse:
    stage = (
        "queued"
        if task.status == "pending"
        else "running"
        if task.status == "running"
        else "completed"
        if task.status == "completed"
        else "failed"
    )

    return GenerationMockJobResponse(
        id=task.id,
        task_id=task.id,
        character_id=payload.character_id,
        costume_id=payload.costume_id,
        scene_prompt=payload.scene_prompt,
        status=task.status,
        stage=stage,
        progress=task.progress,
        message=task.message,
        error=task.error,
        tags=payload.tags,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )
