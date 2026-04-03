"""Export API endpoints — M4-C.

Endpoints:
  POST   /api/characters/{character_id}/export-pdf      → 202  (async PDF generation)
  GET    /api/characters/{character_id}/exports          → 200  (list exports)
  GET    /api/exports/{export_id}/download               → FileResponse
  GET    /api/characters/{character_id}/proof-chain      → 200
  GET    /api/characters/{character_id}/proof-chain/verify → 200
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import FileResponse, Response

from app.db.connection import connect_database
from app.schemas.export import (
    ExportAcceptedResponse,
    ExportListResponse,
    ExportRecord,
    ProofExportResponse,
    ProofVerifyResponse,
)
from app.services.pdf_export import (
    PDFCharacterNotFoundError,
    PDFExportError,
    aggregate_character_sheet_data,
    generate_character_sheet_pdf,
)
from app.services.proof_service import (
    create_proof,
    export_proof_chain,
    verify_proof_chain,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Runtime helpers
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class ExportRuntime:
    db_path: Path
    data_root: Path


def _resolve_runtime(request: Request) -> ExportRuntime:
    bootstrap = getattr(request.app.state, "bootstrap", None)
    if bootstrap is None or bootstrap.status != "ok":
        raise HTTPException(status_code=503, detail="服务初始化失败，请稍后重试")
    return ExportRuntime(db_path=bootstrap.db_path, data_root=bootstrap.data_root)


def _resolve_task_queue(request: Request):
    queue = getattr(request.app.state, "task_queue", None)
    if queue is None:
        raise HTTPException(status_code=503, detail="任务队列暂不可用，请稍后重试。")
    return queue


@contextmanager
def _open_connection(db_path: Path):
    with connect_database(db_path) as conn:
        conn.row_factory = sqlite3.Row
        yield conn


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/characters/{character_id}/export-pdf",
    response_model=ExportAcceptedResponse,
    status_code=202,
)
async def export_pdf(
    character_id: str,
    request: Request,
) -> ExportAcceptedResponse:
    runtime = _resolve_runtime(request)
    queue = _resolve_task_queue(request)

    # Verify character exists and aggregate data (fast check before queuing).
    try:
        with _open_connection(runtime.db_path) as conn:
            sheet_data = aggregate_character_sheet_data(conn, runtime.data_root, character_id)
    except PDFCharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    # Pre-create export record in DB with status=pending.
    export_id = str(uuid4())
    placeholder_path = str(
        runtime.data_root / "characters" / character_id / "exports" / f"{export_id}.pdf"
    )
    created_at = _utc_now()

    with _open_connection(runtime.db_path) as conn:
        conn.execute(
            """INSERT INTO exports (id, character_id, export_type, file_path, status, created_at)
               VALUES (?, ?, 'character_sheet', ?, 'pending', ?)""",
            (export_id, character_id, placeholder_path, created_at),
        )
        conn.commit()

    # Submit async task.
    async def runner(report):
        try:
            await report(10, "正在收集角色数据…")
            with _open_connection(runtime.db_path) as task_conn:
                fresh_data = aggregate_character_sheet_data(task_conn, runtime.data_root, character_id)
            await report(40, "正在生成 PDF…")
            output_path = generate_character_sheet_pdf(fresh_data, runtime.data_root, character_id)
            file_size = output_path.stat().st_size
            completed_at = _utc_now()
            with _open_connection(runtime.db_path) as task_conn:
                task_conn.execute(
                    """UPDATE exports SET file_path=?, file_size=?, status='completed', completed_at=?
                       WHERE id=?""",
                    (str(output_path), file_size, completed_at, export_id),
                )
                task_conn.commit()
                # Record proof
                create_proof(
                    task_conn,
                    character_id,
                    "pdf_export",
                    {"export_id": export_id, "export_type": "character_sheet"},
                    output_path=output_path,
                )
            await report(100, "设定书 PDF 已生成")
        except PDFExportError as exc:
            with _open_connection(runtime.db_path) as task_conn:
                task_conn.execute(
                    "UPDATE exports SET status='failed', error_message=? WHERE id=?",
                    (str(exc), export_id),
                )
                task_conn.commit()
            raise

    snapshot = await queue.submit(
        name=f"export-pdf-{character_id}",
        runner=runner,
        category="background",
        initial_message="PDF 导出任务已提交",
    )

    return ExportAcceptedResponse(
        exportId=export_id,
        taskId=snapshot.id,
        characterId=character_id,
        message="设定书导出任务已提交，请稍候",
    )


@router.get(
    "/characters/{character_id}/exports",
    response_model=ExportListResponse,
    status_code=200,
)
def list_exports(
    character_id: str,
    request: Request,
) -> ExportListResponse:
    runtime = _resolve_runtime(request)

    with _open_connection(runtime.db_path) as conn:
        # Check character exists.
        if conn.execute("SELECT id FROM characters WHERE id=?", (character_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="角色不存在，请刷新后重试。")

        rows = conn.execute(
            "SELECT * FROM exports WHERE character_id=? ORDER BY created_at DESC",
            (character_id,),
        ).fetchall()

    items = [
        ExportRecord(
            id=row["id"],
            characterId=row["character_id"],
            exportType=row["export_type"],
            filePath=row["file_path"],
            fileSize=row["file_size"],
            status=row["status"],
            errorMessage=row["error_message"],
            createdAt=row["created_at"],
            completedAt=row["completed_at"],
        )
        for row in rows
    ]
    return ExportListResponse(items=items)


@router.get("/exports/{export_id}/download")
def download_export(
    export_id: str,
    request: Request,
) -> FileResponse:
    runtime = _resolve_runtime(request)

    with _open_connection(runtime.db_path) as conn:
        row = conn.execute(
            "SELECT file_path, character_id, status FROM exports WHERE id=?", (export_id,)
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="导出记录不存在。")
    if row["status"] != "completed":
        raise HTTPException(status_code=409, detail="导出尚未完成，请稍后再试。")

    file_path = Path(row["file_path"]).resolve()
    allowed_root = (runtime.data_root / "characters" / row["character_id"] / "exports").resolve()

    try:
        file_path.relative_to(allowed_root)
    except ValueError:
        raise HTTPException(status_code=403, detail="无权访问该资源。")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="导出文件不存在，可能已被清理。")

    return FileResponse(
        str(file_path),
        media_type="application/pdf",
        filename=file_path.name,
    )


@router.get(
    "/characters/{character_id}/proof-chain",
    response_model=ProofExportResponse,
    status_code=200,
)
def get_proof_chain(
    character_id: str,
    request: Request,
) -> ProofExportResponse:
    runtime = _resolve_runtime(request)

    with _open_connection(runtime.db_path) as conn:
        if conn.execute("SELECT id FROM characters WHERE id=?", (character_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="角色不存在，请刷新后重试。")
        chain = export_proof_chain(conn, character_id)

    return ProofExportResponse(
        characterId=character_id,
        chain=chain,
        total=len(chain),
        message=f"共 {len(chain)} 条创作证明记录",
    )


@router.get(
    "/characters/{character_id}/proof-chain/verify",
    response_model=ProofVerifyResponse,
    status_code=200,
)
def verify_proof_chain_endpoint(
    character_id: str,
    request: Request,
) -> ProofVerifyResponse:
    runtime = _resolve_runtime(request)

    with _open_connection(runtime.db_path) as conn:
        if conn.execute("SELECT id FROM characters WHERE id=?", (character_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="角色不存在，请刷新后重试。")
        chain = export_proof_chain(conn, character_id)

    is_valid, error_message = verify_proof_chain(chain)

    return ProofVerifyResponse(
        characterId=character_id,
        isValid=is_valid,
        totalProofs=len(chain),
        errorMessage=error_message,
    )
