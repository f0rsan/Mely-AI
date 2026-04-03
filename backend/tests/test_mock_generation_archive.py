"""Tests for mock generation auto-archive (M3 mock loop)."""
import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


def _create_char_with_lora(client: TestClient) -> tuple[str, str]:
    """Create a character with completed LoRA, return (char_id, costume_id)."""
    resp = client.post(
        "/api/characters",
        json={
            "name": "Mock Gen Char",
            "visual": {
                "loraPath": "/tmp/test.pt",
                "triggerWord": "mgc",
                "trainingStatus": "completed",
            },
        },
    )
    assert resp.status_code == 201
    char_id = resp.json()["id"]
    wb = client.get(f"/api/characters/{char_id}/generation-workbench")
    assert wb.status_code == 200
    costume_id = wb.json()["selectedCostumeId"]
    return char_id, costume_id


def test_mock_generation_archives_and_message_contains_archive_id(temp_data_root):
    """Mock generation task completes and auto-archives a placeholder PNG."""
    app = create_app()
    with TestClient(app) as client:
        char_id, costume_id = _create_char_with_lora(client)

        resp = client.post(
            "/api/generations/mock",
            json={
                "characterId": char_id,
                "costumeId": costume_id,
                "scenePrompt": "mgc, sakura background",
                "width": 512,
                "height": 512,
                "steps": 20,
                "sampler": "Euler a",
                "cfgScale": 7.0,
                "seed": 42,
                "loraWeight": 0.8,
            },
        )
        assert resp.status_code == 202
        task_id = resp.json()["job"]["taskId"]

        # Poll task until completed (TestClient uses real async executor).
        for _ in range(50):
            task_resp = client.get(f"/api/tasks/{task_id}")
            if task_resp.status_code == 200:
                task = task_resp.json()
                if task["status"] in ("completed", "failed"):
                    break
            import time; time.sleep(0.1)

        assert task["status"] == "completed", f"Task ended in: {task['status']}, error: {task.get('error')}"

        # task.message must be JSON with archiveId.
        message = task.get("message", "")
        parsed = json.loads(message)
        assert parsed.get("event") == "generation_archived"
        assert "archiveId" in parsed, f"Expected archiveId in message, got: {message}"
        archive_id = parsed["archiveId"]
        assert isinstance(archive_id, str) and len(archive_id) > 0

        # The archive record must exist in DB (via list endpoint).
        list_resp = client.get(f"/api/characters/{char_id}/generations")
        assert list_resp.status_code == 200
        items = list_resp.json()["items"]
        assert len(items) == 1
        ids = [item["id"] for item in items]
        assert archive_id in ids


def test_get_generation_archive_returns_record(temp_data_root):
    """GET /api/generations/{id} returns the archived record."""
    app = create_app()
    with TestClient(app) as client:
        char_id, costume_id = _create_char_with_lora(client)

        # Archive manually to get a known ID.
        import base64, struct, zlib

        def _minimal_png_b64() -> str:
            W, H = 8, 8
            row = b"\x00" + b"\xaa\xbb\xcc" * W
            idat = zlib.compress(row * H)
            def ck(n, d):
                c = n + d
                return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
            png = (b"\x89PNG\r\n\x1a\n"
                   + ck(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
                   + ck(b"IDAT", idat) + ck(b"IEND", b""))
            return base64.b64encode(png).decode()

        archive_resp = client.post(
            "/api/generations/archive",
            json={
                "characterId": char_id,
                "costumeId": costume_id,
                "assembledPrompt": "mgc, test scene",
                "width": 512, "height": 512, "steps": 20,
                "sampler": "Euler a", "cfgScale": 7.0,
                "seed": 1, "loraWeight": 0.8,
                "imageDataB64": _minimal_png_b64(),
            },
        )
        assert archive_resp.status_code == 201
        gen_id = archive_resp.json()["id"]

        # Fetch by ID.
        get_resp = client.get(f"/api/generations/{gen_id}")
        assert get_resp.status_code == 200
        record = get_resp.json()
        assert record["id"] == gen_id
        assert record["characterId"] == char_id
        assert record["costumeId"] == costume_id
        assert "outputPath" in record
        assert "paramsSnapshot" in record
        assert "createdAt" in record


def test_get_generation_archive_404_for_unknown(temp_data_root):
    """GET /api/generations/{id} returns 404 for non-existent record."""
    app = create_app()
    with TestClient(app) as client:
        resp = client.get("/api/generations/nonexistent-id-xyz")
        assert resp.status_code == 404
