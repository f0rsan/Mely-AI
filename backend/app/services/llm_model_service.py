"""LLM private model management service.

Handles registration of fine-tuned GGUF models into Ollama and the
lifecycle of llm_models records (pending/failed → ready → deleted).
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.db.connection import connect_database
from app.services.ollama_service import (
    build_character_modelfile,
    create_model as ollama_create_model,
    delete_model as ollama_delete_model,
)


# ── Errors ─────────────────────────────────────────────────────────────────────

class LLMModelError(Exception):
    """Base model management error."""


class LLMModelNotFoundError(LLMModelError):
    """Model record not found."""


class LLMModelCharacterNotFoundError(LLMModelError):
    """Character does not exist."""


class LLMModelValidationError(LLMModelError):
    """Invalid input."""


# ── Domain record ──────────────────────────────────────────────────────────────

@dataclass(slots=True)
class LLMModelRecord:
    id: str
    character_id: str
    version: int
    training_job_id: str | None
    base_model: str
    ollama_model_name: str
    gguf_path: str
    system_prompt: str | None
    dataset_item_count: int
    loss_final: float | None
    status: str                 # "pending" | "failed" | "ready" | "deleted"
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "characterId": self.character_id,
            "version": self.version,
            "trainingJobId": self.training_job_id,
            "baseModel": self.base_model,
            "ollamaModelName": self.ollama_model_name,
            "ggufPath": self.gguf_path,
            "systemPrompt": self.system_prompt,
            "datasetItemCount": self.dataset_item_count,
            "lossFinal": self.loss_final,
            "status": self.status,
            "createdAt": self.created_at,
        }


# ── Helpers ────────────────────────────────────────────────────────────────────

def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _row_to_record(row: sqlite3.Row) -> LLMModelRecord:
    return LLMModelRecord(
        id=row["id"],
        character_id=row["character_id"],
        version=int(row["version"]),
        training_job_id=row["training_job_id"],
        base_model=row["base_model"],
        ollama_model_name=row["ollama_model_name"],
        gguf_path=row["gguf_path"],
        system_prompt=row["system_prompt"],
        dataset_item_count=int(row["dataset_item_count"]),
        loss_final=row["loss_final"],
        status=row["status"],
        created_at=row["created_at"],
    )


def _next_version(conn: sqlite3.Connection, character_id: str) -> int:
    row = conn.execute(
        "SELECT MAX(version) FROM llm_models WHERE character_id = ?",
        (character_id,),
    ).fetchone()
    current = row[0] if row and row[0] is not None else 0
    return current + 1


def _build_ollama_name(character_id: str, version: int) -> str:
    """Ollama model name: mely-{first8chars}-v{version}."""
    return f"mely-{character_id[:8]}-v{version}"


def _normalize_gguf_path(gguf_path: str) -> str:
    """Validate GGUF file path before building Modelfile / calling Ollama."""
    gguf = Path(gguf_path).expanduser()
    if not gguf.exists():
        raise LLMModelValidationError("GGUF 文件不存在，请检查导出路径")
    if not gguf.is_file():
        raise LLMModelValidationError("GGUF 路径不是文件，请检查导出路径")
    try:
        with gguf.open("rb"):
            pass
    except PermissionError as exc:
        raise LLMModelValidationError("GGUF 文件不可读，请检查文件权限") from exc
    except OSError as exc:
        raise LLMModelValidationError("GGUF 文件不可读，请检查文件状态") from exc
    return str(gguf)


def _classify_registration_error(exc: Exception) -> str:
    """Classify registration failure into retryable or hard-failed state."""
    if isinstance(exc, LLMModelValidationError):
        return "failed"
    return "pending"


# ── Service ────────────────────────────────────────────────────────────────────

class LLMModelService:
    def __init__(self, *, db_path: Path) -> None:
        self._db_path = db_path

    @contextmanager
    def _conn(self):
        with connect_database(self._db_path) as conn:
            conn.row_factory = sqlite3.Row
            yield conn

    def _get_row(self, conn: sqlite3.Connection, model_id: str) -> sqlite3.Row:
        row = conn.execute(
            "SELECT * FROM llm_models WHERE id = ?", (model_id,)
        ).fetchone()
        if row is None:
            raise LLMModelNotFoundError("私有模型不存在")
        return row

    async def register_model(
        self,
        character_id: str,
        gguf_path: str,
        base_model: str,
        *,
        training_job_id: str | None = None,
        system_prompt: str | None = None,
        dataset_item_count: int = 0,
        loss_final: float | None = None,
    ) -> dict[str, Any]:
        """Register a GGUF model into Ollama and persist the record.

        If Ollama is not running, the record is saved with status="pending"
        so it can be retried later.
        """
        if not gguf_path:
            raise LLMModelValidationError("GGUF 路径不能为空")

        with self._conn() as conn:
            if not conn.execute(
                "SELECT 1 FROM characters WHERE id = ?", (character_id,)
            ).fetchone():
                raise LLMModelCharacterNotFoundError("角色不存在，请先创建角色")

            version = _next_version(conn, character_id)
            ollama_name = _build_ollama_name(character_id, version)
            model_id = str(uuid4())
            now = _utc_now()

            conn.execute(
                """
                INSERT INTO llm_models
                    (id, character_id, version, training_job_id, base_model,
                     ollama_model_name, gguf_path, system_prompt,
                     dataset_item_count, loss_final, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                """,
                (
                    model_id,
                    character_id,
                    version,
                    training_job_id,
                    base_model,
                    ollama_name,
                    gguf_path,
                    system_prompt,
                    dataset_item_count,
                    loss_final,
                    now,
                ),
            )
            conn.commit()

        # Attempt Ollama registration
        prompt = system_prompt or f"你是 {character_id} 的专属 AI 角色助手，请保持角色设定进行对话。"
        final_status = "ready"
        try:
            normalized_gguf_path = _normalize_gguf_path(gguf_path)
            modelfile = build_character_modelfile(base_model, normalized_gguf_path, prompt)
            await ollama_create_model(ollama_name, modelfile)
        except Exception as exc:
            final_status = _classify_registration_error(exc)

        with self._conn() as conn:
            conn.execute(
                "UPDATE llm_models SET status = ? WHERE id = ?",
                (final_status, model_id),
            )
            conn.commit()

        return self.get_model(model_id)

    async def retry_registration(self, model_id: str) -> dict[str, Any]:
        """Re-attempt Ollama registration for a pending/failed model."""
        with self._conn() as conn:
            row = self._get_row(conn, model_id)
            record = _row_to_record(row)

        if record.status == "deleted":
            raise LLMModelValidationError("模型已删除，无法重新注册")
        if record.status == "ready":
            return record.to_dict()

        prompt = record.system_prompt or f"你是 {record.character_id} 的专属 AI 角色助手。"
        final_status = "ready"
        try:
            normalized_gguf_path = _normalize_gguf_path(record.gguf_path)
            modelfile = build_character_modelfile(
                record.base_model,
                normalized_gguf_path,
                prompt,
            )
            await ollama_create_model(record.ollama_model_name, modelfile)
        except Exception as exc:
            final_status = _classify_registration_error(exc)

        with self._conn() as conn:
            conn.execute(
                "UPDATE llm_models SET status = ? WHERE id = ?",
                (final_status, model_id),
            )
            conn.commit()

        return self.get_model(model_id)

    def get_model(self, model_id: str) -> dict[str, Any]:
        with self._conn() as conn:
            row = self._get_row(conn, model_id)
            return _row_to_record(row).to_dict()

    def list_models(self, character_id: str) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT * FROM llm_models
                WHERE character_id = ? AND status != 'deleted'
                ORDER BY version DESC
                """,
                (character_id,),
            ).fetchall()
            return [_row_to_record(r).to_dict() for r in rows]

    async def delete_model(self, model_id: str) -> None:
        """Mark model as deleted in DB and remove from Ollama (best effort)."""
        with self._conn() as conn:
            row = self._get_row(conn, model_id)
            record = _row_to_record(row)

        if record.status == "deleted":
            raise LLMModelNotFoundError("私有模型不存在")

        # Best-effort Ollama removal
        try:
            await ollama_delete_model(record.ollama_model_name)
        except Exception:
            pass

        with self._conn() as conn:
            conn.execute(
                "UPDATE llm_models SET status = 'deleted' WHERE id = ?",
                (model_id,),
            )
            conn.commit()


def create_llm_model_service(*, db_path: Path) -> LLMModelService:
    return LLMModelService(db_path=db_path)
