import sqlite3
from pathlib import Path


def ensure_schema_migrations_table(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    connection.commit()


def apply_migrations(connection: sqlite3.Connection, migration_dir: Path) -> list[str]:
    ensure_schema_migrations_table(connection)

    applied = {
        row[0]
        for row in connection.execute("SELECT version FROM schema_migrations").fetchall()
    }

    applied_now: list[str] = []
    for migration_path in sorted(migration_dir.glob("*.sql")):
        version = migration_path.stem.split("_", maxsplit=1)[0]
        if version in applied:
            continue

        sql = migration_path.read_text(encoding="utf-8")
        connection.executescript(sql)
        connection.execute(
            "INSERT INTO schema_migrations(version, name) VALUES (?, ?)",
            (version, migration_path.name),
        )
        connection.commit()
        applied_now.append(migration_path.name)

    return applied_now
