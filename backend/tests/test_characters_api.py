import sqlite3
import uuid
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


def _assert_valid_uuid(value: str) -> None:
    parsed = uuid.UUID(value)
    assert str(parsed) == value


def test_create_character_creates_record_and_directories(temp_data_root: Path) -> None:
    app = create_app()
    payload = {"name": "测试角色"}

    with TestClient(app) as client:
        response = client.post("/api/characters", json=payload)

    assert response.status_code == 201
    body = response.json()

    _assert_valid_uuid(body["id"])
    assert body["name"] == "测试角色"
    assert body["fingerprint"] is None
    assert body["createdAt"]
    assert body["dna"] is None
    assert body["visual"] is None
    assert body["voice"] is None

    character_root = temp_data_root / "characters" / body["id"]
    assert (character_root / "lora").exists()
    assert (character_root / "training_data").exists()
    assert (character_root / "voice").exists()
    assert (character_root / "costumes").exists()
    assert (character_root / "generations").exists()


def test_list_and_detail_return_expected_shapes(temp_data_root: Path) -> None:
    app = create_app()

    create_payload = {
        "name": "角色A",
        "fingerprint": "fp-001",
        "dna": {
            "hairColor": "silver",
            "eyeColor": "red",
            "skinTone": "fair",
            "bodyType": "slim",
            "style": "anime",
            "extraTags": ["smile", "idol"],
            "autoPrompt": "silver hair, red eyes",
        },
        "visual": {
            "loraPath": "/tmp/lora/role-a.safetensors",
            "triggerWord": "rolea",
            "recommendedWeight": 0.75,
            "baseCheckpoint": "flux-dev",
            "trainingConfig": {"steps": 1200},
            "trainingStatus": "pending",
            "trainingProgress": 0.0,
        },
        "voice": {
            "referenceAudioPath": "/tmp/voice/ref.wav",
            "ttsEngine": "f5-tts",
            "customModelPath": None,
        },
    }

    with TestClient(app) as client:
        created = client.post("/api/characters", json=create_payload)
        created_id = created.json()["id"]

        second = client.post("/api/characters", json={"name": "角色B"})
        second_id = second.json()["id"]

        list_response = client.get("/api/characters")
        detail_response = client.get(f"/api/characters/{created_id}")

    assert list_response.status_code == 200
    list_body = list_response.json()
    assert list_body["total"] == 2
    assert len(list_body["items"]) == 2
    ids = {item["id"] for item in list_body["items"]}
    assert ids == {created_id, second_id}
    for item in list_body["items"]:
        assert item["name"]
        assert item["createdAt"]
        assert "fingerprint" in item

    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["id"] == created_id
    assert detail["name"] == "角色A"
    assert detail["fingerprint"] == "fp-001"
    assert detail["dna"]["hairColor"] == "silver"
    assert detail["dna"]["extraTags"] == ["smile", "idol"]
    assert detail["visual"]["triggerWord"] == "rolea"
    assert detail["visual"]["trainingConfig"] == {"steps": 1200}
    assert detail["voice"]["referenceAudioPath"] == "/tmp/voice/ref.wav"
    assert detail["voice"]["ttsEngine"] == "f5-tts"


def test_update_character_updates_basic_fields(temp_data_root: Path) -> None:
    app = create_app()

    with TestClient(app) as client:
        created = client.post(
            "/api/characters",
            json={"name": "旧名称", "fingerprint": "before-update"},
        )
        character_id = created.json()["id"]

        update_response = client.put(
            f"/api/characters/{character_id}",
            json={"name": "新名称", "fingerprint": "after-update"},
        )

    assert update_response.status_code == 200
    body = update_response.json()
    assert body["id"] == character_id
    assert body["name"] == "新名称"
    assert body["fingerprint"] == "after-update"

    with sqlite3.connect(temp_data_root / "db" / "mely.db") as connection:
        row = connection.execute(
            "SELECT name, fingerprint FROM characters WHERE id = ?",
            (character_id,),
        ).fetchone()

    assert row == ("新名称", "after-update")


def test_update_character_dna_persists_and_returns_auto_prompt(temp_data_root: Path) -> None:
    app = create_app()

    payload = {
        "hairColor": "银色",
        "eyeColor": "红色",
        "skinTone": "白皙",
        "bodyType": "纤细",
        "style": "二次元",
        "extraTags": ["直播封面", "偶像风"],
    }

    with TestClient(app) as client:
        created = client.post("/api/characters", json={"name": "DNA 角色"})
        character_id = created.json()["id"]

        update_response = client.put(f"/api/characters/{character_id}/dna", json=payload)

    assert update_response.status_code == 200
    body = update_response.json()
    assert body["id"] == character_id
    assert body["dna"]["hairColor"] == "银色"
    assert body["dna"]["eyeColor"] == "红色"
    assert body["dna"]["skinTone"] == "白皙"
    assert body["dna"]["bodyType"] == "纤细"
    assert body["dna"]["style"] == "二次元"
    assert body["dna"]["extraTags"] == ["直播封面", "偶像风"]
    assert isinstance(body["dna"]["autoPrompt"], str)
    assert "silver hair" in body["dna"]["autoPrompt"]
    assert "red eyes" in body["dna"]["autoPrompt"]
    assert "anime style" in body["dna"]["autoPrompt"]

    with sqlite3.connect(temp_data_root / "db" / "mely.db") as connection:
        row = connection.execute(
            """
            SELECT hair_color, eye_color, skin_tone, body_type, style, extra_tags, auto_prompt
            FROM character_dna
            WHERE character_id = ?
            """,
            (character_id,),
        ).fetchone()

    assert row is not None
    assert row[0] == "银色"
    assert row[1] == "红色"
    assert row[2] == "白皙"
    assert row[3] == "纤细"
    assert row[4] == "二次元"
    assert row[5] == '["直播封面", "偶像风"]'
    assert isinstance(row[6], str) and "silver hair" in row[6]


def test_get_dna_suggestions_returns_manual_defaults_when_wd14_not_ready(
    temp_data_root: Path,
) -> None:
    app = create_app()

    with TestClient(app) as client:
        created = client.post(
            "/api/characters",
            json={
                "name": "建议值角色",
                "dna": {
                    "hairColor": "粉色",
                    "eyeColor": "紫色",
                    "skinTone": "白皙",
                    "bodyType": "纤细",
                    "style": "二次元",
                    "autoPrompt": "pink hair, violet eyes",
                },
            },
        )
        character_id = created.json()["id"]

        response = client.get(f"/api/characters/{character_id}/dna/suggestions")

    assert response.status_code == 200
    body = response.json()
    assert body["characterId"] == character_id
    assert body["source"] == "manual_default"
    assert body["fields"]["hairColor"]["label"] == "发色"
    assert body["fields"]["hairColor"]["recommended"] == "粉色"
    assert body["fields"]["eyeColor"]["recommended"] == "紫色"
    assert body["fields"]["skinTone"]["recommended"] == "白皙"
    assert body["fields"]["bodyType"]["recommended"] == "纤细"
    assert body["fields"]["style"]["recommended"] == "二次元"
    assert isinstance(body["autoPromptPreview"], str)
    assert "pink hair" in body["autoPromptPreview"]
    assert "anime style" in body["autoPromptPreview"]
    assert body["wd14"]["available"] is False
    assert body["wd14"]["modelId"] is None
    assert isinstance(body["wd14"]["reason"], str)
    assert "WD14" in body["wd14"]["reason"]


def test_delete_character_removes_record_and_directory(temp_data_root: Path) -> None:
    app = create_app()

    with TestClient(app) as client:
        created = client.post("/api/characters", json={"name": "待删除角色"})
        character_id = created.json()["id"]
        character_dir = temp_data_root / "characters" / character_id
        assert character_dir.exists()

        delete_response = client.delete(f"/api/characters/{character_id}")
        detail_after_delete = client.get(f"/api/characters/{character_id}")

    assert delete_response.status_code == 204
    assert delete_response.content == b""
    assert not character_dir.exists()
    assert detail_after_delete.status_code == 404
    assert detail_after_delete.json()["detail"] == "角色不存在"


def test_character_endpoints_return_chinese_user_errors(temp_data_root: Path) -> None:
    app = create_app()
    missing_id = "11111111-1111-1111-1111-111111111111"

    with TestClient(app) as client:
        create_bad_request = client.post("/api/characters", json={})
        update_not_found = client.put(
            f"/api/characters/{missing_id}",
            json={"name": "不存在"},
        )
        delete_not_found = client.delete(f"/api/characters/{missing_id}")

    assert create_bad_request.status_code == 422
    assert create_bad_request.json()["detail"] == "请求参数不合法，请检查后重试"
    assert update_not_found.status_code == 404
    assert update_not_found.json()["detail"] == "角色不存在"
    assert delete_not_found.status_code == 404
    assert delete_not_found.json()["detail"] == "角色不存在"
