from dataclasses import dataclass, field
from pathlib import Path

from app.core.paths import ensure_data_directories, resolve_data_root
from app.core.settings import Settings, get_settings
from app.db.connection import connect_database
from app.db.migrations import apply_migrations


@dataclass(slots=True)
class BootstrapState:
    status: str
    data_root: Path
    db_path: Path
    initialized: bool
    applied_migrations: list[str] = field(default_factory=list)
    error: str | None = None


def bootstrap_application(settings: Settings | None = None) -> BootstrapState:
    resolved_settings = settings or get_settings()
    data_root = resolve_data_root(resolved_settings.data_dir)
    db_path = data_root / "db" / "mely.db"

    try:
        directories = ensure_data_directories(data_root)
        db_path = directories["db"] / "mely.db"
        migration_dir = Path(__file__).resolve().parents[2] / "migrations"

        with connect_database(db_path) as connection:
            applied_migrations = apply_migrations(connection, migration_dir)

        return BootstrapState(
            status="ok",
            data_root=data_root,
            db_path=db_path,
            initialized=True,
            applied_migrations=applied_migrations,
        )
    except Exception as exc:  # pragma: no cover - surfaced through health contract
        return BootstrapState(
            status="error",
            data_root=data_root,
            db_path=db_path,
            initialized=False,
            error=str(exc),
        )
