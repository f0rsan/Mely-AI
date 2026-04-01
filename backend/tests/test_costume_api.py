"""Tests for Costume API HTTP layer — M4-A.

All database interactions use the real SQLite (via temp_data_root).
The lifespan runs via `with TestClient(app) as client:`.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _insert_character(app_state, character_id: str = "char-1") -> None:
    """Insert a test character after the app has bootstrapped."""
    import sqlite3
    from app.db.connection import connect_database
    conn = connect_database(app_state.bootstrap.db_path)
    with conn:
        conn.execute(
            "INSERT INTO characters (id, name, created_at) VALUES (?, ?, datetime('now'))",
            (character_id, "测试角色"),
        )
    conn.close()


# ---------------------------------------------------------------------------
# create costume
# ---------------------------------------------------------------------------


def test_create_costume_201(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        _insert_character(app.state)
        resp = client.post(
            "/api/characters/char-1/costumes",
            json={"name": "默认造型", "costumePrompt": "a girl, blue hair"},
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "默认造型"
    assert data["characterId"] == "char-1"
    assert data["isRoot"] is True
    assert data["parentId"] is None


def test_create_costume_unknown_character_404(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        resp = client.post(
            "/api/characters/no-such-char/costumes",
            json={"name": "X", "costumePrompt": "prompt"},
        )
    assert resp.status_code == 404


def test_create_costume_invalid_parent_400(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        _insert_character(app.state)
        resp = client.post(
            "/api/characters/char-1/costumes",
            json={"name": "X", "costumePrompt": "prompt", "parentId": "bad-id"},
        )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# list costumes
# ---------------------------------------------------------------------------


def test_list_costumes_200(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        _insert_character(app.state)
        client.post(
            "/api/characters/char-1/costumes",
            json={"name": "造型A", "costumePrompt": "prompt A"},
        )
        client.post(
            "/api/characters/char-1/costumes",
            json={"name": "造型B", "costumePrompt": "prompt B"},
        )
        resp = client.get("/api/characters/char-1/costumes")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2


def test_list_costumes_unknown_character_404(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        resp = client.get("/api/characters/no-such/costumes")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# update costume
# ---------------------------------------------------------------------------


def test_update_costume_200(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        _insert_character(app.state)
        create_resp = client.post(
            "/api/characters/char-1/costumes",
            json={"name": "原名", "costumePrompt": "old prompt"},
        )
        costume_id = create_resp.json()["id"]
        resp = client.put(f"/api/costumes/{costume_id}", json={"name": "新名字"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "新名字"


def test_update_costume_not_found_404(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        resp = client.put("/api/costumes/no-such-id", json={"name": "X"})
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# delete costume
# ---------------------------------------------------------------------------


def test_delete_root_costume_409(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        _insert_character(app.state)
        create_resp = client.post(
            "/api/characters/char-1/costumes",
            json={"name": "根造型", "costumePrompt": "root"},
        )
        root_id = create_resp.json()["id"]
        resp = client.delete(f"/api/costumes/{root_id}")
    assert resp.status_code == 409


def test_delete_costume_not_found_404(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        resp = client.delete("/api/costumes/no-such-id")
    assert resp.status_code == 404


def test_delete_leaf_costume_204(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        _insert_character(app.state)
        root_resp = client.post(
            "/api/characters/char-1/costumes",
            json={"name": "根造型", "costumePrompt": "root"},
        )
        root_id = root_resp.json()["id"]

        # Create two children so deleting one doesn't trigger "last costume" rule
        child_a = client.post(
            "/api/characters/char-1/costumes",
            json={"name": "子A", "costumePrompt": "child a", "parentId": root_id},
        ).json()["id"]
        client.post(
            "/api/characters/char-1/costumes",
            json={"name": "子B", "costumePrompt": "child b", "parentId": root_id},
        )
        resp = client.delete(f"/api/costumes/{child_a}")
    assert resp.status_code == 204


# ---------------------------------------------------------------------------
# list previews
# ---------------------------------------------------------------------------


def test_list_previews_empty_200(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        _insert_character(app.state)
        create_resp = client.post(
            "/api/characters/char-1/costumes",
            json={"name": "造型", "costumePrompt": "prompt"},
        )
        costume_id = create_resp.json()["id"]
        resp = client.get(f"/api/costumes/{costume_id}/previews")
    assert resp.status_code == 200
    assert resp.json()["previews"] == []


# ---------------------------------------------------------------------------
# generate previews
# ---------------------------------------------------------------------------


def test_generate_previews_202(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        _insert_character(app.state)
        create_resp = client.post(
            "/api/characters/char-1/costumes",
            json={"name": "造型", "costumePrompt": "prompt"},
        )
        costume_id = create_resp.json()["id"]
        resp = client.post(f"/api/costumes/{costume_id}/generate-previews")
    assert resp.status_code == 202
    data = resp.json()
    assert data["costumeId"] == costume_id
    assert len(data["taskIds"]) == 4


def test_generate_previews_not_found_404(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        resp = client.post("/api/costumes/no-such/generate-previews")
    assert resp.status_code == 404
