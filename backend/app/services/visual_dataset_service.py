"""Visual dataset service — image import, quality scoring, WD14 tagging placeholder."""
from __future__ import annotations

import json
import shutil
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4


# ── Errors ─────────────────────────────────────────────────────────────────────

class VisualDatasetError(Exception):
    """Base visual dataset error."""


class VisualDatasetNotFoundError(VisualDatasetError):
    """Dataset or image not found."""


class VisualDatasetImageNotFoundError(VisualDatasetError):
    """Image record not found."""


# ── Domain records ─────────────────────────────────────────────────────────────

@dataclass(slots=True)
class VisualDatasetRecord:
    id: str
    character_id: str
    name: str
    image_count: int
    quality_score: float | None
    quality_issues: list[str]
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "characterId": self.character_id,
            "name": self.name,
            "imageCount": self.image_count,
            "qualityScore": self.quality_score,
            "qualityIssues": self.quality_issues,
            "createdAt": self.created_at,
        }


@dataclass(slots=True)
class VisualImageRecord:
    id: str
    dataset_id: str
    filename: str
    stored_path: str
    width: int | None
    height: int | None
    tags: list[str]
    source: str
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "datasetId": self.dataset_id,
            "filename": self.filename,
            "storedPath": self.stored_path,
            "width": self.width,
            "height": self.height,
            "tags": self.tags,
            "source": self.source,
            "createdAt": self.created_at,
        }


# ── Helpers ────────────────────────────────────────────────────────────────────

def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _row_to_dataset(row: sqlite3.Row) -> VisualDatasetRecord:
    issues = json.loads(row["quality_issues_json"]) if row["quality_issues_json"] else []
    return VisualDatasetRecord(
        id=row["id"],
        character_id=row["character_id"],
        name=row["name"],
        image_count=int(row["image_count"]),
        quality_score=row["quality_score"],
        quality_issues=issues,
        created_at=row["created_at"],
    )


def _row_to_image(row: sqlite3.Row) -> VisualImageRecord:
    tags = json.loads(row["tags_json"]) if row["tags_json"] else []
    return VisualImageRecord(
        id=row["id"],
        dataset_id=row["dataset_id"],
        filename=row["filename"],
        stored_path=row["stored_path"],
        width=row["width"],
        height=row["height"],
        tags=tags,
        source=row["source"],
        created_at=row["created_at"],
    )


def _get_image_dimensions(path: Path) -> tuple[int | None, int | None]:
    """Return (width, height) using Pillow if available, else None."""
    try:
        from PIL import Image  # type: ignore[import]
        with Image.open(path) as img:
            return img.width, img.height
    except Exception:
        return None, None


def _score_dataset(images: list[VisualImageRecord]) -> tuple[float, list[str]]:
    """Compute a 0–1 quality score and list issues for a set of images."""
    issues: list[str] = []

    count = len(images)
    if count == 0:
        return 0.0, ["没有图片，请上传参考图"]

    # Count score: 15 images is "good", 8 is minimum
    if count < 8:
        issues.append(f"图片数量偏少（{count} 张），建议至少 15 张")
    count_score = min(1.0, count / 15)

    # Resolution score: average across images with known dimensions
    resolutions = [(img.width or 0) * (img.height or 0) for img in images if img.width]
    if resolutions:
        avg_px = sum(resolutions) / len(resolutions)
        # 512×512 = 262144 as baseline; 1024×1024 = full score
        res_score = min(1.0, avg_px / (1024 * 1024))
        low_res = [img for img in images if img.width and (img.width * (img.height or 0)) < 262144]
        if low_res:
            issues.append(f"{len(low_res)} 张图片分辨率低于 512×512，建议替换为更高清的图片")
    else:
        res_score = 0.5  # unknown, neutral

    # Angle variety hint (heuristic: count ≥ 10 assumed varied)
    if count < 10:
        issues.append("建议补充不同角度的参考图（正脸、侧脸、半身、全身）")

    overall = (count_score * 0.5 + res_score * 0.5)
    return round(overall, 3), issues


# ── Service ────────────────────────────────────────────────────────────────────

class VisualDatasetService:
    def __init__(self, db_path: Path, data_root: Path) -> None:
        self._db_path = db_path
        self._data_root = data_root

    def _conn(self) -> sqlite3.Connection:
        from app.db.connection import connect_database
        conn = connect_database(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _image_dir(self, character_id: str, dataset_id: str) -> Path:
        d = self._data_root / "characters" / character_id / "training_data" / "visual" / dataset_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    # ── Dataset CRUD ────────────────────────────────────────────────────────────

    def create_dataset(self, character_id: str, name: str) -> dict:
        with self._conn() as conn:
            # Verify character exists
            row = conn.execute("SELECT id FROM characters WHERE id = ?", (character_id,)).fetchone()
            if not row:
                raise VisualDatasetNotFoundError(f"角色 {character_id} 不存在")
            dataset_id = str(uuid4())
            now = _utc_now()
            conn.execute(
                """INSERT INTO visual_datasets(id, character_id, name, image_count, created_at)
                   VALUES (?, ?, ?, 0, ?)""",
                (dataset_id, character_id, name, now),
            )
            conn.commit()
            row2 = conn.execute("SELECT * FROM visual_datasets WHERE id = ?", (dataset_id,)).fetchone()
            return _row_to_dataset(row2).to_dict()

    def list_datasets(self, character_id: str) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM visual_datasets WHERE character_id = ? ORDER BY created_at DESC",
                (character_id,),
            ).fetchall()
            return [_row_to_dataset(r).to_dict() for r in rows]

    def delete_dataset(self, dataset_id: str) -> None:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM visual_datasets WHERE id = ?", (dataset_id,)).fetchone()
            if not row:
                raise VisualDatasetNotFoundError(f"数据集 {dataset_id} 不存在")
            ds = _row_to_dataset(row)
            # Delete stored image files
            image_dir = self._data_root / "characters" / ds.character_id / "training_data" / "visual" / dataset_id
            if image_dir.exists():
                shutil.rmtree(image_dir, ignore_errors=True)
            conn.execute("DELETE FROM visual_datasets WHERE id = ?", (dataset_id,))
            conn.commit()

    # ── Image import ────────────────────────────────────────────────────────────

    def add_image(
        self,
        dataset_id: str,
        filename: str,
        data: bytes,
        source: str = "upload",
    ) -> dict:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM visual_datasets WHERE id = ?", (dataset_id,)).fetchone()
            if not row:
                raise VisualDatasetNotFoundError(f"数据集 {dataset_id} 不存在")
            ds = _row_to_dataset(row)

        # Sanitize filename
        safe_name = Path(filename).name
        image_id = str(uuid4())
        dest_dir = self._image_dir(ds.character_id, dataset_id)
        stored_path = dest_dir / f"{image_id}_{safe_name}"
        stored_path.write_bytes(data)

        width, height = _get_image_dimensions(stored_path)
        now = _utc_now()

        with self._conn() as conn:
            conn.execute(
                """INSERT INTO visual_dataset_images
                   (id, dataset_id, filename, stored_path, width, height, source, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (image_id, dataset_id, safe_name, str(stored_path), width, height, source, now),
            )
            # Update image count
            conn.execute(
                "UPDATE visual_datasets SET image_count = image_count + 1 WHERE id = ?",
                (dataset_id,),
            )
            conn.commit()
            # Recompute quality score
            self._recompute_quality(conn, dataset_id)
            conn.commit()
            img_row = conn.execute(
                "SELECT * FROM visual_dataset_images WHERE id = ?", (image_id,)
            ).fetchone()
            return _row_to_image(img_row).to_dict()

    def list_images(self, dataset_id: str) -> list[dict]:
        with self._conn() as conn:
            row = conn.execute("SELECT id FROM visual_datasets WHERE id = ?", (dataset_id,)).fetchone()
            if not row:
                raise VisualDatasetNotFoundError(f"数据集 {dataset_id} 不存在")
            rows = conn.execute(
                "SELECT * FROM visual_dataset_images WHERE dataset_id = ? ORDER BY created_at ASC",
                (dataset_id,),
            ).fetchall()
            return [_row_to_image(r).to_dict() for r in rows]

    def delete_image(self, image_id: str) -> None:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM visual_dataset_images WHERE id = ?", (image_id,)).fetchone()
            if not row:
                raise VisualDatasetImageNotFoundError(f"图片 {image_id} 不存在")
            img = _row_to_image(row)
            stored = Path(img.stored_path)
            if stored.exists():
                stored.unlink(missing_ok=True)
            conn.execute("DELETE FROM visual_dataset_images WHERE id = ?", (image_id,))
            conn.execute(
                "UPDATE visual_datasets SET image_count = MAX(0, image_count - 1) WHERE id = ?",
                (img.dataset_id,),
            )
            conn.commit()
            self._recompute_quality(conn, img.dataset_id)
            conn.commit()

    # ── Quality ─────────────────────────────────────────────────────────────────

    def _recompute_quality(self, conn: sqlite3.Connection, dataset_id: str) -> None:
        rows = conn.execute(
            "SELECT * FROM visual_dataset_images WHERE dataset_id = ?", (dataset_id,)
        ).fetchall()
        images = [_row_to_image(r) for r in rows]
        score, issues = _score_dataset(images)
        conn.execute(
            "UPDATE visual_datasets SET quality_score = ?, quality_issues_json = ? WHERE id = ?",
            (score, json.dumps(issues, ensure_ascii=False), dataset_id),
        )


def create_visual_dataset_service(db_path: Path, data_root: Path) -> VisualDatasetService:
    return VisualDatasetService(db_path=db_path, data_root=data_root)
