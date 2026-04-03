"""LLM dataset management service.

Supports two input formats:
  - Persona document (Markdown / TXT): descriptive text about the character
  - Dialogue samples (JSONL / CSV): user/assistant conversation pairs

Both are converted to a unified ShareGPT JSONL format for Unsloth training:
  {"conversations": [{"from": "human", "value": "..."}, {"from": "gpt", "value": "..."}]}
"""
from __future__ import annotations

import csv
import io
import json
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.core.paths import ensure_llm_directories


# ── Errors ─────────────────────────────────────────────────────────────────────

class LLMDatasetError(Exception):
    """Base LLM dataset error."""


class LLMDatasetCharacterNotFoundError(LLMDatasetError):
    """Character does not exist."""


class LLMDatasetValidationError(LLMDatasetError):
    """Dataset payload is invalid."""


class LLMDatasetNotFoundError(LLMDatasetError):
    """Dataset record does not exist."""


# ── Constants ──────────────────────────────────────────────────────────────────

MIN_ITEMS_ERROR = 10       # below this → upload rejected
MIN_ITEMS_WARNING = 50     # below this → quality warning
MIN_AVG_RESPONSE_LEN = 10  # chars, below this → quality warning

# Synthetic Q&A seeds for persona doc sections
_PERSONA_QA_SEEDS: list[tuple[str, str]] = [
    ("name_intro", "请介绍一下你自己"),
    ("personality", "你的性格是什么样的？"),
    ("background", "你有什么样的背景故事？"),
    ("style", "你平时说话是什么风格？"),
    ("hobbies", "你有什么爱好或特长？"),
    ("catchphrase", "你有什么口头禅或习惯用语吗？"),
]


# ── Data models ────────────────────────────────────────────────────────────────

@dataclass(slots=True)
class ConversationItem:
    human: str
    gpt: str


@dataclass(slots=True)
class QualityReport:
    item_count: int
    avg_response_len: float
    score: float            # 0.0 – 1.0
    issues: list[str]       # user-visible Chinese strings
    warnings: list[str]


@dataclass(slots=True)
class LLMDatasetRecord:
    id: str
    character_id: str
    name: str
    source_format: str
    item_count: int
    quality_score: float | None
    quality_issues: list[str]
    converted_path: str | None
    created_at: str


# ── Internal helpers ───────────────────────────────────────────────────────────

def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _character_exists(conn: sqlite3.Connection, character_id: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM characters WHERE id = ?", (character_id,)
    ).fetchone() is not None


# ── Parsers ────────────────────────────────────────────────────────────────────

def _parse_persona_doc(text: str) -> list[ConversationItem]:
    """Convert a free-form persona document to synthetic Q&A pairs.

    Strategy:
    1. Split the document into sections (by Markdown headings or double newlines).
    2. Pair each section with a generic question seed.
    3. Always include a full-document "introduce yourself" pair.
    """
    items: list[ConversationItem] = []

    # Strip leading/trailing whitespace
    text = text.strip()
    if not text:
        return items

    # Full-document pair: ask the character to introduce themselves
    items.append(ConversationItem(human="请介绍一下你自己。", gpt=text))

    # Section-level pairs
    # Split by Markdown headings (## heading) or by two or more blank lines
    sections = re.split(r"(?:^#{1,3}\s+.+$|\n{2,})", text, flags=re.MULTILINE)
    sections = [s.strip() for s in sections if s.strip() and len(s.strip()) > 20]

    for i, section in enumerate(sections[:6]):          # at most 6 extra pairs
        question, _ = _PERSONA_QA_SEEDS[i % len(_PERSONA_QA_SEEDS)]
        _, q_text = _PERSONA_QA_SEEDS[i % len(_PERSONA_QA_SEEDS)]
        items.append(ConversationItem(human=q_text, gpt=section))

    return items


def _parse_dialogue_jsonl(text: str) -> list[ConversationItem]:
    """Parse JSONL dialogue samples.

    Accepted line formats:
      {"user": "...", "assistant": "..."}
      {"human": "...", "gpt": "..."}
      {"instruction": "...", "output": "..."}         (Alpaca)
      {"conversations": [{"from": "human", "value": "..."},
                          {"from": "gpt",   "value": "..."}]}  (ShareGPT)
    """
    items: list[ConversationItem] = []
    for lineno, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            raise LLMDatasetValidationError(
                f"第 {lineno} 行 JSON 格式有误，请检查后重新上传"
            )

        # ShareGPT format
        if "conversations" in obj:
            convs = obj["conversations"]
            human_val = next(
                (c.get("value", "") for c in convs if c.get("from") == "human"), ""
            )
            gpt_val = next(
                (c.get("value", "") for c in convs if c.get("from") == "gpt"), ""
            )
            if human_val and gpt_val:
                items.append(ConversationItem(human=human_val, gpt=gpt_val))
            continue

        # Simple key-value formats
        human = (
            obj.get("user") or obj.get("human") or obj.get("instruction") or ""
        )
        gpt = (
            obj.get("assistant") or obj.get("gpt") or obj.get("output") or ""
        )
        if not human or not gpt:
            raise LLMDatasetValidationError(
                f"第 {lineno} 行缺少对话内容（需要 user/assistant 或 human/gpt 字段）"
            )
        items.append(ConversationItem(human=str(human), gpt=str(gpt)))

    return items


def _parse_dialogue_csv(text: str) -> list[ConversationItem]:
    """Parse CSV dialogue samples.

    Expected header row (case-insensitive):
      user,assistant  or  human,gpt  or  question,answer
    """
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise LLMDatasetValidationError("CSV 文件为空或缺少表头行")

    # Normalise headers
    norm = {h.lower().strip(): h for h in reader.fieldnames if h}
    human_key = next(
        (norm[k] for k in ("user", "human", "question") if k in norm), None
    )
    gpt_key = next(
        (norm[k] for k in ("assistant", "gpt", "answer") if k in norm), None
    )
    if human_key is None or gpt_key is None:
        raise LLMDatasetValidationError(
            "CSV 表头格式不正确，需包含 user/assistant 或 human/gpt 列"
        )

    items: list[ConversationItem] = []
    for i, row in enumerate(reader, 2):
        human = (row.get(human_key) or "").strip()
        gpt = (row.get(gpt_key) or "").strip()
        if not human or not gpt:
            raise LLMDatasetValidationError(
                f"第 {i} 行内容不完整，请补充对话内容"
            )
        items.append(ConversationItem(human=human, gpt=gpt))

    return items


# ── Format detection ───────────────────────────────────────────────────────────

def _detect_format(filename: str, content: str) -> str:
    """Return source_format string from filename extension and content heuristics."""
    ext = Path(filename).suffix.lower()
    if ext in (".md", ".txt"):
        return "persona_doc"
    if ext == ".csv":
        return "dialogue_csv"
    if ext == ".jsonl":
        return "dialogue_jsonl"
    # No extension or unknown: sniff content
    first_line = content.strip().splitlines()[0] if content.strip() else ""
    try:
        json.loads(first_line)
        return "dialogue_jsonl"
    except (json.JSONDecodeError, IndexError):
        pass
    if "," in first_line and len(first_line.split(",")) >= 2:
        return "dialogue_csv"
    return "persona_doc"


def parse_dataset(filename: str, content: str) -> tuple[str, list[ConversationItem]]:
    """Auto-detect format and parse content. Returns (source_format, items)."""
    fmt = _detect_format(filename, content)
    if fmt == "persona_doc":
        return fmt, _parse_persona_doc(content)
    if fmt == "dialogue_jsonl":
        return fmt, _parse_dialogue_jsonl(content)
    if fmt == "dialogue_csv":
        return fmt, _parse_dialogue_csv(content)
    raise LLMDatasetValidationError(f"不支持的文件格式: {filename}")


# ── Quality check ──────────────────────────────────────────────────────────────

def evaluate_quality(
    items: list[ConversationItem],
    source_format: str = "dialogue_jsonl",
) -> QualityReport:
    """Compute a quality score and user-readable issue list.

    Persona documents are evaluated differently from dialogue samples:
    - Persona docs: quality depends on total text richness, not item count.
    - Dialogue samples: item count is the primary quality gate.
    """
    issues: list[str] = []
    warnings: list[str] = []
    count = len(items)
    is_persona = source_format == "persona_doc"

    if not is_persona:
        if count < MIN_ITEMS_ERROR:
            issues.append(
                f"对话条目过少（当前 {count} 条，至少需要 {MIN_ITEMS_ERROR} 条才能训练）"
            )
        elif count < MIN_ITEMS_WARNING:
            warnings.append(
                f"对话条目偏少（当前 {count} 条，建议 {MIN_ITEMS_WARNING} 条以上效果更好）"
            )
    else:
        # Persona doc: warn if total character count is very low
        total_chars = sum(len(it.gpt) for it in items)
        if total_chars < 100:
            issues.append("人设文档内容过短，建议补充更详细的性格、背景等描述")
        elif total_chars < 300:
            warnings.append("人设文档内容较少，添加更多细节（口癖、背景故事等）可提升训练效果")

    if count > 0:
        avg_len = sum(len(it.gpt) for it in items) / count
        if not is_persona and avg_len < MIN_AVG_RESPONSE_LEN:
            issues.append(
                f"角色回复平均长度过短（{avg_len:.0f} 字），建议补充更丰富的回复内容"
            )

        # Check for duplicate questions (dialogue only)
        if not is_persona:
            human_set = {it.human for it in items}
            if len(human_set) < count * 0.7:
                warnings.append("问题重复率较高，建议增加多样性")
    else:
        avg_len = 0.0

    # Score: start at 1.0, deduct for issues and warnings
    score = 1.0
    score -= 0.4 * len(issues)
    score -= 0.1 * len(warnings)
    score = max(0.0, min(1.0, score))

    return QualityReport(
        item_count=count,
        avg_response_len=avg_len if count > 0 else 0.0,
        score=score,
        issues=issues,
        warnings=warnings,
    )


# ── ShareGPT serialiser ────────────────────────────────────────────────────────

def to_sharegpt_jsonl(items: list[ConversationItem]) -> str:
    """Serialise items to ShareGPT JSONL string."""
    lines = []
    for item in items:
        obj = {
            "conversations": [
                {"from": "human", "value": item.human},
                {"from": "gpt",   "value": item.gpt},
            ]
        }
        lines.append(json.dumps(obj, ensure_ascii=False))
    return "\n".join(lines)


# ── DB helpers ─────────────────────────────────────────────────────────────────

def _row_to_record(row: sqlite3.Row) -> LLMDatasetRecord:
    issues = json.loads(row["quality_issues_json"]) if row["quality_issues_json"] else []
    return LLMDatasetRecord(
        id=row["id"],
        character_id=row["character_id"],
        name=row["name"],
        source_format=row["source_format"],
        item_count=row["item_count"],
        quality_score=row["quality_score"],
        quality_issues=issues,
        converted_path=row["converted_path"],
        created_at=row["created_at"],
    )


# ── Public service functions ───────────────────────────────────────────────────

def ingest_dataset(
    conn: sqlite3.Connection,
    data_root: Path,
    character_id: str,
    filename: str,
    content: str,
) -> LLMDatasetRecord:
    """Parse, validate, quality-check, and persist an LLM dataset.

    Returns the created LLMDatasetRecord.
    Raises LLMDatasetCharacterNotFoundError if character doesn't exist.
    Raises LLMDatasetValidationError on bad content.
    """
    if not _character_exists(conn, character_id):
        raise LLMDatasetCharacterNotFoundError(
            f"角色不存在，请先创建角色再上传数据集"
        )

    source_format, items = parse_dataset(filename, content)
    quality = evaluate_quality(items, source_format=source_format)

    if quality.issues:
        # Hard blocking errors (non-warning issues that prevent training)
        is_persona = source_format == "persona_doc"
        for issue in quality.issues:
            if is_persona and "过短" in issue:
                raise LLMDatasetValidationError(issue)
            if not is_persona and "过少" in issue and quality.item_count < MIN_ITEMS_ERROR:
                raise LLMDatasetValidationError(issue)

    # Persist converted JSONL to disk
    dirs = ensure_llm_directories(data_root, character_id)
    dataset_id = str(uuid4())
    converted_path = dirs["llm_datasets"] / f"{dataset_id}.jsonl"
    converted_path.write_text(to_sharegpt_jsonl(items), encoding="utf-8")

    now = _utc_now()
    conn.execute(
        """
        INSERT INTO llm_datasets
            (id, character_id, name, source_format, item_count,
             quality_score, quality_issues_json, converted_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            dataset_id,
            character_id,
            filename,
            source_format,
            len(items),
            quality.score,
            json.dumps(quality.issues + quality.warnings, ensure_ascii=False),
            str(converted_path),
            now,
        ),
    )
    conn.commit()

    return LLMDatasetRecord(
        id=dataset_id,
        character_id=character_id,
        name=filename,
        source_format=source_format,
        item_count=len(items),
        quality_score=quality.score,
        quality_issues=quality.issues + quality.warnings,
        converted_path=str(converted_path),
        created_at=now,
    )


def list_datasets(
    conn: sqlite3.Connection, character_id: str
) -> list[LLMDatasetRecord]:
    """Return all LLM datasets for a character, newest first."""
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM llm_datasets WHERE character_id = ? ORDER BY created_at DESC",
        (character_id,),
    ).fetchall()
    return [_row_to_record(r) for r in rows]


def get_dataset(conn: sqlite3.Connection, dataset_id: str) -> LLMDatasetRecord:
    """Fetch a single dataset by id."""
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT * FROM llm_datasets WHERE id = ?", (dataset_id,)
    ).fetchone()
    if row is None:
        raise LLMDatasetNotFoundError("数据集不存在")
    return _row_to_record(row)


def delete_dataset(conn: sqlite3.Connection, dataset_id: str) -> None:
    """Delete dataset record and its converted file."""
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT converted_path FROM llm_datasets WHERE id = ?", (dataset_id,)
    ).fetchone()
    if row is None:
        raise LLMDatasetNotFoundError("数据集不存在")
    # Remove file
    if row["converted_path"]:
        p = Path(row["converted_path"])
        if p.exists():
            p.unlink()
    conn.execute("DELETE FROM llm_datasets WHERE id = ?", (dataset_id,))
    conn.commit()


def preview_dataset(
    conn: sqlite3.Connection, dataset_id: str, limit: int = 10
) -> list[ConversationItem]:
    """Return first `limit` items from the converted JSONL for preview."""
    record = get_dataset(conn, dataset_id)
    if not record.converted_path:
        return []
    p = Path(record.converted_path)
    if not p.exists():
        return []

    items: list[ConversationItem] = []
    for line in p.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        obj = json.loads(line)
        convs = obj.get("conversations", [])
        human = next((c["value"] for c in convs if c["from"] == "human"), "")
        gpt = next((c["value"] for c in convs if c["from"] == "gpt"), "")
        if human and gpt:
            items.append(ConversationItem(human=human, gpt=gpt))
        if len(items) >= limit:
            break
    return items
