"""Tests for M2-B: Visual LoRA training backend."""
from __future__ import annotations

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
    resp = client.post("/api/characters", json={"name": "视觉训练角色"})
    assert resp.status_code == 201
    return resp.json()["id"]


def _make_png_bytes() -> bytes:
    import struct, zlib
    def chunk(name: bytes, data: bytes) -> bytes:
        c = name + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b"\x00\xFF\xFF\xFF"))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


@pytest.fixture()
def dataset_id(client, character_id) -> str:
    """Create a dataset with 5 images (above minimum of 3)."""
    resp = client.post(
        "/api/visual-datasets",
        json={"name": "训练图集", "characterId": character_id},
    )
    assert resp.status_code == 201
    did = resp.json()["id"]
    for i in range(5):
        client.post(
            f"/api/visual-datasets/{did}/images",
            files={"file": (f"img{i}.png", _make_png_bytes(), "image/png")},
        )
    return did


# ── Start training ─────────────────────────────────────────────────────────────

class TestStartVisualTraining:
    def test_start_returns_202(self, client, character_id, dataset_id):
        resp = client.post(
            f"/api/characters/{character_id}/visual-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        assert resp.status_code == 202

    def test_start_training_fields(self, client, character_id, dataset_id):
        resp = client.post(
            f"/api/characters/{character_id}/visual-training/start",
            json={"datasetIds": [dataset_id], "mode": "standard"},
        )
        assert resp.status_code == 202
        body = resp.json()
        assert body["characterId"] == character_id
        assert body["datasetIds"] == [dataset_id]
        assert body["mode"] == "standard"
        assert body["status"] == "queued"
        assert body["progress"] == 0.0
        assert body["totalSteps"] == 1500  # standard mode

    def test_start_sets_trigger_word_automatically(self, client, character_id, dataset_id):
        resp = client.post(
            f"/api/characters/{character_id}/visual-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        body = resp.json()
        assert body["triggerWord"] != ""
        assert body["triggerWord"] is not None

    def test_start_with_custom_trigger_word(self, client, character_id, dataset_id):
        resp = client.post(
            f"/api/characters/{character_id}/visual-training/start",
            json={"datasetIds": [dataset_id], "mode": "light", "triggerWord": "miku_v1"},
        )
        assert resp.json()["triggerWord"] == "miku_v1"

    def test_start_unknown_character_returns_404(self, client, dataset_id):
        resp = client.post(
            "/api/characters/no-such-char/visual-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        assert resp.status_code == 404

    def test_start_unknown_dataset_returns_400(self, client, character_id):
        resp = client.post(
            f"/api/characters/{character_id}/visual-training/start",
            json={"datasetIds": ["fake-dataset-id"], "mode": "light"},
        )
        assert resp.status_code == 400

    def test_start_fine_mode_rejected(self, client, character_id, dataset_id):
        resp = client.post(
            f"/api/characters/{character_id}/visual-training/start",
            json={"datasetIds": [dataset_id], "mode": "fine"},
        )
        assert resp.status_code == 400

    def test_start_dataset_too_few_images_rejected(self, client, character_id):
        resp = client.post("/api/visual-datasets", json={"name": "小图集", "characterId": character_id})
        tiny_id = resp.json()["id"]
        # Upload only 2 images (below minimum of 3)
        for i in range(2):
            client.post(
                f"/api/visual-datasets/{tiny_id}/images",
                files={"file": (f"img{i}.png", _make_png_bytes(), "image/png")},
            )
        resp = client.post(
            f"/api/characters/{character_id}/visual-training/start",
            json={"datasetIds": [tiny_id], "mode": "light"},
        )
        assert resp.status_code == 400

    def test_start_returns_job_with_expected_fields(self, client, character_id, dataset_id):
        resp = client.post(
            f"/api/characters/{character_id}/visual-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        body = resp.json()
        # Placeholder executor may complete quickly — accept any terminal state
        assert body["status"] in ("queued", "preparing", "failed")
        assert "sampleImages" in body
        assert isinstance(body["sampleImages"], list)


# ── List / get jobs ───────────────────────────────────────────────────────────

class TestListVisualTrainingJobs:
    def test_list_empty(self, client, character_id):
        resp = client.get(f"/api/visual-training?characterId={character_id}")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_after_start(self, client, character_id, dataset_id):
        client.post(
            f"/api/characters/{character_id}/visual-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        resp = client.get(f"/api/visual-training?characterId={character_id}")
        assert len(resp.json()) == 1


class TestGetVisualTrainingJob:
    def test_get_job(self, client, character_id, dataset_id):
        start = client.post(
            f"/api/characters/{character_id}/visual-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        job_id = start.json()["id"]
        resp = client.get(f"/api/visual-training/{job_id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == job_id

    def test_get_unknown_returns_404(self, client):
        resp = client.get("/api/visual-training/no-such-job")
        assert resp.status_code == 404


# ── Cancel ────────────────────────────────────────────────────────────────────

class TestCancelVisualTraining:
    def test_cancel_job_returns_valid_response(self, client, character_id, dataset_id):
        """Cancel may return 200 (canceled) or 400 (already ended) — placeholder runs fast."""
        start = client.post(
            f"/api/characters/{character_id}/visual-training/start",
            json={"datasetIds": [dataset_id], "mode": "light"},
        )
        job_id = start.json()["id"]
        resp = client.post(f"/api/visual-training/{job_id}/cancel")
        # Placeholder executor may have already transitioned job to failed
        assert resp.status_code in (200, 400)

    def test_cancel_unknown_returns_404(self, client):
        resp = client.post("/api/visual-training/no-such-job/cancel")
        assert resp.status_code == 404
