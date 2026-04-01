"""Tests for ProofService — SHA-256 hash chain — M4-C."""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app.services.proof_service import (
    compute_data_hash,
    compute_file_hash,
    create_proof,
    export_proof_chain,
    get_last_proof,
    verify_proof_chain,
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _open_conn(db_path: Path) -> sqlite3.Connection:
    from app.db.connection import connect_database
    conn = connect_database(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def _insert_character(db_path: Path, character_id: str = "char-1") -> None:
    conn = _open_conn(db_path)
    with conn:
        conn.execute(
            "INSERT INTO characters (id, name, created_at) VALUES (?, ?, datetime('now'))",
            (character_id, "测试角色"),
        )
    conn.close()


# ---------------------------------------------------------------------------
# compute_data_hash
# ---------------------------------------------------------------------------


def test_compute_data_hash_deterministic():
    params = {"b": 2, "a": 1}
    h1 = compute_data_hash(params)
    h2 = compute_data_hash({"a": 1, "b": 2})
    assert h1 == h2  # sorted keys → same hash


def test_compute_data_hash_differs_on_different_data():
    h1 = compute_data_hash({"x": "foo"})
    h2 = compute_data_hash({"x": "bar"})
    assert h1 != h2


# ---------------------------------------------------------------------------
# compute_file_hash
# ---------------------------------------------------------------------------


def test_compute_file_hash(tmp_path):
    f = tmp_path / "test.bin"
    f.write_bytes(b"hello world")
    h = compute_file_hash(f)
    assert len(h) == 64  # SHA-256 hex digest


# ---------------------------------------------------------------------------
# create_proof
# ---------------------------------------------------------------------------


def test_create_first_proof(temp_data_root):
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)

    conn = _open_conn(bs.db_path)
    proof = create_proof(conn, "char-1", "costume_created", {"name": "默认造型"})
    conn.close()

    assert proof.character_id == "char-1"
    assert proof.operation_type == "costume_created"
    assert proof.prev_proof_hash is None
    assert len(proof.proof_hash) == 64


def test_create_second_proof_links_to_first(temp_data_root):
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)

    conn = _open_conn(bs.db_path)
    p1 = create_proof(conn, "char-1", "costume_created", {"name": "默认造型"})
    p2 = create_proof(conn, "char-1", "pdf_export", {"export_id": "ex-1"})
    conn.close()

    assert p2.prev_proof_hash == p1.proof_hash


# ---------------------------------------------------------------------------
# get_last_proof
# ---------------------------------------------------------------------------


def test_get_last_proof_none_when_empty(temp_data_root):
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)

    conn = _open_conn(bs.db_path)
    result = get_last_proof(conn, "char-1")
    conn.close()
    assert result is None


def test_get_last_proof_returns_something(temp_data_root):
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)

    conn = _open_conn(bs.db_path)
    p1 = create_proof(conn, "char-1", "op_a", {})
    p2 = create_proof(conn, "char-1", "op_b", {})
    last = get_last_proof(conn, "char-1")
    conn.close()

    assert last is not None
    # last must be one of the two proofs
    assert last.id in {p1.id, p2.id}


# ---------------------------------------------------------------------------
# export_proof_chain + verify_proof_chain
# ---------------------------------------------------------------------------


def test_export_proof_chain_empty(temp_data_root):
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)

    conn = _open_conn(bs.db_path)
    chain = export_proof_chain(conn, "char-1")
    conn.close()
    assert chain == []


def test_verify_empty_chain_is_valid():
    valid, err = verify_proof_chain([])
    assert valid is True
    assert err is None


def test_verify_chain_valid(temp_data_root):
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)

    conn = _open_conn(bs.db_path)
    create_proof(conn, "char-1", "op1", {"x": 1})
    create_proof(conn, "char-1", "op2", {"x": 2})
    chain = export_proof_chain(conn, "char-1")
    conn.close()

    valid, err = verify_proof_chain(chain)
    assert valid is True
    assert err is None


def test_verify_chain_detects_tamper(temp_data_root):
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)

    conn = _open_conn(bs.db_path)
    create_proof(conn, "char-1", "op1", {"x": 1})
    chain = export_proof_chain(conn, "char-1")
    conn.close()

    # Tamper with proof_hash
    tampered = [dict(chain[0])]
    tampered[0]["proof_hash"] = "deadbeef" * 8
    valid, err = verify_proof_chain(tampered)
    assert valid is False
    assert err is not None
