"""Tests for the generation archiving service and API endpoints."""
import base64
import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.db.connection import connect_database
from app.db.migrations import apply_migrations
from app.main import create_app
from app.schemas.archive import GenerationArchiveRequest
from app.services.generation_archive import (
    GenerationArchiveRequestError,
    archive_generation,
    list_generation_archives,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def db_and_root(tmp_path: Path):
    """Return (connection, data_root) with a bootstrapped schema."""
    data_root = tmp_path / ".mely-test"
    data_root.mkdir(parents=True)
    db_path = data_root / "db" / "mely.db"
    db_path.parent.mkdir(parents=True)

    with connect_database(db_path) as conn:
        # migrations/ lives at backend/migrations relative to the backend root.
        backend_root = Path(__file__).resolve().parents[1]
        apply_migrations(conn, backend_root / "migrations")
        conn.row_factory = sqlite3.Row

        # Insert a stub character and costume so FK constraints pass.
        conn.execute(
            "INSERT INTO characters (id, name, created_at) VALUES (?, ?, ?)",
            ("char-1", "Test Character", "2026-01-01T00:00:00Z"),
        )
        conn.execute(
            "INSERT INTO costumes (id, character_id, name, costume_prompt, created_at) VALUES (?, ?, ?, ?, ?)",
            ("costume-1", "char-1", "基础造型", "", "2026-01-01T00:00:00Z"),
        )
        conn.commit()
        yield conn, data_root


def make_request(**overrides) -> GenerationArchiveRequest:
    defaults = dict(
        characterId="char-1",
        costumeId="costume-1",
        assembledPrompt="hoshino_mika, pink hair, 在咖啡馆里看书",
        negativePrompt="",
        width=1024,
        height=1024,
        steps=28,
        sampler="DPM++ 2M Karras",
        cfgScale=3.5,
        seed=42,
        loraWeight=0.85,
        tags=["封面图"],
        imageDataB64=PNG_B64,
    )
    defaults.update(overrides)
    return GenerationArchiveRequest(**defaults)


# Minimal 1x1 transparent PNG bytes encoded as base64.
PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
    b"\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)
PNG_B64 = base64.b64encode(PNG_BYTES).decode()


# ---------------------------------------------------------------------------
# Service layer tests
# ---------------------------------------------------------------------------


def test_archive_creates_db_record(db_and_root):
    conn, data_root = db_and_root
    req = make_request()
    record = archive_generation(conn, data_root, req)

    row = conn.execute(
        "SELECT * FROM generations WHERE id = ?", (record.id,)
    ).fetchone()
    assert row is not None
    assert row["character_id"] == "char-1"
    assert row["costume_id"] == "costume-1"
    assert row["type"] == "txt2img"


def test_archive_stores_params_snapshot(db_and_root):
    conn, data_root = db_and_root
    req = make_request(seed=1234, steps=30)
    record = archive_generation(conn, data_root, req)

    row = conn.execute(
        "SELECT params_snapshot FROM generations WHERE id = ?", (record.id,)
    ).fetchone()
    params = json.loads(row["params_snapshot"])
    assert params["seed"] == 1234
    assert params["steps"] == 30
    assert params["assembledPrompt"] == "hoshino_mika, pink hair, 在咖啡馆里看书"


def test_archive_stores_tags(db_and_root):
    conn, data_root = db_and_root
    req = make_request(tags=["封面图", "表情包"])
    record = archive_generation(conn, data_root, req)

    tags = [
        r["tag"]
        for r in conn.execute(
            "SELECT tag FROM generation_tags WHERE generation_id = ?", (record.id,)
        ).fetchall()
    ]
    assert sorted(tags) == ["封面图", "表情包"]


def test_archive_rejects_missing_image_data_and_leaves_no_artifacts(db_and_root):
    conn, data_root = db_and_root
    before_count = conn.execute("SELECT COUNT(*) AS c FROM generations").fetchone()["c"]
    req = make_request(imageDataB64=None)

    with pytest.raises(GenerationArchiveRequestError) as exc_info:
        archive_generation(conn, data_root, req)

    assert "真实图片数据" in str(exc_info.value)
    after_count = conn.execute("SELECT COUNT(*) AS c FROM generations").fetchone()["c"]
    assert after_count == before_count
    gen_dir = data_root / "characters" / "char-1" / "generations"
    assert list(gen_dir.glob("*.png")) == []


def test_archive_writes_image_from_base64(db_and_root):
    conn, data_root = db_and_root
    req = make_request(imageDataB64=PNG_B64)
    record = archive_generation(conn, data_root, req)

    image_path = Path(record.output_path)
    assert image_path.read_bytes() == PNG_BYTES


def test_archive_record_has_correct_output_path(db_and_root):
    conn, data_root = db_and_root
    req = make_request()
    record = archive_generation(conn, data_root, req)

    expected_dir = data_root / "characters" / "char-1" / "generations"
    assert Path(record.output_path).parent == expected_dir


def test_archive_returns_record_with_tags(db_and_root):
    conn, data_root = db_and_root
    req = make_request(tags=["预告图"])
    record = archive_generation(conn, data_root, req)

    assert record.tags == ["预告图"]
    assert record.character_id == "char-1"
    assert record.created_at.endswith("Z")


def test_list_archives_returns_newest_first(db_and_root):
    conn, data_root = db_and_root
    first = archive_generation(conn, data_root, make_request(assembledPrompt="first"))
    # Bump created_at so ordering is deterministic even within the same second.
    conn.execute(
        "UPDATE generations SET created_at = '2026-01-01T00:00:01Z' WHERE id = ?",
        (first.id,),
    )
    conn.commit()
    archive_generation(conn, data_root, make_request(assembledPrompt="second"))
    # second record will have a later timestamp (current time ≥ 2026-01-01T00:00:01Z).

    records = list_generation_archives(conn, "char-1")
    assert len(records) == 2
    prompts = [r.params_snapshot["assembledPrompt"] for r in records]
    # "second" must appear before "first" (DESC order).
    assert prompts.index("second") < prompts.index("first")


def test_list_archives_returns_empty_for_unknown_character(db_and_root):
    conn, data_root = db_and_root
    records = list_generation_archives(conn, "nonexistent")
    assert records == []


def test_list_archives_respects_limit_and_offset(db_and_root):
    conn, data_root = db_and_root
    for i in range(5):
        archive_generation(conn, data_root, make_request(assembledPrompt=f"prompt-{i}"))

    page1 = list_generation_archives(conn, "char-1", limit=2, offset=0)
    page2 = list_generation_archives(conn, "char-1", limit=2, offset=2)
    assert len(page1) == 2
    assert len(page2) == 2
    # No overlap.
    ids1 = {r.id for r in page1}
    ids2 = {r.id for r in page2}
    assert ids1.isdisjoint(ids2)


def test_invalid_base64_raises_archive_error(db_and_root):
    conn, data_root = db_and_root
    before_count = conn.execute("SELECT COUNT(*) AS c FROM generations").fetchone()["c"]
    req = make_request(imageDataB64="not-valid-base64!!!")
    with pytest.raises(GenerationArchiveRequestError) as exc_info:
        archive_generation(conn, data_root, req)
    assert "解码" in str(exc_info.value)
    after_count = conn.execute("SELECT COUNT(*) AS c FROM generations").fetchone()["c"]
    assert after_count == before_count
    gen_dir = data_root / "characters" / "char-1" / "generations"
    assert list(gen_dir.glob("*.png")) == []


# ---------------------------------------------------------------------------
# API tests
# ---------------------------------------------------------------------------


def test_api_archive_returns_201_with_record(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        # Create character + costume via API.
        char_resp = client.post(
            "/api/characters",
            json={
                "name": "Test Char",
                "visual": {"loraPath": "/tmp/lora.pt", "triggerWord": "tc", "trainingStatus": "completed"},
            },
        )
        assert char_resp.status_code == 201
        char_id = char_resp.json()["id"]

        # Get a valid costume_id (auto-created by workbench bootstrap).
        wb_resp = client.get(f"/api/characters/{char_id}/generation-workbench")
        costume_id = wb_resp.json()["selectedCostumeId"]

        resp = client.post(
            "/api/generations/archive",
            json={
                "characterId": char_id,
                "costumeId": costume_id,
                "assembledPrompt": "tc, pink hair, 在咖啡馆",
                "width": 1024,
                "height": 1024,
                "steps": 28,
                "sampler": "DPM++ 2M Karras",
                "cfgScale": 3.5,
                "seed": 99,
                "loraWeight": 0.85,
                "tags": ["封面图"],
                "imageDataB64": PNG_B64,
            },
        )

    assert resp.status_code == 201
    data = resp.json()
    assert data["characterId"] == char_id
    assert data["costumeId"] == costume_id
    assert data["tags"] == ["封面图"]
    assert data["paramsSnapshot"]["seed"] == 99
    assert data["outputPath"].endswith(".png")


def test_api_list_archives_returns_array(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        char_resp = client.post(
            "/api/characters",
            json={
                "name": "Test Char",
                "visual": {"loraPath": "/tmp/lora.pt", "triggerWord": "tc", "trainingStatus": "completed"},
            },
        )
        char_id = char_resp.json()["id"]
        wb_resp = client.get(f"/api/characters/{char_id}/generation-workbench")
        costume_id = wb_resp.json()["selectedCostumeId"]

        payload = {
            "characterId": char_id, "costumeId": costume_id,
            "assembledPrompt": "tc, smiling", "width": 512, "height": 512,
            "steps": 20, "sampler": "Euler a", "cfgScale": 7.0,
            "seed": None, "loraWeight": 0.8, "tags": [],
            "imageDataB64": PNG_B64,
        }
        client.post("/api/generations/archive", json=payload)
        client.post("/api/generations/archive", json=payload)

        list_resp = client.get(f"/api/characters/{char_id}/generations")

    assert list_resp.status_code == 200
    items = list_resp.json()["items"]
    assert len(items) == 2


def test_api_archive_404_for_unknown_character(temp_data_root):
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        resp = client.post(
            "/api/generations/archive",
            json={
                "characterId": "nonexistent",
                "costumeId": "c1",
                "assembledPrompt": "test",
                "width": 512, "height": 512, "steps": 20,
                "sampler": "Euler a", "cfgScale": 7.0,
                "seed": None, "loraWeight": 0.8,
                "imageDataB64": PNG_B64,
            },
        )
    assert resp.status_code == 404


def test_api_archive_422_when_image_data_missing(temp_data_root):
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        char_resp = client.post(
            "/api/characters",
            json={
                "name": "Test Char",
                "visual": {"loraPath": "/tmp/lora.pt", "triggerWord": "tc", "trainingStatus": "completed"},
            },
        )
        char_id = char_resp.json()["id"]
        wb_resp = client.get(f"/api/characters/{char_id}/generation-workbench")
        costume_id = wb_resp.json()["selectedCostumeId"]

        resp = client.post(
            "/api/generations/archive",
            json={
                "characterId": char_id,
                "costumeId": costume_id,
                "assembledPrompt": "tc, smiling",
                "width": 512,
                "height": 512,
                "steps": 20,
                "sampler": "Euler a",
                "cfgScale": 7.0,
                "seed": None,
                "loraWeight": 0.8,
                "tags": [],
                "imageDataB64": None,
            },
        )

        list_resp = client.get(f"/api/characters/{char_id}/generations")

    assert resp.status_code == 422
    assert "真实图片数据" in resp.json()["detail"]
    assert list_resp.status_code == 200
    assert list_resp.json()["items"] == []
