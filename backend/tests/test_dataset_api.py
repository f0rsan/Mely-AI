import base64
import sqlite3
import struct
import zlib
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


def _build_png_bytes(width: int, height: int, color: tuple[int, int, int]) -> bytes:
    def chunk(chunk_type: bytes, payload: bytes) -> bytes:
        checksum = zlib.crc32(chunk_type + payload) & 0xFFFFFFFF
        return (
            len(payload).to_bytes(4, "big")
            + chunk_type
            + payload
            + checksum.to_bytes(4, "big")
        )

    rows: list[bytes] = []
    pixel = bytes(color)
    for _ in range(height):
        rows.append(b"\x00" + pixel * width)

    raw_data = b"".join(rows)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    idat = zlib.compress(raw_data, level=6)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", idat)
        + chunk(b"IEND", b"")
    )


def _to_base64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def test_import_dataset_generates_quality_report_and_persists_output(
    temp_data_root: Path,
) -> None:
    app = create_app()
    front = _build_png_bytes(1024, 1024, (220, 120, 140))
    side = _build_png_bytes(960, 1024, (100, 120, 240))
    back_low_res = _build_png_bytes(512, 512, (100, 220, 130))
    dup_front = front

    with TestClient(app) as client:
        created = client.post("/api/characters", json={"name": "数据集角色"})
        character_id = created.json()["id"]

        import_response = client.post(
            f"/api/characters/{character_id}/dataset/import",
            json={
                "images": [
                    {"name": "front_primary.png", "contentBase64": _to_base64(front)},
                    {"name": "side_pose.png", "contentBase64": _to_base64(side)},
                    {"name": "back_low_res.png", "contentBase64": _to_base64(back_low_res)},
                    {"name": "front_duplicate.png", "contentBase64": _to_base64(dup_front)},
                ]
            },
        )
        report_response = client.get(f"/api/characters/{character_id}/dataset/report")

    assert import_response.status_code == 200
    report = import_response.json()
    assert report["characterId"] == character_id
    assert report["totalImages"] == 4
    assert report["qualifiedImages"] == 2
    assert report["problemImages"] == 2
    assert 0 <= report["qualityScore"] <= 100
    assert report["angleDistribution"]["front"] == 2
    assert report["angleDistribution"]["side"] == 1
    assert report["angleDistribution"]["back"] == 1
    assert isinstance(report["problemItems"], list)
    assert len(report["problemItems"]) == 2
    assert report["recommendedTrainingMode"]["mode"] in {"light", "standard", "fine"}
    assert report["recommendations"]
    assert len(report["images"]) == 4
    assert report["updatedAt"]

    assert report_response.status_code == 200
    saved_report = report_response.json()
    assert saved_report["characterId"] == character_id
    assert saved_report["totalImages"] == 4
    assert saved_report["problemImages"] == 2

    training_data_dir = temp_data_root / "characters" / character_id / "training_data"
    assert training_data_dir.exists()
    stored_images = [path for path in training_data_dir.iterdir() if path.is_file()]
    assert len(stored_images) == 4

    with sqlite3.connect(temp_data_root / "db" / "mely.db") as connection:
        report_row = connection.execute(
            "SELECT report_json FROM dataset_reports WHERE character_id = ?",
            (character_id,),
        ).fetchone()
        image_count_row = connection.execute(
            "SELECT COUNT(*) FROM dataset_images WHERE character_id = ?",
            (character_id,),
        ).fetchone()

    assert report_row is not None
    assert isinstance(report_row[0], str)
    assert image_count_row is not None
    assert image_count_row[0] == 4


def test_import_dataset_returns_chinese_errors_for_invalid_input(
    temp_data_root: Path,
) -> None:
    app = create_app()
    missing_character_id = "11111111-1111-1111-1111-111111111111"

    with TestClient(app) as client:
        created = client.post("/api/characters", json={"name": "数据集校验角色"})
        character_id = created.json()["id"]

        bad_payload_response = client.post(
            f"/api/characters/{character_id}/dataset/import",
            json={"images": [{"name": "bad.png", "contentBase64": "not-base64"}]},
        )

        missing_character_response = client.post(
            f"/api/characters/{missing_character_id}/dataset/import",
            json={
                "images": [
                    {
                        "name": "front.png",
                        "contentBase64": _to_base64(_build_png_bytes(800, 800, (40, 40, 40))),
                    }
                ]
            },
        )

    assert bad_payload_response.status_code == 400
    assert bad_payload_response.json()["detail"] == "图片导入失败，请检查图片格式后重试"
    assert missing_character_response.status_code == 404
    assert missing_character_response.json()["detail"] == "角色不存在"


def test_get_dataset_report_requires_existing_report(temp_data_root: Path) -> None:
    app = create_app()

    with TestClient(app) as client:
        created = client.post("/api/characters", json={"name": "未导入数据集角色"})
        character_id = created.json()["id"]
        response = client.get(f"/api/characters/{character_id}/dataset/report")

    assert response.status_code == 404
    assert response.json()["detail"] == "训练数据集尚未导入，请先上传图片。"
