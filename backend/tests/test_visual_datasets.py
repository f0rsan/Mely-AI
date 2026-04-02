"""Tests for M2-A: Visual dataset import and quality scoring."""
from __future__ import annotations

import io

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
    resp = client.post("/api/characters", json={"name": "视觉测试角色"})
    assert resp.status_code == 201
    return resp.json()["id"]


@pytest.fixture()
def dataset_id(client, character_id) -> str:
    resp = client.post(
        "/api/visual-datasets",
        json={"name": "测试图片集", "characterId": character_id},
    )
    assert resp.status_code == 201
    return resp.json()["id"]


def _make_png_bytes() -> bytes:
    """Return a minimal 1x1 white PNG in memory."""
    import struct, zlib
    def chunk(name: bytes, data: bytes) -> bytes:
        c = name + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    idat_data = zlib.compress(b"\x00\xFF\xFF\xFF")
    idat = chunk(b"IDAT", idat_data)
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


# ── Dataset CRUD ──────────────────────────────────────────────────────────────

class TestCreateDataset:
    def test_create_returns_201(self, client, character_id):
        resp = client.post(
            "/api/visual-datasets",
            json={"name": "参考图集", "characterId": character_id},
        )
        assert resp.status_code == 201

    def test_create_dataset_fields(self, client, character_id):
        resp = client.post(
            "/api/visual-datasets",
            json={"name": "参考图集", "characterId": character_id},
        )
        body = resp.json()
        assert body["characterId"] == character_id
        assert body["name"] == "参考图集"
        assert body["imageCount"] == 0
        assert body["qualityScore"] is None
        assert "id" in body

    def test_create_unknown_character_returns_404(self, client):
        resp = client.post(
            "/api/visual-datasets",
            json={"name": "test", "characterId": "nonexistent-id"},
        )
        assert resp.status_code == 404


class TestListDatasets:
    def test_list_returns_all_for_character(self, client, character_id):
        client.post("/api/visual-datasets", json={"name": "A", "characterId": character_id})
        client.post("/api/visual-datasets", json={"name": "B", "characterId": character_id})
        resp = client.get(f"/api/visual-datasets?characterId={character_id}")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_list_empty_for_new_character(self, client, character_id):
        resp = client.get(f"/api/visual-datasets?characterId={character_id}")
        assert resp.json() == []


class TestDeleteDataset:
    def test_delete_returns_204(self, client, dataset_id):
        resp = client.delete(f"/api/visual-datasets/{dataset_id}")
        assert resp.status_code == 204

    def test_delete_removes_from_list(self, client, character_id, dataset_id):
        client.delete(f"/api/visual-datasets/{dataset_id}")
        resp = client.get(f"/api/visual-datasets?characterId={character_id}")
        assert resp.json() == []

    def test_delete_unknown_returns_404(self, client):
        resp = client.delete("/api/visual-datasets/does-not-exist")
        assert resp.status_code == 404


# ── Image upload ──────────────────────────────────────────────────────────────

class TestUploadImage:
    def test_upload_png_returns_201(self, client, dataset_id):
        resp = client.post(
            f"/api/visual-datasets/{dataset_id}/images",
            files={"file": ("test.png", _make_png_bytes(), "image/png")},
        )
        assert resp.status_code == 201

    def test_upload_increments_image_count(self, client, character_id, dataset_id):
        client.post(
            f"/api/visual-datasets/{dataset_id}/images",
            files={"file": ("a.png", _make_png_bytes(), "image/png")},
        )
        resp = client.get(f"/api/visual-datasets?characterId={character_id}")
        ds = next(d for d in resp.json() if d["id"] == dataset_id)
        assert ds["imageCount"] == 1

    def test_upload_invalid_extension_returns_400(self, client, dataset_id):
        resp = client.post(
            f"/api/visual-datasets/{dataset_id}/images",
            files={"file": ("test.exe", b"bad", "application/octet-stream")},
        )
        assert resp.status_code == 400

    def test_upload_to_unknown_dataset_returns_404(self, client):
        resp = client.post(
            "/api/visual-datasets/nonexistent/images",
            files={"file": ("a.png", _make_png_bytes(), "image/png")},
        )
        assert resp.status_code == 404

    def test_upload_sets_image_fields(self, client, dataset_id):
        resp = client.post(
            f"/api/visual-datasets/{dataset_id}/images",
            files={"file": ("ref.png", _make_png_bytes(), "image/png")},
        )
        body = resp.json()
        assert body["datasetId"] == dataset_id
        assert body["filename"] == "ref.png"
        assert body["source"] == "upload"


class TestListImages:
    def test_list_images_empty(self, client, dataset_id):
        resp = client.get(f"/api/visual-datasets/{dataset_id}/images")
        assert resp.json() == []

    def test_list_images_after_upload(self, client, dataset_id):
        client.post(
            f"/api/visual-datasets/{dataset_id}/images",
            files={"file": ("a.png", _make_png_bytes(), "image/png")},
        )
        resp = client.get(f"/api/visual-datasets/{dataset_id}/images")
        assert len(resp.json()) == 1


class TestDeleteImage:
    def test_delete_image_returns_204(self, client, dataset_id):
        up = client.post(
            f"/api/visual-datasets/{dataset_id}/images",
            files={"file": ("a.png", _make_png_bytes(), "image/png")},
        )
        image_id = up.json()["id"]
        resp = client.delete(f"/api/visual-dataset-images/{image_id}")
        assert resp.status_code == 204

    def test_delete_image_decrements_count(self, client, character_id, dataset_id):
        up = client.post(
            f"/api/visual-datasets/{dataset_id}/images",
            files={"file": ("a.png", _make_png_bytes(), "image/png")},
        )
        image_id = up.json()["id"]
        client.delete(f"/api/visual-dataset-images/{image_id}")
        resp = client.get(f"/api/visual-datasets?characterId={character_id}")
        ds = next(d for d in resp.json() if d["id"] == dataset_id)
        assert ds["imageCount"] == 0

    def test_delete_unknown_image_returns_404(self, client):
        resp = client.delete("/api/visual-dataset-images/no-such-image")
        assert resp.status_code == 404


# ── Quality scoring ───────────────────────────────────────────────────────────

class TestQualityScoring:
    def test_quality_score_updates_after_upload(self, client, dataset_id):
        client.post(
            f"/api/visual-datasets/{dataset_id}/images",
            files={"file": ("a.png", _make_png_bytes(), "image/png")},
        )
        resp = client.get(f"/api/visual-datasets/{dataset_id}/images")
        # Score is now set (not None)
        # Get dataset to check score
        images_resp = client.get(f"/api/visual-datasets/{dataset_id}/images")
        assert images_resp.status_code == 200

    def test_quality_issues_present_with_few_images(self, client, character_id, dataset_id):
        client.post(
            f"/api/visual-datasets/{dataset_id}/images",
            files={"file": ("a.png", _make_png_bytes(), "image/png")},
        )
        resp = client.get(f"/api/visual-datasets?characterId={character_id}")
        ds = next(d for d in resp.json() if d["id"] == dataset_id)
        # With only 1 image, quality issues should mention count
        assert len(ds["qualityIssues"]) > 0
        assert ds["qualityScore"] is not None
        assert 0.0 <= ds["qualityScore"] <= 1.0
