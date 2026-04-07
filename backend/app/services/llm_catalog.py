from __future__ import annotations

from dataclasses import dataclass


DEFAULT_MODEL_NAME = "qwen2.5:7b-instruct-q4_K_M"
LIGHT_MODEL_NAME = "qwen2.5:3b"
VISION_MODEL_NAME = "minicpm-v:8b"
MIN_OLLAMA_VERSION = "0.3.10"


@dataclass(frozen=True, slots=True)
class LLMCatalogItem:
    id: str
    model_name: str
    display_name: str
    kind: str
    tier: str
    size_label: str
    recommended: bool
    vision_capable: bool
    min_ollama_version: str | None
    memory_hint: str

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "modelName": self.model_name,
            "displayName": self.display_name,
            "kind": self.kind,
            "tier": self.tier,
            "sizeLabel": self.size_label,
            "recommended": self.recommended,
            "visionCapable": self.vision_capable,
            "minOllamaVersion": self.min_ollama_version,
            "memoryHint": self.memory_hint,
        }


def get_llm_catalog() -> list[LLMCatalogItem]:
    return [
        LLMCatalogItem(
            id="default-chat",
            model_name=DEFAULT_MODEL_NAME,
            display_name="默认对话",
            kind="text",
            tier="default",
            size_label="约 4.5 GB",
            recommended=True,
            vision_capable=False,
            min_ollama_version=None,
            memory_hint="M1 16GB / RTX 3070 8GB 可用",
        ),
        LLMCatalogItem(
            id="light-chat",
            model_name=LIGHT_MODEL_NAME,
            display_name="轻量对话",
            kind="text",
            tier="light",
            size_label="约 2 GB",
            recommended=False,
            vision_capable=False,
            min_ollama_version=None,
            memory_hint="更快，质量较弱",
        ),
        LLMCatalogItem(
            id="vision-chat",
            model_name=VISION_MODEL_NAME,
            display_name="多模态",
            kind="vision",
            tier="vision",
            size_label="约 5 GB",
            recommended=False,
            vision_capable=True,
            min_ollama_version=MIN_OLLAMA_VERSION,
            memory_hint="按需下载",
        ),
    ]


def get_catalog_item(model_name: str) -> LLMCatalogItem | None:
    for item in get_llm_catalog():
        if item.model_name == model_name:
            return item
    return None


def is_catalog_model(model_name: str) -> bool:
    return get_catalog_item(model_name) is not None


def is_catalog_text_model(model_name: str) -> bool:
    item = get_catalog_item(model_name)
    return item is not None and item.kind == "text"


def is_catalog_vision_model(model_name: str) -> bool:
    item = get_catalog_item(model_name)
    return item is not None and bool(item.vision_capable)
