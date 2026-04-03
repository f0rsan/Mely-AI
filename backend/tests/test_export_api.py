"""Tests for Export API HTTP layer — M4-C."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _insert_character(app_state, character_id: str = "char-1") -> None:
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
# export-pdf
# ---------------------------------------------------------------------------


def test_export_pdf_202(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        _insert_character(app.state)
        resp = client.post("/api/characters/char-1/export-pdf")
    assert resp.status_code == 202
    data = resp.json()
    assert data["characterId"] == "char-1"
    assert "exportId" in data
    assert "taskId" in data


def test_export_pdf_unknown_character_404(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        resp = client.post("/api/characters/no-such/export-pdf")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# list exports
# ---------------------------------------------------------------------------


def test_list_exports_empty(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        _insert_character(app.state)
        resp = client.get("/api/characters/char-1/exports")
    assert resp.status_code == 200
    assert resp.json()["items"] == []


def test_list_exports_after_submit(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        _insert_character(app.state)
        client.post("/api/characters/char-1/export-pdf")
        resp = client.get("/api/characters/char-1/exports")
    assert resp.status_code == 200
    assert len(resp.json()["items"]) == 1


def test_list_exports_unknown_character_404(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        resp = client.get("/api/characters/no-such/exports")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# proof-chain
# ---------------------------------------------------------------------------


def test_proof_chain_empty(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        _insert_character(app.state)
        resp = client.get("/api/characters/char-1/proof-chain")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["chain"] == []


def test_proof_chain_unknown_character_404(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        resp = client.get("/api/characters/no-such/proof-chain")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# proof-chain/verify
# ---------------------------------------------------------------------------


def test_verify_proof_chain_empty_valid(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        _insert_character(app.state)
        resp = client.get("/api/characters/char-1/proof-chain/verify")
    assert resp.status_code == 200
    data = resp.json()
    assert data["isValid"] is True
    assert data["totalProofs"] == 0


def test_verify_proof_chain_unknown_character_404(temp_data_root):
    app = create_app()
    with TestClient(app) as client:
        resp = client.get("/api/characters/no-such/proof-chain/verify")
    assert resp.status_code == 404
