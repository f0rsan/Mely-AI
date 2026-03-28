import sqlite3
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
        "sampler": "Euler a",
        "cfgScale": 7.0,
        "seed": -1,
        "loraWeight": 0.78,
    }
    assert body["tagOptions"] == ["封面图", "表情包", "周边", "预告图"]
    assert len(body["costumes"]) == 1
    assert body["costumes"][0]["name"] == "基础造型"
    assert body["costumes"][0]["costumePrompt"] == ""

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


def test_generation_workbench_returns_404_for_unknown_character(temp_data_root: Path) -> None:
    app = create_app()
    missing_id = "11111111-1111-1111-1111-111111111111"

    with TestClient(app) as client:
        response = client.get(f"/api/characters/{missing_id}/generation-workbench")

    assert response.status_code == 404
    assert response.json()["detail"] == "角色不存在"
