import sqlite3
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


def test_generation_workbench_returns_contract_and_bootstraps_base_costume(
    temp_data_root: Path,
) -> None:
    app = create_app()

    with TestClient(app) as client:
        created = client.post(
            "/api/characters",
            json={
                "name": "可生成角色",
                "dna": {
                    "autoPrompt": "silver hair, red eyes",
                },
                "visual": {
                    "loraPath": "/tmp/characters/lora.safetensors",
                    "triggerWord": "melychar",
                    "recommendedWeight": 0.78,
                    "baseCheckpoint": "flux-dev",
                    "trainingStatus": "completed",
                    "trainingProgress": 1.0,
                },
            },
        )
        character_id = created.json()["id"]

        response = client.get(f"/api/characters/{character_id}/generation-workbench")

    assert response.status_code == 200
    body = response.json()

    assert body["characterId"] == character_id
    assert body["characterName"] == "可生成角色"
    assert body["canGenerate"] is True
    assert body["blockingReason"] is None
    assert body["selectedCostumeId"]
    assert body["promptSources"] == {
        "dnaPrompt": "silver hair, red eyes",
        "triggerWord": "melychar",
        "costumePrompt": "",
    }
    assert body["parameterDefaults"] == {
        "width": 1024,
        "height": 1024,
        "steps": 28,
        "sampler": "DPM++ 2M Karras",
        "cfgScale": 3.5,
        "seed": None,
        "loraWeight": 0.78,
    }
    assert body["tagOptions"] == ["封面图", "表情包", "周边", "预告图"]
    assert len(body["costumes"]) == 1
    assert body["costumes"][0]["name"] == "基础造型"
    assert body["costumes"][0]["costumePrompt"] == ""
    assert body["costumes"][0]["isDefault"] is True
    assert set(body["costumes"][0].keys()) == {"id", "name", "costumePrompt", "isDefault"}

    with sqlite3.connect(temp_data_root / "db" / "mely.db") as connection:
        rows = connection.execute(
            "SELECT id, name, parent_id, costume_prompt FROM costumes WHERE character_id = ?",
            (character_id,),
        ).fetchall()

    assert len(rows) == 1
    costume_id, name, parent_id, costume_prompt = rows[0]
    assert costume_id == body["selectedCostumeId"]
    assert name == "基础造型"
    assert parent_id is None
    assert costume_prompt == ""


def test_generation_workbench_blocks_untrained_character(temp_data_root: Path) -> None:
    app = create_app()

    with TestClient(app) as client:
        created = client.post("/api/characters", json={"name": "未训练角色"})
        character_id = created.json()["id"]

        response = client.get(f"/api/characters/{character_id}/generation-workbench")

    assert response.status_code == 200
    body = response.json()

    assert body["characterId"] == character_id
    assert body["canGenerate"] is False
    assert body["blockingReason"] == "该角色当前还不能生成，请先完成视觉训练。"
    assert body["promptSources"]["dnaPrompt"] == ""
    assert body["promptSources"]["triggerWord"] == ""
    assert body["promptSources"]["costumePrompt"] == ""


def test_generation_workbench_blocks_incomplete_visual_assets(temp_data_root: Path) -> None:
    app = create_app()

    with TestClient(app) as client:
        created = client.post(
            "/api/characters",
            json={
                "name": "训练未绑定角色",
                "visual": {
                    "loraPath": None,
                    "triggerWord": "melychar",
                    "baseCheckpoint": "flux-dev",
                    "trainingStatus": "completed",
                    "trainingProgress": 1.0,
                },
            },
        )
        character_id = created.json()["id"]

        response = client.get(f"/api/characters/{character_id}/generation-workbench")

    assert response.status_code == 200
    body = response.json()

    assert body["canGenerate"] is False
    assert body["blockingReason"] == "该角色的视觉资产还不完整，请先完成训练结果绑定。"
    assert body["parameterDefaults"]["loraWeight"] == 0.85


def test_generation_workbench_returns_404_for_unknown_character(temp_data_root: Path) -> None:
    app = create_app()
    missing_id = "11111111-1111-1111-1111-111111111111"

    with TestClient(app) as client:
        response = client.get(f"/api/characters/{missing_id}/generation-workbench")

    assert response.status_code == 404
    assert response.json()["detail"] == "角色不存在"


def _wait_for_task_completion(client: TestClient, task_id: str) -> dict:
    deadline = time.time() + 3.0
    latest: dict | None = None

    while time.time() < deadline:
        response = client.get(f"/api/tasks/{task_id}")
        assert response.status_code == 200
        latest = response.json()
        if latest["status"] in {"completed", "failed"}:
            return latest
        time.sleep(0.02)

    raise AssertionError(f"任务没有在预期时间内完成。最后状态: {latest}")


def test_mock_generation_submission_returns_job_and_finishes(temp_data_root: Path) -> None:
    app = create_app()

    with TestClient(app) as client:
        created = client.post(
            "/api/characters",
            json={
                "name": "可生成角色",
                "dna": {
                    "autoPrompt": "silver hair, red eyes",
                },
                "visual": {
                    "loraPath": "/tmp/characters/lora.safetensors",
                    "triggerWord": "melychar",
                    "recommendedWeight": 0.78,
                    "baseCheckpoint": "flux-dev",
                    "trainingStatus": "completed",
                    "trainingProgress": 1.0,
                },
            },
        )
        character_id = created.json()["id"]

        contract = client.get(f"/api/characters/{character_id}/generation-workbench")
        selected_costume_id = contract.json()["selectedCostumeId"]

        response = client.post(
            "/api/generations/mock",
            json={
                "characterId": character_id,
                "costumeId": selected_costume_id,
                "scenePrompt": "在咖啡馆里看书，午后阳光透过窗户照进来",
                "negativePrompt": "",
                "width": 1024,
                "height": 1024,
                "steps": 28,
                "sampler": "DPM++ 2M Karras",
                "cfgScale": 3.5,
                "seed": None,
                "loraWeight": 0.85,
                "tags": ["封面图"],
            },
        )

        assert response.status_code == 202
        body = response.json()
        assert body["job"]["characterId"] == character_id
        assert body["job"]["scenePrompt"] == "在咖啡馆里看书，午后阳光透过窗户照进来"
        assert body["job"]["status"] == "pending"
        assert body["job"]["stage"] == "queued"
        assert body["job"]["tags"] == ["封面图"]

        final_task = _wait_for_task_completion(client, body["job"]["taskId"])

    assert final_task["status"] == "completed"
    assert final_task["progress"] == 100
    assert final_task["error"] is None


def test_mock_generation_submission_rejects_blocked_characters(temp_data_root: Path) -> None:
    app = create_app()

    with TestClient(app) as client:
        created = client.post("/api/characters", json={"name": "还没训练"})
        character_id = created.json()["id"]

        contract = client.get(f"/api/characters/{character_id}/generation-workbench")
        selected_costume_id = contract.json()["selectedCostumeId"]

        response = client.post(
            "/api/generations/mock",
            json={
                "characterId": character_id,
                "costumeId": selected_costume_id,
                "scenePrompt": "测试场景",
                "negativePrompt": "",
                "width": 1024,
                "height": 1024,
                "steps": 28,
                "sampler": "DPM++ 2M Karras",
                "cfgScale": 3.5,
                "seed": None,
                "loraWeight": 0.85,
                "tags": ["封面图"],
            },
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "该角色当前还不能生成，请先完成视觉训练。"


def test_mock_generation_submission_rejects_unknown_costume(temp_data_root: Path) -> None:
    app = create_app()

    with TestClient(app) as client:
        created = client.post(
            "/api/characters",
            json={
                "name": "可生成角色",
                "dna": {
                    "autoPrompt": "silver hair, red eyes",
                },
                "visual": {
                    "loraPath": "/tmp/characters/lora.safetensors",
                    "triggerWord": "melychar",
                    "recommendedWeight": 0.78,
                    "baseCheckpoint": "flux-dev",
                    "trainingStatus": "completed",
                    "trainingProgress": 1.0,
                },
            },
        )
        character_id = created.json()["id"]

        response = client.post(
            "/api/generations/mock",
            json={
                "characterId": character_id,
                "costumeId": "missing-costume",
                "scenePrompt": "测试场景",
                "negativePrompt": "",
                "width": 1024,
                "height": 1024,
                "steps": 28,
                "sampler": "DPM++ 2M Karras",
                "cfgScale": 3.5,
                "seed": None,
                "loraWeight": 0.85,
                "tags": ["封面图"],
            },
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "所选造型不存在，请刷新后重试。"
