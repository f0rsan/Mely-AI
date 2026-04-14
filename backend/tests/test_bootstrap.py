import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


EXPECTED_TABLES = {
    "schema_migrations",
    "characters",
    "character_dna",
    "visual_assets",
    "voice_assets",
    "costumes",
    "costume_previews",
    "generations",
    "generation_tags",
    "download_tasks",
}


def test_bootstrap_creates_data_root_and_schema(temp_data_root: Path) -> None:
    app = create_app()

    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200

    body = response.json()
    assert body["database"]["initialized"] is True

    db_path = temp_data_root / "db" / "mely.db"
    assert db_path.exists()
    assert (temp_data_root / "characters").exists()
    assert (temp_data_root / "models").exists()
    assert (temp_data_root / "temp").exists()

    with sqlite3.connect(db_path) as connection:
        table_rows = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
        llm_training_columns = {
            row[1]
            for row in connection.execute("PRAGMA table_info(llm_training_jobs)").fetchall()
        }

    tables = {row[0] for row in table_rows}
    assert EXPECTED_TABLES.issubset(tables)
    assert {"stage_name", "checkpoint_path"}.issubset(llm_training_columns)


def test_bootstrap_is_idempotent(temp_data_root: Path) -> None:
    first_app = create_app()
    second_app = create_app()

    with TestClient(first_app) as first_client:
        first_response = first_client.get("/api/health")

    with TestClient(second_app) as second_client:
        second_response = second_client.get("/api/health")

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert second_response.json()["database"]["initialized"] is True
