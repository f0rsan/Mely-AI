from __future__ import annotations

import importlib
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from app.core.settings import get_settings
from app.services.model_registry import ModelRegistryItem, load_model_registry

DNA_FIELD_ORDER = ("hairColor", "eyeColor", "skinTone", "bodyType", "style")

DNA_FIELD_OPTIONS: dict[str, dict[str, object]] = {
    "hairColor": {
        "label": "发色",
        "options": [
            {"value": "黑色", "prompt": "black hair"},
            {"value": "棕色", "prompt": "brown hair"},
            {"value": "金色", "prompt": "blonde hair"},
            {"value": "银色", "prompt": "silver hair"},
            {"value": "粉色", "prompt": "pink hair"},
            {"value": "蓝色", "prompt": "blue hair"},
            {"value": "红色", "prompt": "red hair"},
            {"value": "紫色", "prompt": "purple hair"},
            {"value": "白色", "prompt": "white hair"},
        ],
    },
    "eyeColor": {
        "label": "瞳色",
        "options": [
            {"value": "棕色", "prompt": "brown eyes"},
            {"value": "蓝色", "prompt": "blue eyes"},
            {"value": "绿色", "prompt": "green eyes"},
            {"value": "红色", "prompt": "red eyes"},
            {"value": "紫色", "prompt": "violet eyes"},
            {"value": "金色", "prompt": "golden eyes"},
            {"value": "灰色", "prompt": "gray eyes"},
        ],
    },
    "skinTone": {
        "label": "肤色",
        "options": [
            {"value": "白皙", "prompt": "fair skin"},
            {"value": "自然", "prompt": "natural skin tone"},
            {"value": "小麦色", "prompt": "tan skin"},
            {"value": "深色", "prompt": "dark skin"},
        ],
    },
    "bodyType": {
        "label": "体型",
        "options": [
            {"value": "纤细", "prompt": "slim body"},
            {"value": "匀称", "prompt": "proportional body"},
            {"value": "高挑", "prompt": "tall body"},
            {"value": "健美", "prompt": "athletic body"},
            {"value": "娇小", "prompt": "petite body"},
        ],
    },
    "style": {
        "label": "风格",
        "options": [
            {"value": "二次元", "prompt": "anime style"},
            {"value": "写实", "prompt": "realistic style"},
            {"value": "半写实", "prompt": "semi-realistic style"},
            {"value": "3D", "prompt": "3d render style"},
            {"value": "赛博朋克", "prompt": "cyberpunk style"},
            {"value": "国风", "prompt": "chinese ink style"},
        ],
    },
}

WD14_TAG_MAP: dict[str, dict[str, tuple[str, ...]]] = {
    "hairColor": {
        "黑色": ("black_hair",),
        "棕色": ("brown_hair",),
        "金色": ("blonde_hair",),
        "银色": ("silver_hair", "grey_hair", "gray_hair"),
        "粉色": ("pink_hair",),
        "蓝色": ("blue_hair",),
        "红色": ("red_hair",),
        "紫色": ("purple_hair",),
        "白色": ("white_hair",),
    },
    "eyeColor": {
        "棕色": ("brown_eyes",),
        "蓝色": ("blue_eyes",),
        "绿色": ("green_eyes",),
        "红色": ("red_eyes",),
        "紫色": ("purple_eyes", "violet_eyes"),
        "金色": ("golden_eyes", "yellow_eyes"),
        "灰色": ("gray_eyes", "grey_eyes"),
    },
    "skinTone": {
        "白皙": ("fair_skin", "pale_skin"),
        "自然": ("skin",),
        "小麦色": ("tan_skin",),
        "深色": ("dark_skin",),
    },
    "bodyType": {
        "纤细": ("slim", "slender"),
        "匀称": ("average_build",),
        "高挑": ("tall",),
        "健美": ("muscular", "athletic"),
        "娇小": ("petite", "short_stature"),
    },
    "style": {
        "二次元": ("anime",),
        "写实": ("realistic",),
        "半写实": ("semi_realistic",),
        "3D": ("3d", "render"),
        "赛博朋克": ("cyberpunk",),
        "国风": ("chinese_style", "ink_style"),
    },
}

SUPPORTED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


@dataclass(slots=True)
class WD14Evaluation:
    available: bool
    model_id: str | None
    reason: str | None
    tags: list[str]
    mapped_fields: dict[str, str]


def _normalize_text(value: str | None) -> str:
    return (value or "").strip()


def _resolve_prompt_token(field_key: str, selected_value: str) -> str:
    normalized_value = _normalize_text(selected_value)
    if not normalized_value:
        return ""

    options = DNA_FIELD_OPTIONS[field_key]["options"]
    for option in options:
        if option["value"] == normalized_value:
            return str(option["prompt"])
    return normalized_value


def build_auto_prompt(
    *,
    hair_color: str,
    eye_color: str,
    skin_tone: str,
    body_type: str,
    style: str,
    extra_tags: list[str] | None = None,
) -> str:
    tokens = [
        _resolve_prompt_token("hairColor", hair_color),
        _resolve_prompt_token("eyeColor", eye_color),
        _resolve_prompt_token("skinTone", skin_tone),
        _resolve_prompt_token("bodyType", body_type),
        _resolve_prompt_token("style", style),
    ]

    if extra_tags:
        tokens.extend(_normalize_text(tag) for tag in extra_tags)

    filtered = [token for token in tokens if token]
    return ", ".join(filtered)


def _load_wd14_runner() -> Callable[..., list[str]] | None:
    try:
        module = importlib.import_module("app.services.wd14_runtime")
    except ModuleNotFoundError:
        return None

    runner = getattr(module, "infer_tags", None)
    if callable(runner):
        return runner
    return None


def _find_wd14_model() -> ModelRegistryItem | None:
    registry = load_model_registry(get_settings())
    for item in registry.list_items():
        identifier = f"{item.id} {item.name}".lower()
        if "wd14" in identifier:
            return item
    return None


def _collect_training_images(data_root: Path, character_id: str) -> list[Path]:
    training_root = data_root / "characters" / character_id / "training_data"
    if not training_root.exists():
        return []

    images: list[Path] = []
    for candidate in training_root.iterdir():
        if candidate.suffix.lower() in SUPPORTED_IMAGE_EXTENSIONS and candidate.is_file():
            images.append(candidate)
    return sorted(images)


def _map_wd14_tags_to_fields(tags: list[str]) -> dict[str, str]:
    lowered = {tag.lower() for tag in tags}
    mapped: dict[str, str] = {}

    for field_key in DNA_FIELD_ORDER:
        tag_map = WD14_TAG_MAP[field_key]
        for value, aliases in tag_map.items():
            if any(alias in lowered for alias in aliases):
                mapped[field_key] = value
                break

    return mapped


def evaluate_wd14(
    *,
    data_root: Path,
    character_id: str,
) -> WD14Evaluation:
    model = _find_wd14_model()
    if model is None:
        return WD14Evaluation(
            available=False,
            model_id=None,
            reason="WD14 模型条目未配置，已使用手动建议值。",
            tags=[],
            mapped_fields={},
        )

    model_path = data_root / "models" / model.relative_path
    if not model_path.exists():
        return WD14Evaluation(
            available=False,
            model_id=model.id,
            reason="WD14 模型尚未下载完成，已使用手动建议值。",
            tags=[],
            mapped_fields={},
        )

    image_paths = _collect_training_images(data_root, character_id)
    if not image_paths:
        return WD14Evaluation(
            available=False,
            model_id=model.id,
            reason="未检测到可打标的训练图片，已使用手动建议值。",
            tags=[],
            mapped_fields={},
        )

    runner = _load_wd14_runner()
    if runner is None:
        return WD14Evaluation(
            available=False,
            model_id=model.id,
            reason="WD14 推理器尚未接入，已使用手动建议值。",
            tags=[],
            mapped_fields={},
        )

    try:
        tags = runner(model_path=model_path, image_paths=image_paths)
    except Exception:
        return WD14Evaluation(
            available=False,
            model_id=model.id,
            reason="WD14 自动打标执行失败，已使用手动建议值。",
            tags=[],
            mapped_fields={},
        )

    if not isinstance(tags, list):
        return WD14Evaluation(
            available=False,
            model_id=model.id,
            reason="WD14 自动打标返回格式无效，已使用手动建议值。",
            tags=[],
            mapped_fields={},
        )

    normalized_tags = [tag.strip() for tag in tags if isinstance(tag, str) and tag.strip()]
    mapped_fields = _map_wd14_tags_to_fields(normalized_tags)
    if not mapped_fields:
        return WD14Evaluation(
            available=True,
            model_id=model.id,
            reason="WD14 已执行，但未命中可映射字段，已保留手动建议值。",
            tags=normalized_tags,
            mapped_fields={},
        )

    return WD14Evaluation(
        available=True,
        model_id=model.id,
        reason=None,
        tags=normalized_tags,
        mapped_fields=mapped_fields,
    )


def _fetch_existing_dna(connection: sqlite3.Connection, character_id: str) -> dict[str, object]:
    row = connection.execute(
        """
        SELECT hair_color, eye_color, skin_tone, body_type, style, extra_tags
        FROM character_dna
        WHERE character_id = ?
        """,
        (character_id,),
    ).fetchone()
    if row is None:
        return {}

    extra_tags_raw = row["extra_tags"]
    extra_tags: list[str] | None = None
    if isinstance(extra_tags_raw, str):
        try:
            import json

            parsed = json.loads(extra_tags_raw)
            if isinstance(parsed, list):
                extra_tags = [tag for tag in parsed if isinstance(tag, str) and tag.strip()]
        except Exception:
            extra_tags = None

    return {
        "hairColor": row["hair_color"],
        "eyeColor": row["eye_color"],
        "skinTone": row["skin_tone"],
        "bodyType": row["body_type"],
        "style": row["style"],
        "extraTags": extra_tags,
    }


def build_dna_suggestions(
    connection: sqlite3.Connection,
    *,
    data_root: Path,
    character_id: str,
) -> dict[str, object]:
    existing = _fetch_existing_dna(connection, character_id)
    wd14 = evaluate_wd14(data_root=data_root, character_id=character_id)

    recommended_values: dict[str, str] = {}
    wd14_hits = 0

    for field_key in DNA_FIELD_ORDER:
        default_value = str(DNA_FIELD_OPTIONS[field_key]["options"][0]["value"])
        existing_value = _normalize_text(str(existing.get(field_key, "") or ""))
        wd14_value = _normalize_text(wd14.mapped_fields.get(field_key))

        if existing_value:
            recommended = existing_value
        elif wd14_value:
            recommended = wd14_value
            wd14_hits += 1
        else:
            recommended = default_value

        recommended_values[field_key] = recommended

    source = "manual_default"
    if wd14_hits == len(DNA_FIELD_ORDER):
        source = "wd14"
    elif wd14_hits > 0:
        source = "mixed"

    fields: dict[str, dict[str, object]] = {}
    for field_key in DNA_FIELD_ORDER:
        options = DNA_FIELD_OPTIONS[field_key]["options"]
        recommended = recommended_values[field_key]
        fields[field_key] = {
            "label": DNA_FIELD_OPTIONS[field_key]["label"],
            "recommended": recommended,
            "recommendedPrompt": _resolve_prompt_token(field_key, recommended),
            "options": options,
        }

    auto_prompt_preview = build_auto_prompt(
        hair_color=recommended_values["hairColor"],
        eye_color=recommended_values["eyeColor"],
        skin_tone=recommended_values["skinTone"],
        body_type=recommended_values["bodyType"],
        style=recommended_values["style"],
        extra_tags=existing.get("extraTags"),
    )

    return {
        "characterId": character_id,
        "source": source,
        "fields": fields,
        "autoPromptPreview": auto_prompt_preview,
        "wd14": {
            "available": wd14.available,
            "modelId": wd14.model_id,
            "reason": wd14.reason,
            "tags": wd14.tags,
        },
    }
