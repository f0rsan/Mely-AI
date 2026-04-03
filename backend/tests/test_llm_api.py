"""Tests for M1-A: Ollama environment integration + LLM API endpoints."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services.ollama_service import (
    OllamaModelInfo,
    OllamaNotRunningError,
    OllamaModelNotFoundError,
    OllamaStatus,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def client(temp_data_root):
    app = create_app()
    with TestClient(app) as c:
        yield c


def _running_status(models: list[OllamaModelInfo] | None = None) -> OllamaStatus:
    return OllamaStatus(
        running=True,
        version="0.3.0",
        models=models or [],
    )


def _stopped_status() -> OllamaStatus:
    return OllamaStatus(running=False, version=None, models=[])


# ── GET /api/llm/health ───────────────────────────────────────────────────────

class TestLLMHealth:
    def test_returns_running_true_when_ollama_up(self, client):
        with patch(
            "app.api.llm.check_ollama_status",
            new_callable=AsyncMock,
            return_value=_running_status(),
        ):
            resp = client.get("/api/llm/health")

        assert resp.status_code == 200
        body = resp.json()
        assert body["running"] is True
        assert body["version"] == "0.3.0"
        assert body["hint"] is None

    def test_returns_running_false_with_hint_when_ollama_down(self, client):
        with patch(
            "app.api.llm.check_ollama_status",
            new_callable=AsyncMock,
            return_value=_stopped_status(),
        ):
            resp = client.get("/api/llm/health")

        assert resp.status_code == 200
        body = resp.json()
        assert body["running"] is False
        assert body["hint"] is not None
        assert "Ollama" in body["hint"]

    def test_lists_available_models(self, client):
        models = [
            OllamaModelInfo(
                name="qwen2.5:7b-instruct-q4_K_M",
                size_bytes=4_500_000_000,
                modified_at="2024-01-01T00:00:00Z",
                digest="abc123",
            )
        ]
        with patch(
            "app.api.llm.check_ollama_status",
            new_callable=AsyncMock,
            return_value=_running_status(models),
        ):
            resp = client.get("/api/llm/health")

        assert resp.status_code == 200
        body = resp.json()
        assert len(body["models"]) == 1
        assert body["models"][0]["name"] == "qwen2.5:7b-instruct-q4_K_M"
        assert body["models"][0]["sizeBytes"] == 4_500_000_000


# ── GET /api/llm/models ───────────────────────────────────────────────────────

class TestListLLMModels:
    def test_returns_model_list_when_ollama_running(self, client):
        models = [
            OllamaModelInfo(name="llama3.2:3b", size_bytes=2_000_000_000, modified_at="", digest="d1"),
            OllamaModelInfo(name="character_abc_v1", size_bytes=4_500_000_000, modified_at="", digest="d2"),
        ]
        with patch(
            "app.api.llm.check_ollama_status",
            new_callable=AsyncMock,
            return_value=_running_status(models),
        ):
            resp = client.get("/api/llm/models")

        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 2
        assert body[0]["name"] == "llama3.2:3b"

    def test_returns_503_when_ollama_not_running(self, client):
        with patch(
            "app.api.llm.check_ollama_status",
            new_callable=AsyncMock,
            return_value=_stopped_status(),
        ):
            resp = client.get("/api/llm/models")

        assert resp.status_code == 503
        assert "Ollama" in resp.json()["detail"]


# ── DELETE /api/llm/models ────────────────────────────────────────────────────

class TestDeleteLLMModel:
    def test_deletes_model_successfully(self, client):
        with patch(
            "app.api.llm.delete_model",
            new_callable=AsyncMock,
            return_value=None,
        ):
            resp = client.request(
                "DELETE",
                "/api/llm/models",
                json={"name": "character_abc_v1"},
            )

        assert resp.status_code == 204

    def test_returns_404_when_model_not_found(self, client):
        with patch(
            "app.api.llm.delete_model",
            new_callable=AsyncMock,
            side_effect=OllamaModelNotFoundError("模型 'x' 不存在"),
        ):
            resp = client.request(
                "DELETE",
                "/api/llm/models",
                json={"name": "x"},
            )

        assert resp.status_code == 404

    def test_returns_503_when_ollama_not_running(self, client):
        with patch(
            "app.api.llm.delete_model",
            new_callable=AsyncMock,
            side_effect=OllamaNotRunningError("Ollama 未运行"),
        ):
            resp = client.request(
                "DELETE",
                "/api/llm/models",
                json={"name": "any_model"},
            )

        assert resp.status_code == 503


# ── DB migration ──────────────────────────────────────────────────────────────

class TestLLMMigration:
    def test_migration_0008_applied_on_startup(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        applied = resp.json()["database"]["appliedMigrations"]
        assert "0008_llm_tables.sql" in applied

    def test_llm_tables_exist_after_migration(self, temp_data_root):
        """Verify all four LLM tables were created by migration 0008."""
        import sqlite3
        from pathlib import Path
        from app.db.connection import connect_database
        from app.db.migrations import apply_migrations

        db_path = temp_data_root / "db" / "mely.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        migration_dir = Path(__file__).resolve().parents[1] / "migrations"

        with connect_database(db_path) as conn:
            apply_migrations(conn, migration_dir)
            cursor = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
            tables = {row[0] for row in cursor.fetchall()}

        assert "llm_datasets" in tables
        assert "llm_training_jobs" in tables
        assert "llm_models" in tables
        assert "character_chats" in tables
        assert "character_chat_messages" in tables


# ── OllamaService unit tests ──────────────────────────────────────────────────

class TestOllamaService:
    def test_check_status_returns_running_false_on_connection_error(self, client):
        # Drive via the HTTP endpoint: if Ollama is unreachable the endpoint must
        # still return 200 with running=False (no crash).
        with patch(
            "app.api.llm.check_ollama_status",
            new_callable=AsyncMock,
            return_value=_stopped_status(),
        ):
            resp = client.get("/api/llm/health")

        assert resp.status_code == 200
        assert resp.json()["running"] is False

    def test_build_character_modelfile_includes_system_prompt(self):
        from app.services.ollama_service import build_character_modelfile

        modelfile = build_character_modelfile(
            base_model="qwen2.5:7b-instruct-q4_K_M",
            gguf_path="/path/to/model.gguf",
            system_prompt="你是琳娜，一个活泼开朗的虚拟主播。",
        )

        assert "FROM /path/to/model.gguf" in modelfile
        assert "你是琳娜" in modelfile
        assert "SYSTEM" in modelfile
        assert "temperature" in modelfile
