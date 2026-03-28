from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.core.paths import ensure_character_directories

SUPPORTED_IMAGE_FORMATS = {"png", "jpeg", "webp"}
ANGLE_BUCKETS = (
    "front",
    "threeQuarter",
    "side",
    "back",
    "closeup",
    "fullBody",
    "unknown",
)

MODE_PRESETS: dict[str, dict[str, int]] = {
    "light": {"steps": 900, "rank": 8},
    "standard": {"steps": 1800, "rank": 16},
    "fine": {"steps": 2800, "rank": 32},
}


class DatasetServiceError(Exception):
    """Base dataset service error."""


class DatasetCharacterNotFoundError(DatasetServiceError):
    """Raised when character id does not exist."""


class DatasetValidationError(DatasetServiceError):
    """Raised when payload contains invalid image input."""


class DatasetReportNotFoundError(DatasetServiceError):
    """Raised when report does not exist yet."""


@dataclass(slots=True)
class DatasetImportImageInput:
    name: str
    content_base64: str


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _loads_json(value: str | None) -> object | None:
    if value is None:
        return None
    return json.loads(value)


def _sanitize_file_stem(value: str) -> str:
    stem = Path(value).stem
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", stem).strip("-").lower()
    if not cleaned:
        return "dataset-image"
    return cleaned[:42]


def _decode_base64_image(content_base64: str) -> bytes:
    try:
        decoded = base64.b64decode(content_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise DatasetValidationError("图片导入失败，请检查图片格式后重试") from exc

    if not decoded:
        raise DatasetValidationError("图片导入失败，请检查图片格式后重试")

    return decoded


def _parse_png_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        raise DatasetValidationError("图片导入失败，请检查图片格式后重试")
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def _parse_jpeg_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        raise DatasetValidationError("图片导入失败，请检查图片格式后重试")

    index = 2
    sof_markers = {
        0xC0,
        0xC1,
        0xC2,
        0xC3,
        0xC5,
        0xC6,
        0xC7,
        0xC9,
        0xCA,
        0xCB,
        0xCD,
        0xCE,
        0xCF,
    }
    while index + 9 < len(data):
        if data[index] != 0xFF:
            index += 1
            continue

        marker = data[index + 1]
        index += 2

        if marker in {0xD8, 0xD9, 0x01}:
            continue

        if index + 2 > len(data):
            break

        segment_length = int.from_bytes(data[index : index + 2], "big")
        if segment_length < 2:
            break

        segment_end = index + segment_length
        if segment_end > len(data):
            break

        if marker in sof_markers:
            if index + 7 > len(data):
                break
            height = int.from_bytes(data[index + 3 : index + 5], "big")
            width = int.from_bytes(data[index + 5 : index + 7], "big")
            return width, height

        index = segment_end

    raise DatasetValidationError("图片导入失败，请检查图片格式后重试")


def _parse_webp_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 30 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise DatasetValidationError("图片导入失败，请检查图片格式后重试")

    chunk_header = data[12:16]
    if chunk_header == b"VP8X":
        width = 1 + int.from_bytes(data[24:27], "little")
        height = 1 + int.from_bytes(data[27:30], "little")
        return width, height

    if chunk_header == b"VP8 ":
        width_raw = int.from_bytes(data[26:28], "little")
        height_raw = int.from_bytes(data[28:30], "little")
        return width_raw & 0x3FFF, height_raw & 0x3FFF

    if chunk_header == b"VP8L":
        bits = int.from_bytes(data[21:25], "little")
        width = (bits & 0x3FFF) + 1
        height = ((bits >> 14) & 0x3FFF) + 1
        return width, height

    raise DatasetValidationError("图片导入失败，请检查图片格式后重试")


def detect_image_dimensions(data: bytes) -> tuple[int, int, str]:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        width, height = _parse_png_dimensions(data)
        return width, height, "png"

    if data.startswith(b"\xff\xd8"):
        width, height = _parse_jpeg_dimensions(data)
        return width, height, "jpeg"

    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        width, height = _parse_webp_dimensions(data)
        return width, height, "webp"

    raise DatasetValidationError("图片导入失败，请检查图片格式后重试")


def _infer_angle_bucket(name: str) -> str:
    lower_name = name.lower()

    if any(token in lower_name for token in ("back", "rear", "背面", "背", "后侧", "后面")):
        return "back"
    if any(
        token in lower_name
        for token in ("3/4", "3-4", "3_4", "34side", "34-", "34_", "threequarter", "three-quarter")
    ):
        return "threeQuarter"
    if any(token in lower_name for token in ("side", "profile", "侧面", "侧脸")):
        return "side"
    if any(token in lower_name for token in ("closeup", "close-up", "portrait", "head", "特写", "脸部")):
        return "closeup"
    if any(token in lower_name for token in ("fullbody", "full-body", "full_body", "全身", "body")):
        return "fullBody"
    if any(token in lower_name for token in ("front", "正面", "正脸")):
        return "front"
    return "unknown"


def _collect_issues(
    *,
    width: int,
    height: int,
    duplicate_hash: bool,
    angle_bucket: str,
) -> list[str]:
    issues: list[str] = []

    short_edge = min(width, height)
    aspect_ratio = width / height if height else 0
    if short_edge < 768:
        issues.append("分辨率偏低（短边低于 768）")

    if aspect_ratio > 1.8 or aspect_ratio < 0.56:
        issues.append("画面比例差异较大")

    if duplicate_hash:
        issues.append("疑似重复图片")

    if angle_bucket == "unknown":
        issues.append("角度未识别，建议重命名文件标注角度")

    return issues


def _calculate_quality_score(
    *,
    total_images: int,
    qualified_images: int,
    angle_distribution: dict[str, int],
    problem_items: list[dict[str, object]],
) -> int:
    if total_images == 0:
        return 0

    coverage_count = sum(1 for value in angle_distribution.values() if value > 0)
    score = 0.0
    score += min(35.0, total_images * 2.5)
    score += (qualified_images / total_images) * 35.0
    score += min(20.0, coverage_count * 4.0)
    score -= min(15.0, len(problem_items) * 2.0)
    return int(max(0.0, min(100.0, round(score))))


def _resolve_recommended_mode(
    *,
    quality_score: int,
    qualified_images: int,
    angle_distribution: dict[str, int],
) -> dict[str, object]:
    core_coverage = sum(
        1
        for key in ("front", "side", "back", "closeup")
        if angle_distribution.get(key, 0) > 0
    )

    if qualified_images >= 24 and quality_score >= 82 and core_coverage >= 4:
        mode = "fine"
        reason = "数据量和角度覆盖较完整，可使用精细模式追求更高一致性。"
    elif qualified_images >= 12 and quality_score >= 60:
        mode = "standard"
        reason = "当前数据质量可进入标准模式，训练稳定性和效果较均衡。"
    else:
        mode = "light"
        reason = "当前数据量或覆盖度偏保守，建议先用轻量模式验证方向。"

    preset = MODE_PRESETS[mode]
    return {
        "mode": mode,
        "reason": reason,
        "suggestedSteps": preset["steps"],
        "suggestedRank": preset["rank"],
        "minRecommendedImages": 10 if mode == "light" else 15 if mode == "standard" else 25,
        "strategyDefaultModel": "flux-schnell",
        "runtimeModelHintOn8GB": "sdxl",
    }


def _build_recommendations(
    *,
    total_images: int,
    qualified_images: int,
    angle_distribution: dict[str, int],
    problem_items: list[dict[str, object]],
) -> list[str]:
    tips: list[str] = []

    if total_images < 10:
        tips.append("当前图片数量偏少，建议补充到 10 张以上再训练。")

    if qualified_images < 8:
        tips.append("可用图片较少，建议先清理问题图并补充清晰样本。")

    missing_angles: list[str] = []
    if angle_distribution.get("front", 0) == 0:
        missing_angles.append("正面")
    if angle_distribution.get("side", 0) == 0:
        missing_angles.append("侧面")
    if angle_distribution.get("back", 0) == 0:
        missing_angles.append("背面")
    if angle_distribution.get("closeup", 0) == 0:
        missing_angles.append("特写")
    if missing_angles:
        tips.append(f"角度覆盖不完整，建议补充：{'、'.join(missing_angles)}。")

    low_resolution_count = sum(
        1
        for item in problem_items
        if any("分辨率偏低" in issue for issue in item.get("issues", []))
    )
    if low_resolution_count > 0:
        tips.append("检测到低分辨率图片，建议替换为短边不低于 768 的素材。")

    duplicate_count = sum(
        1 for item in problem_items if any("疑似重复图片" in issue for issue in item.get("issues", []))
    )
    if duplicate_count > 0:
        tips.append("检测到重复图片，建议保留差异更明显的样本。")

    if not tips:
        tips.append("数据集质量良好，可直接进入训练。")

    return tips


def _ensure_character_exists(connection: sqlite3.Connection, character_id: str) -> None:
    exists = connection.execute(
        "SELECT id FROM characters WHERE id = ?",
        (character_id,),
    ).fetchone()
    if exists is None:
        raise DatasetCharacterNotFoundError("角色不存在")


def import_dataset(
    connection: sqlite3.Connection,
    data_root: Path,
    character_id: str,
    images: list[DatasetImportImageInput],
) -> dict[str, object]:
    if not images:
        raise DatasetValidationError("请至少上传一张图片后再继续。")

    _ensure_character_exists(connection, character_id)
    now = _utc_now_iso()
    directories = ensure_character_directories(data_root, character_id)
    training_data_dir = directories["training_data"]
    for path in training_data_dir.iterdir():
        if path.is_file():
            path.unlink()

    hash_seen: set[str] = set()
    image_rows: list[dict[str, object]] = []
    angle_distribution = {bucket: 0 for bucket in ANGLE_BUCKETS}

    for index, image in enumerate(images, start=1):
        raw_bytes = _decode_base64_image(image.content_base64)
        width, height, image_format = detect_image_dimensions(raw_bytes)
        if image_format not in SUPPORTED_IMAGE_FORMATS:
            raise DatasetValidationError("图片导入失败，请检查图片格式后重试")

        sha256 = hashlib.sha256(raw_bytes).hexdigest()
        duplicate_hash = sha256 in hash_seen
        hash_seen.add(sha256)

        angle_bucket = _infer_angle_bucket(image.name)
        issues = _collect_issues(
            width=width,
            height=height,
            duplicate_hash=duplicate_hash,
            angle_bucket=angle_bucket,
        )
        quality_status = "qualified" if not issues else "problem"
        angle_distribution[angle_bucket] += 1

        extension = ".jpg" if image_format == "jpeg" else f".{image_format}"
        safe_stem = _sanitize_file_stem(image.name)
        stored_name = f"{index:03d}-{safe_stem}{extension}"
        target_path = training_data_dir / stored_name
        target_path.write_bytes(raw_bytes)
        relative_path = f"characters/{character_id}/training_data/{stored_name}"

        image_rows.append(
            {
                "id": str(uuid4()),
                "originalName": image.name,
                "storedName": stored_name,
                "relativePath": relative_path,
                "imageFormat": image_format,
                "width": width,
                "height": height,
                "fileSize": len(raw_bytes),
                "sha256": sha256,
                "angleBucket": angle_bucket,
                "qualityStatus": quality_status,
                "issues": issues,
            }
        )

    total_images = len(image_rows)
    qualified_images = sum(1 for row in image_rows if row["qualityStatus"] == "qualified")
    problem_images = total_images - qualified_images
    problem_items = [
        {
            "imageId": row["id"],
            "name": row["originalName"],
            "angleBucket": row["angleBucket"],
            "issues": row["issues"],
        }
        for row in image_rows
        if row["qualityStatus"] == "problem"
    ]
    quality_score = _calculate_quality_score(
        total_images=total_images,
        qualified_images=qualified_images,
        angle_distribution=angle_distribution,
        problem_items=problem_items,
    )
    recommended_mode = _resolve_recommended_mode(
        quality_score=quality_score,
        qualified_images=qualified_images,
        angle_distribution=angle_distribution,
    )
    recommendations = _build_recommendations(
        total_images=total_images,
        qualified_images=qualified_images,
        angle_distribution=angle_distribution,
        problem_items=problem_items,
    )

    report = {
        "characterId": character_id,
        "totalImages": total_images,
        "qualifiedImages": qualified_images,
        "problemImages": problem_images,
        "qualityScore": quality_score,
        "angleDistribution": angle_distribution,
        "problemItems": problem_items,
        "recommendedTrainingMode": recommended_mode,
        "recommendations": recommendations,
        "images": [
            {
                "imageId": row["id"],
                "name": row["originalName"],
                "relativePath": row["relativePath"],
                "imageFormat": row["imageFormat"],
                "width": row["width"],
                "height": row["height"],
                "fileSize": row["fileSize"],
                "angleBucket": row["angleBucket"],
                "qualityStatus": row["qualityStatus"],
                "issues": row["issues"],
            }
            for row in image_rows
        ],
        "updatedAt": now,
    }

    try:
        connection.execute("DELETE FROM dataset_images WHERE character_id = ?", (character_id,))
        for row in image_rows:
            connection.execute(
                """
                INSERT INTO dataset_images (
                    id,
                    character_id,
                    original_name,
                    stored_name,
                    relative_path,
                    image_format,
                    width,
                    height,
                    file_size,
                    sha256,
                    angle_bucket,
                    quality_status,
                    issues_json,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["id"],
                    character_id,
                    row["originalName"],
                    row["storedName"],
                    row["relativePath"],
                    row["imageFormat"],
                    row["width"],
                    row["height"],
                    row["fileSize"],
                    row["sha256"],
                    row["angleBucket"],
                    row["qualityStatus"],
                    json.dumps(row["issues"], ensure_ascii=False),
                    now,
                ),
            )

        existing = connection.execute(
            "SELECT character_id FROM dataset_reports WHERE character_id = ?",
            (character_id,),
        ).fetchone()
        if existing is None:
            connection.execute(
                """
                INSERT INTO dataset_reports (character_id, report_json, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (character_id, json.dumps(report, ensure_ascii=False), now, now),
            )
        else:
            connection.execute(
                """
                UPDATE dataset_reports
                SET report_json = ?, updated_at = ?
                WHERE character_id = ?
                """,
                (json.dumps(report, ensure_ascii=False), now, character_id),
            )

        connection.commit()
    except sqlite3.DatabaseError as exc:
        connection.rollback()
        raise DatasetServiceError("训练数据集保存失败，请稍后重试。") from exc

    return report


def get_dataset_report(connection: sqlite3.Connection, character_id: str) -> dict[str, object]:
    _ensure_character_exists(connection, character_id)
    row = connection.execute(
        "SELECT report_json FROM dataset_reports WHERE character_id = ?",
        (character_id,),
    ).fetchone()
    if row is None:
        raise DatasetReportNotFoundError("训练数据集尚未导入，请先上传图片。")

    report = _loads_json(row["report_json"])
    if not isinstance(report, dict):
        raise DatasetServiceError("训练数据集读取失败，请重新导入后重试。")
    return report
