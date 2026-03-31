"""Tests for the generation history gallery — image serving endpoint."""
import base64
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


def _create_char_costume_and_archive(client: TestClient, png_b64: str) -> str:
    """Create a character, archive a generation, return generation id."""
    char_resp = client.post(
        "/api/characters",
        json={
            "name": "Gallery Char",
            "visual": {"loraPath": "/tmp/lora.pt", "triggerWord": "gc", "trainingStatus": "completed"},
        },
    )
    assert char_resp.status_code == 201
    char_id = char_resp.json()["id"]

    wb_resp = client.get(f"/api/characters/{char_id}/generation-workbench")
    costume_id = wb_resp.json()["selectedCostumeId"]

    archive_resp = client.post(
        "/api/generations/archive",
        json={
            "characterId": char_id,
            "costumeId": costume_id,
            "assembledPrompt": "gc, pink hair",
            "width": 512, "height": 512, "steps": 20,
            "sampler": "Euler a", "cfgScale": 7.0,
            "seed": 1, "loraWeight": 0.8,
            "imageDataB64": png_b64,
        },
    )
    assert archive_resp.status_code == 201
    return archive_resp.json()["id"]


# Minimal 1×1 transparent PNG.
_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
    b"\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)
_PNG_B64 = base64.b64encode(_PNG_BYTES).decode()


def test_image_endpoint_returns_200_with_png(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        gen_id = _create_char_costume_and_archive(client, _PNG_B64)
        resp = client.get(f"/api/generations/{gen_id}/image")

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("image/png")
    assert resp.content == _PNG_BYTES


def test_image_endpoint_404_for_unknown_id(temp_data_root):
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        resp = client.get("/api/generations/nonexistent-id/image")

    assert resp.status_code == 404


def test_list_includes_archived_record(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        char_resp = client.post(
            "/api/characters",
            json={
                "name": "List Char",
                "visual": {"loraPath": "/tmp/lora.pt", "triggerWord": "lc", "trainingStatus": "completed"},
            },
        )
        char_id = char_resp.json()["id"]
        wb_resp = client.get(f"/api/characters/{char_id}/generation-workbench")
        costume_id = wb_resp.json()["selectedCostumeId"]

        for i in range(3):
            client.post(
                "/api/generations/archive",
                json={
                    "characterId": char_id, "costumeId": costume_id,
                    "assembledPrompt": f"lc, scene {i}", "width": 512, "height": 512,
                    "steps": 20, "sampler": "Euler a", "cfgScale": 7.0,
                    "seed": i, "loraWeight": 0.8,
                },
            )

        list_resp = client.get(f"/api/characters/{char_id}/generations")

    assert list_resp.status_code == 200
    items = list_resp.json()["items"]
    assert len(items) == 3
    # Each item must have required gallery fields.
    for item in items:
        assert "id" in item
        assert "outputPath" in item
        assert "paramsSnapshot" in item
        assert "createdAt" in item
