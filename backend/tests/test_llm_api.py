"""Tests for M1-A: Ollama environment integration + LLM API endpoints."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services.ollama_service import (
    OllamaModelInfo,
    OllamaRuntimeStatus,
    OllamaNotRunningError,
    OllamaModelNotFoundError,
    OllamaAPIError,
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


def _runtime_status(
    *,
    installed: bool = True,
    running: bool = False,
    version: str | None = None,
    models: list[OllamaModelInfo] | None = None,
    hint: str | None = None,
) -> OllamaRuntimeStatus:
    return OllamaRuntimeStatus(
        installed=installed,
        running=running,
        version=version,
        minimum_version="0.3.10",
        platform="darwin-arm64",
        models=models or [],
        hint=hint,
    )


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


# ── GET /api/llm/runtime ──────────────────────────────────────────────────────

class TestLLMRuntime:
    def test_returns_not_installed_state(self, client):
        with patch(
            "app.api.llm.check_ollama_runtime",
            new_callable=AsyncMock,
            return_value=_runtime_status(
                installed=False,
                running=False,
                version=None,
                hint="未检测到语言引擎，请先安装 Ollama。",
            ),
        ):
            resp = client.get("/api/llm/runtime")

        assert resp.status_code == 200
        body = resp.json()
        assert body["installed"] is False
        assert body["running"] is False
        assert body["version"] is None
        assert body["minimumVersion"] == "0.3.10"
        assert "安装" in (body["hint"] or "")

    def test_returns_installed_not_running_state(self, client):
        with patch(
            "app.api.llm.check_ollama_runtime",
            new_callable=AsyncMock,
            return_value=_runtime_status(
                installed=True,
                running=False,
                version=None,
                hint="语言引擎未启动，请点击启动按钮后重试。",
            ),
        ):
            resp = client.get("/api/llm/runtime")

        assert resp.status_code == 200
        body = resp.json()
        assert body["installed"] is True
        assert body["running"] is False
        assert "未启动" in (body["hint"] or "")

    def test_returns_running_runtime_with_models(self, client):
        models = [
            OllamaModelInfo(
                name="qwen2.5:7b-instruct-q4_K_M",
                size_bytes=4_500_000_000,
                modified_at="2026-04-07T00:00:00Z",
                digest="sha256:demo",
            )
        ]
        with patch(
            "app.api.llm.check_ollama_runtime",
            new_callable=AsyncMock,
            return_value=_runtime_status(
                installed=True,
                running=True,
                version="0.3.10",
                models=models,
            ),
        ):
            resp = client.get("/api/llm/runtime")

        assert resp.status_code == 200
        body = resp.json()
        assert body["installed"] is True
        assert body["running"] is True
        assert body["version"] == "0.3.10"
        assert len(body["models"]) == 1
        assert body["models"][0]["name"] == "qwen2.5:7b-instruct-q4_K_M"

    def test_degrades_gracefully_when_runtime_probe_times_out(self, client):
        with patch(
            "app.api.llm.check_ollama_runtime",
            new_callable=AsyncMock,
            side_effect=asyncio.TimeoutError,
        ), patch(
            "app.api.llm.is_ollama_installed",
            return_value=True,
        ), patch(
            "app.api.llm.current_platform",
            return_value="win32-amd64",
        ):
            resp = client.get("/api/llm/runtime")

        assert resp.status_code == 200
        body = resp.json()
        assert body["installed"] is True
        assert body["running"] is False
        assert body["platform"] == "win32-amd64"
        assert "超时" in (body["hint"] or "")


# ── POST /api/llm/runtime/open ────────────────────────────────────────────────

class TestOpenLLMRuntime:
    def test_open_runtime_success(self, client):
        with patch(
            "app.api.llm.open_ollama_runtime",
            new_callable=AsyncMock,
            return_value=None,
        ):
            resp = client.post("/api/llm/runtime/open")

        assert resp.status_code == 204

    def test_open_runtime_failure_returns_chinese_error(self, client):
        with patch(
            "app.api.llm.open_ollama_runtime",
            new_callable=AsyncMock,
            side_effect=OllamaAPIError("启动语言引擎失败，请稍后重试"),
        ):
            resp = client.post("/api/llm/runtime/open")

        assert resp.status_code == 502
        assert "启动语言引擎失败" in resp.json()["detail"]


# ── GET /api/llm/catalog ──────────────────────────────────────────────────────

class TestLLMCatalog:
    def test_returns_fixed_catalog(self, client):
        resp = client.get("/api/llm/catalog")
        assert resp.status_code == 200

        body = resp.json()
        assert "items" in body
        assert len(body["items"]) == 3
        names = {item["modelName"] for item in body["items"]}
        assert "qwen2.5:7b-instruct-q4_K_M" in names
        assert "qwen2.5:3b" in names or "qwen2.5:1.5b" in names
        assert "minicpm-v:8b" in names


# ── POST /api/llm/pull ────────────────────────────────────────────────────────

class TestLLMPull:
    def test_streams_pull_events_as_sse(self, client):
        async def _fake_pull(_model_name: str):
            yield {"status": "pulling manifest"}
            yield {"status": "downloading", "total": 100, "completed": 25}
            yield {"status": "done"}

        with patch(
            "app.api.llm.check_ollama_runtime",
            new_callable=AsyncMock,
            return_value=_runtime_status(installed=True, running=True, version="0.3.10"),
        ), patch(
            "app.api.llm.pull_model",
            _fake_pull,
        ):
            with client.stream("POST", "/api/llm/pull", json={"modelName": "qwen2.5:3b"}) as resp:
                assert resp.status_code == 200
                assert resp.headers["content-type"].startswith("text/event-stream")
                body = "".join(resp.iter_text())

        assert '"status": "pulling manifest"' in body
        assert '"status": "downloading"' in body
        assert '"status": "done"' in body
        assert '"percent": 25.0' in body

    def test_returns_chinese_error_when_ollama_unavailable(self, client):
        with patch(
            "app.api.llm.check_ollama_runtime",
            new_callable=AsyncMock,
            return_value=_runtime_status(
                installed=True,
                running=False,
                hint="语言引擎未启动，请先启动后再下载模型。",
            ),
        ):
            resp = client.post("/api/llm/pull", json={"modelName": "qwen2.5:3b"})

        assert resp.status_code == 503
        assert "启动" in resp.json()["detail"]


# ── Character LLM preferences ─────────────────────────────────────────────────

class TestCharacterLLMPreferences:
    def test_get_preferences_returns_default_base_model_name(self, client):
        created = client.post("/api/characters", json={"name": "角色A"}).json()
        character_id = created["id"]

        resp = client.get(f"/api/characters/{character_id}/llm-preferences")

        assert resp.status_code == 200
        body = resp.json()
        assert body["characterId"] == character_id
        assert body["defaultBaseModelName"] is None

    def test_update_preferences_saves_default_base_model_name(self, client):
        created = client.post("/api/characters", json={"name": "角色B"}).json()
        character_id = created["id"]

        update_resp = client.put(
            f"/api/characters/{character_id}/llm-preferences",
            json={"defaultBaseModelName": "qwen2.5:7b-instruct-q4_K_M"},
        )
        assert update_resp.status_code == 200
        assert update_resp.json()["defaultBaseModelName"] == "qwen2.5:7b-instruct-q4_K_M"

        get_resp = client.get(f"/api/characters/{character_id}/llm-preferences")
        assert get_resp.status_code == 200
        assert get_resp.json()["defaultBaseModelName"] == "qwen2.5:7b-instruct-q4_K_M"

    def test_update_preferences_rejects_model_not_in_catalog(self, client):
        created = client.post("/api/characters", json={"name": "角色C"}).json()
        character_id = created["id"]

        resp = client.put(
            f"/api/characters/{character_id}/llm-preferences",
            json={"defaultBaseModelName": "unknown:model"},
        )
        assert resp.status_code == 400
        assert "模型目录" in resp.json()["detail"]


# ── DB migration ──────────────────────────────────────────────────────────────

class TestLLMMigration:
    def test_migration_0008_applied_on_startup(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        applied = resp.json()["database"]["appliedMigrations"]
        assert "0008_llm_tables.sql" in applied
        assert "0010_character_default_base_model.sql" in applied
        assert "0011_chat_base_model_name.sql" in applied
        assert "0012_chat_message_images_json.sql" in applied
        assert "0013_backfill_legacy_chat_base_models.sql" in applied

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

    def test_migration_0010_adds_default_base_model_column(self, temp_data_root):
        import sqlite3
        from pathlib import Path
        from app.db.connection import connect_database
        from app.db.migrations import apply_migrations

        db_path = temp_data_root / "db" / "mely.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        migration_dir = Path(__file__).resolve().parents[1] / "migrations"

        with connect_database(db_path) as conn:
            apply_migrations(conn, migration_dir)
            cursor = conn.execute("PRAGMA table_info(characters)")
            columns = {row[1] for row in cursor.fetchall()}

        assert "default_base_model_name" in columns

    def test_migration_0011_adds_chat_base_model_name_column(self, temp_data_root):
        from pathlib import Path
        from app.db.connection import connect_database
        from app.db.migrations import apply_migrations

        db_path = temp_data_root / "db" / "mely.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        migration_dir = Path(__file__).resolve().parents[1] / "migrations"

        with connect_database(db_path) as conn:
            apply_migrations(conn, migration_dir)
            cursor = conn.execute("PRAGMA table_info(character_chats)")
            columns = {row[1] for row in cursor.fetchall()}

        assert "base_model_name" in columns

    def test_migration_0012_adds_chat_message_images_json_column(self, temp_data_root):
        from pathlib import Path
        from app.db.connection import connect_database
        from app.db.migrations import apply_migrations

        db_path = temp_data_root / "db" / "mely.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        migration_dir = Path(__file__).resolve().parents[1] / "migrations"

        with connect_database(db_path) as conn:
            apply_migrations(conn, migration_dir)
            cursor = conn.execute("PRAGMA table_info(character_chat_messages)")
            columns = {row[1] for row in cursor.fetchall()}

        assert "images_json" in columns

    def test_migration_0013_backfills_legacy_chat_base_model_and_prevents_drift(self, temp_data_root):
        from pathlib import Path

        from app.db.connection import connect_database
        from app.db.migrations import ensure_schema_migrations_table
        from app.services.chat_service import ChatService

        db_path = temp_data_root / "db" / "mely.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        migration_dir = Path(__file__).resolve().parents[1] / "migrations"
        migration_0013_path = migration_dir / "0013_backfill_legacy_chat_base_models.sql"
        now = "2026-04-07T00:00:00Z"

        with connect_database(db_path) as conn:
            ensure_schema_migrations_table(conn)
            for migration_path in sorted(migration_dir.glob("*.sql")):
                if migration_path.name == "0013_backfill_legacy_chat_base_models.sql":
                    continue
                version = migration_path.stem.split("_", maxsplit=1)[0]
                conn.executescript(migration_path.read_text(encoding="utf-8"))
                conn.execute(
                    "INSERT INTO schema_migrations(version, name) VALUES (?, ?)",
                    (version, migration_path.name),
                )
            conn.commit()

            conn.execute(
                """
                INSERT INTO characters (id, name, created_at, default_base_model_name)
                VALUES (?, ?, ?, ?)
                """,
                ("char-legacy", "角色", now, "qwen2.5:3b"),
            )
            conn.execute(
                """
                INSERT INTO characters (id, name, created_at, default_base_model_name)
                VALUES (?, ?, ?, ?)
                """,
                ("char-empty", "角色空模型", now, "   "),
            )
            conn.execute(
                """
                INSERT INTO llm_models (
                    id, character_id, version, base_model, ollama_model_name, gguf_path, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "private-model-1",
                    "char-legacy",
                    1,
                    "qwen2.5:7b-instruct-q4_K_M",
                    "character_char-legacy_v1",
                    "/tmp/fake.gguf",
                    "ready",
                    now,
                ),
            )
            conn.execute(
                """
                INSERT INTO character_chats (id, character_id, llm_model_id, base_model_name, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                ("chat-legacy", "char-legacy", None, None, now),
            )
            conn.execute(
                """
                INSERT INTO character_chats (id, character_id, llm_model_id, base_model_name, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                ("chat-fixed", "char-legacy", None, "qwen2.5:7b-instruct-q4_K_M", now),
            )
            conn.execute(
                """
                INSERT INTO character_chats (id, character_id, llm_model_id, base_model_name, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                ("chat-private", "char-legacy", "private-model-1", None, now),
            )
            conn.execute(
                """
                INSERT INTO character_chats (id, character_id, llm_model_id, base_model_name, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                ("chat-empty-default", "char-empty", None, None, now),
            )
            conn.commit()

            conn.executescript(migration_0013_path.read_text(encoding="utf-8"))
            conn.commit()

            legacy_base_model = conn.execute(
                "SELECT base_model_name FROM character_chats WHERE id = ?",
                ("chat-legacy",),
            ).fetchone()[0]
            fixed_base_model = conn.execute(
                "SELECT base_model_name FROM character_chats WHERE id = ?",
                ("chat-fixed",),
            ).fetchone()[0]
            private_base_model = conn.execute(
                "SELECT base_model_name FROM character_chats WHERE id = ?",
                ("chat-private",),
            ).fetchone()[0]
            empty_character_base_model = conn.execute(
                "SELECT base_model_name FROM character_chats WHERE id = ?",
                ("chat-empty-default",),
            ).fetchone()[0]

            assert legacy_base_model == "qwen2.5:3b"
            assert fixed_base_model == "qwen2.5:7b-instruct-q4_K_M"
            assert private_base_model is None
            assert empty_character_base_model == "qwen2.5:7b-instruct-q4_K_M"

            conn.execute(
                "UPDATE characters SET default_base_model_name = ? WHERE id = ?",
                ("minicpm-v:8b", "char-legacy"),
            )
            conn.commit()

        service = ChatService(db_path=db_path)
        model_name, _, _used_ids = service._resolve_model_name_and_system_prompt("chat-legacy")
        assert model_name == "qwen2.5:3b"


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
