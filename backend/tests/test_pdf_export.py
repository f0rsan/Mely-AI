"""Tests for PDF export service — M4-C."""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app.services.pdf_export import (
    PDFCharacterNotFoundError,
    aggregate_character_sheet_data,
    generate_character_sheet_pdf,
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


def _insert_dna(db_path: Path, character_id: str = "char-1") -> None:
    conn = _open_conn(db_path)
    with conn:
        conn.execute(
            """INSERT INTO character_dna
               (character_id, hair_color, eye_color, skin_tone, body_type, style, auto_prompt)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (character_id, "蓝色", "紫色", "白皙", "苗条", "赛博朋克", "blue hair, purple eyes"),
        )
    conn.close()


def _insert_costume(db_path: Path, character_id: str = "char-1") -> str:
    from uuid import uuid4
    cid = str(uuid4())
    conn = _open_conn(db_path)
    with conn:
        conn.execute(
            "INSERT INTO costumes (id, character_id, name, costume_prompt, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
            (cid, character_id, "默认造型", "default costume prompt"),
        )
    conn.close()
    return cid


# ---------------------------------------------------------------------------
# aggregate_character_sheet_data
# ---------------------------------------------------------------------------


def test_aggregate_raises_for_unknown_character(temp_data_root):
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()

    conn = _open_conn(bs.db_path)
    with pytest.raises(PDFCharacterNotFoundError):
        aggregate_character_sheet_data(conn, Path(bs.data_root), "no-such")
    conn.close()


def test_aggregate_minimal_character(temp_data_root):
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)

    conn = _open_conn(bs.db_path)
    data = aggregate_character_sheet_data(conn, Path(bs.data_root), "char-1")
    conn.close()

    assert data.character_name == "测试角色"
    assert data.character_id == "char-1"
    assert data.costumes == []
    assert data.reference_images == []


def test_aggregate_includes_dna(temp_data_root):
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)
    _insert_dna(bs.db_path)

    conn = _open_conn(bs.db_path)
    data = aggregate_character_sheet_data(conn, Path(bs.data_root), "char-1")
    conn.close()

    assert data.dna.get("发色") == "蓝色"
    assert "blue hair" in data.auto_prompt


def test_aggregate_includes_costumes(temp_data_root):
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)
    _insert_costume(bs.db_path)

    conn = _open_conn(bs.db_path)
    data = aggregate_character_sheet_data(conn, Path(bs.data_root), "char-1")
    conn.close()

    assert len(data.costumes) == 1
    assert data.costumes[0].name == "默认造型"


# ---------------------------------------------------------------------------
# generate_character_sheet_pdf
# ---------------------------------------------------------------------------


def test_generate_pdf_creates_file(temp_data_root):
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)

    conn = _open_conn(bs.db_path)
    data = aggregate_character_sheet_data(conn, Path(bs.data_root), "char-1")
    conn.close()

    pdf_path = generate_character_sheet_pdf(data, Path(bs.data_root), "char-1")

    assert pdf_path.exists()
    assert pdf_path.suffix == ".pdf"
    assert pdf_path.stat().st_size > 0


def test_generate_pdf_with_dna(temp_data_root):
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)
    _insert_dna(bs.db_path)
    _insert_costume(bs.db_path)

    conn = _open_conn(bs.db_path)
    data = aggregate_character_sheet_data(conn, Path(bs.data_root), "char-1")
    conn.close()

    pdf_path = generate_character_sheet_pdf(data, Path(bs.data_root), "char-1")
    assert pdf_path.exists()
    # PDF magic bytes
    with open(pdf_path, "rb") as f:
        header = f.read(4)
    assert header == b"%PDF"
