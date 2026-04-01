import sqlite3
from pathlib import Path

import pytest

from app.db.migrations import apply_migrations


MIGRATION_DIR = Path(__file__).resolve().parents[1] / "migrations"


def _apply_all_migrations(db_path: Path) -> None:
    with sqlite3.connect(db_path) as conn:
        apply_migrations(conn, MIGRATION_DIR)


def test_migration_0005_adds_new_columns(tmp_path: Path) -> None:
    db_path = tmp_path / "test.db"
    _apply_all_migrations(db_path)

    with sqlite3.connect(db_path) as conn:
        cols = {
            row[1]
            for row in conn.execute("PRAGMA table_info(voice_assets)").fetchall()
        }

    assert "reference_audio_duration" in cols
    assert "reference_audio_format" in cols
    assert "bound_at" in cols
    assert "status" in cols


def test_migration_0005_status_defaults_to_unbound(tmp_path: Path) -> None:
    db_path = tmp_path / "test.db"
    _apply_all_migrations(db_path)

    with sqlite3.connect(db_path) as conn:
        # Insert a character first (foreign key dependency).
        conn.execute(
            "INSERT INTO characters(id, name, created_at) VALUES (?, ?, ?)",
            ("char-1", "Test", "2026-01-01T00:00:00Z"),
        )
        conn.execute(
            "INSERT INTO voice_assets(character_id) VALUES (?)",
            ("char-1",),
        )
        conn.commit()

        row = conn.execute(
            "SELECT status FROM voice_assets WHERE character_id = ?", ("char-1",)
        ).fetchone()

    assert row is not None
    assert row[0] == "unbound"


def test_migration_0005_index_exists(tmp_path: Path) -> None:
    db_path = tmp_path / "test.db"
    _apply_all_migrations(db_path)

    with sqlite3.connect(db_path) as conn:
        indexes = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index'"
            ).fetchall()
        }

    assert "idx_voice_assets_status" in indexes
