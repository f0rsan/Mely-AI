from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from app.core.settings import Settings


@dataclass(frozen=True, slots=True)
class ModelRegistryItem:
    id: str
    name: str
    url: str
    size: int | None
    sha256: str | None
    relative_path: str

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "name": self.name,
            "url": self.url,
            "size": self.size,
            "sha256": self.sha256,
            "relativePath": self.relative_path,
        }


class ModelRegistry:
    def __init__(self, items: list[ModelRegistryItem]) -> None:
        self._items = items
        self._indexed = {item.id: item for item in items}

    def list_items(self) -> list[ModelRegistryItem]:
        return list(self._items)

    def get_item(self, model_id: str) -> ModelRegistryItem | None:
        return self._indexed.get(model_id)


def resolve_model_registry_path(settings: Settings) -> Path:
    if settings.model_registry_path is not None:
        return settings.model_registry_path.expanduser().resolve()

    return (Path(__file__).resolve().parents[1] / "config" / "model_registry.json").resolve()


def is_f5tts_model_available(data_root: Path) -> bool:
    """Return True if the F5-TTS base model file is present on disk."""
    model_path = data_root / "models" / "tts" / "f5-tts-base" / "model_1200000.safetensors"
    return model_path.exists()


def load_model_registry(settings: Settings) -> ModelRegistry:
    path = resolve_model_registry_path(settings)
    if not path.exists():
        return ModelRegistry(items=[])

    raw = json.loads(path.read_text(encoding="utf-8"))
    candidates = raw.get("models", []) if isinstance(raw, dict) else []

    items: list[ModelRegistryItem] = []
    seen_ids: set[str] = set()
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue

        model_id = str(candidate.get("id", "")).strip()
        if not model_id or model_id in seen_ids:
            continue

        name = str(candidate.get("name", "")).strip() or model_id
        url = str(candidate.get("url", "")).strip()
        relative_path = str(candidate.get("relativePath", "")).strip()
        if not url or not relative_path:
            continue

        size_raw = candidate.get("size")
        size = int(size_raw) if isinstance(size_raw, int) and size_raw > 0 else None

        sha256_raw = str(candidate.get("sha256", "")).strip().lower()
        sha256_value = sha256_raw if len(sha256_raw) == 64 else None

        items.append(
            ModelRegistryItem(
                id=model_id,
                name=name,
                url=url,
                size=size,
                sha256=sha256_value,
                relative_path=relative_path,
            )
        )
        seen_ids.add(model_id)

    return ModelRegistry(items=items)
