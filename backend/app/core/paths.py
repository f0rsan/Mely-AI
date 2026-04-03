import shutil
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


def ensure_llm_directories(data_root: Path, character_id: str) -> dict[str, Path]:
    """Ensure LLM-related directories exist for a character."""
    character_root = data_root / "characters" / character_id
    directories = {
        "llm_datasets": character_root / "llm_datasets",
        "llm_adapters": character_root / "llm_adapters",
        "llm_models": character_root / "llm_models",
    }
    for path in directories.values():
        path.mkdir(parents=True, exist_ok=True)
    return directories


def ensure_character_directories(data_root: Path, character_id: str) -> dict[str, Path]:
    character_root = data_root / "characters" / character_id
    directories = {
        "root": character_root,
        "lora": character_root / "lora",
        "training_data": character_root / "training_data",
        "voice": character_root / "voice",
        "costumes": character_root / "costumes",
        "generations": character_root / "generations",
    }

    for path in directories.values():
        path.mkdir(parents=True, exist_ok=True)

    return directories


def remove_character_directory(data_root: Path, character_id: str) -> None:
    character_root = data_root / "characters" / character_id
    if character_root.exists():
        shutil.rmtree(character_root)
