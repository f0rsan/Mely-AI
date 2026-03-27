from pathlib import Path


def resolve_data_root(data_dir: Path | None) -> Path:
    if data_dir is not None:
        return data_dir.expanduser().resolve()

    return (Path.home() / ".mely").resolve()


def ensure_data_directories(data_root: Path) -> dict[str, Path]:
    directories = {
        "root": data_root,
        "db": data_root / "db",
        "characters": data_root / "characters",
        "models": data_root / "models",
        "temp": data_root / "temp",
    }

    for path in directories.values():
        path.mkdir(parents=True, exist_ok=True)

    return directories
