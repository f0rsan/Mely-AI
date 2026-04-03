"""Tests for M1-D: LLM private model management."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def client(temp_data_root):
    app = create_app()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def character_id(client) -> str:
    resp = client.post("/api/characters", json={"name": "模型角色"})
    assert resp.status_code == 201
    return resp.json()["id"]


FAKE_GGUF = "/tmp/mely_test_fake_model.gguf"


@pytest.fixture(autouse=True)
def ensure_fake_gguf_file():
    path = Path(FAKE_GGUF)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"GGUF")
    yield
    path.unlink(missing_ok=True)


# ── Registration ──────────────────────────────────────────────────────────────

class TestRegisterModel:
    def test_register_model_returns_201_ollama_running(self, client, character_id):
        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ):
            resp = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF},
            )
        assert resp.status_code == 201
        body = resp.json()
        assert body["characterId"] == character_id
        assert body["status"] == "ready"
        assert body["ggufPath"] == FAKE_GGUF
        assert body["version"] == 1
        assert body["ollamaModelName"].startswith("mely-")
        assert body["id"] is not None

    def test_register_model_pending_when_ollama_offline(self, client, character_id):
        from app.services.ollama_service import OllamaNotRunningError
        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
            side_effect=OllamaNotRunningError("offline"),
        ):
            resp = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF},
            )
        assert resp.status_code == 201
        assert resp.json()["status"] == "pending"

    def test_register_model_pending_when_ollama_temporarily_unavailable(self, client, character_id):
        from app.services.ollama_service import OllamaTemporarilyUnavailableError

        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
            side_effect=OllamaTemporarilyUnavailableError("busy"),
        ):
            resp = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF},
            )
        assert resp.status_code == 201
        assert resp.json()["status"] == "pending"

    def test_register_model_failed_when_gguf_path_missing(self, client, character_id):
        missing_path = "/tmp/mely_test_missing_model.gguf"
        Path(missing_path).unlink(missing_ok=True)
        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ) as mocked_create:
            resp = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": missing_path},
            )
        assert resp.status_code == 201
        assert resp.json()["status"] == "failed"
        mocked_create.assert_not_called()

    def test_register_model_failed_when_ollama_returns_non_retryable_error(self, client, character_id):
        from app.services.ollama_service import OllamaAPIError

        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
            side_effect=OllamaAPIError("注册模型失败: 500 - invalid model"),
        ):
            resp = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF},
            )
        assert resp.status_code == 201
        assert resp.json()["status"] == "failed"

    def test_register_model_version_increments(self, client, character_id):
        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ):
            r1 = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF},
            )
            r2 = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF},
            )
        assert r1.json()["version"] == 1
        assert r2.json()["version"] == 2

    def test_register_model_ollama_name_format(self, client, character_id):
        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ):
            resp = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF},
            )
        name = resp.json()["ollamaModelName"]
        assert name == f"mely-{character_id[:8]}-v1"

    def test_register_model_with_custom_system_prompt(self, client, character_id):
        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ):
            resp = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF, "systemPrompt": "你是小花，活泼可爱。"},
            )
        assert resp.json()["systemPrompt"] == "你是小花，活泼可爱。"

    def test_register_model_stores_training_job_id(self, client, character_id):
        import json as _json
        # Create a real dataset + training job first to satisfy the FK constraint
        lines = [
            _json.dumps({"user": f"q{i}", "assistant": f"a{i}，详细回答。"}) for i in range(60)
        ]
        ds_resp = client.post(
            f"/api/characters/{character_id}/llm-datasets",
            json={"filename": "data.jsonl", "content": "\n".join(lines)},
        )
        ds_id = ds_resp.json()["id"]
        job_resp = client.post(
            f"/api/characters/{character_id}/llm-training/start",
            json={"datasetIds": [ds_id], "mode": "light"},
        )
        real_job_id = job_resp.json()["id"]

        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ):
            resp = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF, "trainingJobId": real_job_id},
            )
        assert resp.json()["trainingJobId"] == real_job_id

    def test_register_model_nonexistent_character_returns_404(self, client):
        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ):
            resp = client.post(
                "/api/characters/ghost-id/llm-models",
                json={"ggufPath": FAKE_GGUF},
            )
        assert resp.status_code == 404

    def test_register_model_empty_gguf_path_returns_422(self, client, character_id):
        resp = client.post(
            f"/api/characters/{character_id}/llm-models",
            json={"ggufPath": ""},
        )
        assert resp.status_code in (400, 422)


# ── List / get ─────────────────────────────────────────────────────────────────

class TestListGetModels:
    def test_list_models_empty_for_new_character(self, client, character_id):
        resp = client.get(f"/api/characters/{character_id}/llm-models")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_models_returns_registered_models(self, client, character_id):
        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ):
            client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF},
            )
            client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF},
            )
        resp = client.get(f"/api/characters/{character_id}/llm-models")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_list_models_excludes_deleted(self, client, character_id):
        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ), patch(
            "app.services.llm_model_service.ollama_delete_model",
            new_callable=AsyncMock,
        ):
            reg = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF},
            )
            model_id = reg.json()["id"]
            client.delete(f"/api/llm-models/{model_id}")

        resp = client.get(f"/api/characters/{character_id}/llm-models")
        assert resp.json() == []

    def test_get_model_by_id(self, client, character_id):
        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ):
            reg = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF},
            )
        model_id = reg.json()["id"]
        resp = client.get(f"/api/llm-models/{model_id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == model_id

    def test_get_nonexistent_model_returns_404(self, client):
        resp = client.get("/api/llm-models/nonexistent-id")
        assert resp.status_code == 404

    def test_list_ordered_by_version_desc(self, client, character_id):
        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ):
            client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF},
            )
            client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF},
            )
        models = client.get(f"/api/characters/{character_id}/llm-models").json()
        assert models[0]["version"] == 2
        assert models[1]["version"] == 1


# ── Delete ─────────────────────────────────────────────────────────────────────

class TestDeleteModel:
    def test_delete_model_returns_204(self, client, character_id):
        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ), patch(
            "app.services.llm_model_service.ollama_delete_model",
            new_callable=AsyncMock,
        ):
            reg = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF},
            )
            model_id = reg.json()["id"]
            resp = client.delete(f"/api/llm-models/{model_id}")
        assert resp.status_code == 204

    def test_delete_nonexistent_returns_404(self, client):
        resp = client.delete("/api/llm-models/ghost-id")
        assert resp.status_code == 404

    def test_delete_twice_returns_404(self, client, character_id):
        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ), patch(
            "app.services.llm_model_service.ollama_delete_model",
            new_callable=AsyncMock,
        ):
            reg = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF},
            )
            model_id = reg.json()["id"]
            client.delete(f"/api/llm-models/{model_id}")
            resp = client.delete(f"/api/llm-models/{model_id}")
        assert resp.status_code == 404

    def test_delete_graceful_when_ollama_offline(self, client, character_id):
        from app.services.ollama_service import OllamaNotRunningError
        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ), patch(
            "app.services.llm_model_service.ollama_delete_model",
            new_callable=AsyncMock,
            side_effect=OllamaNotRunningError("offline"),
        ):
            reg = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF},
            )
            model_id = reg.json()["id"]
            # Should still succeed (best-effort Ollama removal)
            resp = client.delete(f"/api/llm-models/{model_id}")
        assert resp.status_code == 204


# ── Retry registration ─────────────────────────────────────────────────────────

class TestRetryRegistration:
    def test_retry_pending_model_succeeds(self, client, character_id):
        from app.services.ollama_service import OllamaNotRunningError
        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
            side_effect=OllamaNotRunningError("offline"),
        ):
            reg = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF},
            )
        model_id = reg.json()["id"]
        assert reg.json()["status"] == "pending"

        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ):
            resp = client.post(f"/api/llm-models/{model_id}/retry-registration")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ready"

    def test_retry_failed_model_succeeds_after_gguf_fixed(self, client, character_id):
        broken_path = "/tmp/mely_test_retry_missing_model.gguf"
        Path(broken_path).unlink(missing_ok=True)

        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ):
            reg = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": broken_path},
            )
        model_id = reg.json()["id"]
        assert reg.json()["status"] == "failed"

        Path(broken_path).write_bytes(b"GGUF")
        try:
            with patch(
                "app.services.llm_model_service.ollama_create_model",
                new_callable=AsyncMock,
            ):
                resp = client.post(f"/api/llm-models/{model_id}/retry-registration")
            assert resp.status_code == 200
            assert resp.json()["status"] == "ready"
        finally:
            Path(broken_path).unlink(missing_ok=True)

    def test_retry_already_ready_returns_200(self, client, character_id):
        with patch(
            "app.services.llm_model_service.ollama_create_model",
            new_callable=AsyncMock,
        ):
            reg = client.post(
                f"/api/characters/{character_id}/llm-models",
                json={"ggufPath": FAKE_GGUF},
            )
        model_id = reg.json()["id"]
        resp = client.post(f"/api/llm-models/{model_id}/retry-registration")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ready"
