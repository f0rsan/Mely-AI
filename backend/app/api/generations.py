import asyncio
import base64
import json
import sqlite3
import struct
import zlib
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request

from app.api.tasks import resolve_task_queue_from_request
from app.db.connection import connect_database
from app.schemas.archive import GenerationArchiveRequest
from app.schemas.batch import BatchGenerationAcceptedResponse, BatchGenerationRequest, BatchJobItem
from app.schemas.generations import (
    GenerationJobAcceptedResponse,
    GenerationSubmitRequest,
    GenerationWorkbenchResponse,
)
from app.services.characters import CharacterNotFoundError, CharacterServiceError
from app.services.generation_archive import archive_generation
from app.services.generation_contract import (
    GenerationContractValidationError,
    build_mock_generation_job,
    get_generation_workbench_contract,
    validate_generation_submission,
)

router = APIRouter()


def _placeholder_png_b64() -> str:
    """Generate a 64x64 lavender placeholder PNG using stdlib only, returned as base64."""
    W, H = 64, 64
    row = b"\x00" + b"\x99\x88\xcc" * W  # filter byte + RGB lavender pixels
    idat = zlib.compress(row * H)

    def chunk(name: bytes, data: bytes) -> bytes:
        c = name + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", idat)
        + chunk(b"IEND", b"")
    )
    return base64.b64encode(png).decode()


@dataclass(slots=True)
class GenerationRuntime:
    db_path: Path
    data_root: Path


def _resolve_runtime(request: Request) -> GenerationRuntime:
    bootstrap = getattr(request.app.state, "bootstrap", None)
    if bootstrap is None or bootstrap.status != "ok":
        raise HTTPException(status_code=503, detail="服务初始化失败，请稍后重试")
    return GenerationRuntime(db_path=bootstrap.db_path, data_root=bootstrap.data_root)


@contextmanager
def _open_connection(db_path: Path):
    with connect_database(db_path) as connection:
        connection.row_factory = sqlite3.Row
        yield connection


@router.get(
    "/characters/{character_id}/generation-workbench",
    response_model=GenerationWorkbenchResponse,
)
def get_generation_workbench_endpoint(character_id: str, request: Request):
    runtime = _resolve_runtime(request)

    try:
        with _open_connection(runtime.db_path) as connection:
            return get_generation_workbench_contract(connection, character_id)
    except CharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CharacterServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/generations/mock",
    response_model=GenerationJobAcceptedResponse,
    status_code=202,
)
async def create_mock_generation(request: Request, payload: GenerationSubmitRequest):
    runtime = _resolve_runtime(request)
    queue = resolve_task_queue_from_request(request)

    try:
        with _open_connection(runtime.db_path) as connection:
            contract = get_generation_workbench_contract(connection, payload.character_id)
            validate_generation_submission(contract, payload)
    except CharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except GenerationContractValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except CharacterServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    db_path = runtime.db_path
    data_root = runtime.data_root

    async def run_mock_generation(progress) -> None:
        await progress(20, "正在校验生成请求")
        await asyncio.sleep(0.05)
        await progress(55, "正在渲染占位图…")
        await asyncio.sleep(0.05)

        image_b64 = _placeholder_png_b64()
        archive_req = GenerationArchiveRequest(
            character_id=payload.character_id,
            costume_id=payload.costume_id,
            assembled_prompt=payload.scene_prompt,
            negative_prompt=payload.negative_prompt or "",
            width=payload.width,
            height=payload.height,
            steps=payload.steps,
            sampler=payload.sampler,
            cfg_scale=payload.cfg_scale,
            seed=payload.seed,
            lora_weight=payload.lora_weight,
            tags=list(payload.tags) if payload.tags else [],
            image_data_b64=image_b64,
        )
        with connect_database(db_path) as conn:
            conn.row_factory = sqlite3.Row
            record = archive_generation(conn, data_root, archive_req)

        await progress(100, json.dumps({"event": "generation_archived", "archiveId": record.id}))

    task = await queue.submit(
        name=f"generation-contract-{payload.character_id}",
        runner=run_mock_generation,
        category="gpu_exclusive",
        initial_message="生成任务已进入队列",
    )

    return {"job": build_mock_generation_job(task, payload)}


@router.post(
    "/generations/batch",
    response_model=BatchGenerationAcceptedResponse,
    status_code=202,
)
async def create_batch_generation(request: Request, payload: BatchGenerationRequest):
    runtime = _resolve_runtime(request)
    queue = resolve_task_queue_from_request(request)

    # Validate contract once for the whole batch.
    try:
        with _open_connection(runtime.db_path) as connection:
            contract = get_generation_workbench_contract(connection, payload.character_id)
    except CharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CharacterServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if not contract.can_generate:
        raise HTTPException(
            status_code=400,
            detail=contract.blocking_reason or "该角色当前无法生成图像。",
        )

    batch_id = uuid4().hex
    jobs: list[BatchJobItem] = []

    def _make_batch_runner(sp: str):
        async def _run(progress) -> None:
            await progress(20, f"正在处理：{sp[:20]}")
            await asyncio.sleep(0.05)
            await progress(60, "正在准备图像引擎")
            await asyncio.sleep(0.05)
            await progress(90, "批量任务执行中")
            await asyncio.sleep(0.05)
        return _run

    for scene_prompt in payload.scene_prompts:
        task = await queue.submit(
            name=f"batch-{batch_id}-{payload.character_id}",
            runner=_make_batch_runner(scene_prompt),
            category="gpu_exclusive",
            initial_message="批量生成任务已进入队列",
        )

        jobs.append(
            BatchJobItem(
                taskId=task.id,
                scenePrompt=scene_prompt,
                status=task.status,
                progress=task.progress,
                message=task.message,
                error=task.error,
                createdAt=task.created_at,
                updatedAt=task.updated_at,
            )
        )

    return BatchGenerationAcceptedResponse(
        batchId=batch_id,
        jobs=jobs,
        total=len(jobs),
    )
