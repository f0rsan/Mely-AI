"""
Persona Assembler — builds a character's system prompt from profile + memories.

Budget: ~1500 tokens ≈ 3000 Chinese characters (len(text) // 2 token estimate).
Section allocation:
  Core  (persona + interaction): 40% = 1200 chars  — always included
  Story + World:                 30% = 900 chars
  Memories:                      30% = 900 chars
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from app.db.connection import connect_database

BUDGET_CHARS = 3000
CORE_BUDGET = int(BUDGET_CHARS * 0.40)         # 1200
STORY_WORLD_BUDGET = int(BUDGET_CHARS * 0.30)  # 900
MEMORY_BUDGET = int(BUDGET_CHARS * 0.30)       # 900

DEFAULT_SYSTEM_PROMPT = "你是一个 AI 角色助手，请保持友好和帮助的态度与用户对话。"

PROFILE_FIELDS = (
    "persona_summary",
    "personality_traits",
    "speaking_style",
    "backstory",
    "values_beliefs",
    "quirks",
    "likes",
    "dislikes",
    "world_name",
    "world_setting",
    "world_rules",
    "world_key_events",
    "user_address",
    "self_address",
    "catchphrases",
    "forbidden_words",
    "emotion_default",
    "trigger_rules",
)


@dataclass(slots=True)
class MemorySection:
    text: str
    used_ids: list[str]


@dataclass(slots=True)
class PromptAssemblyResult:
    prompt: str
    used_memory_ids: list[str]
    has_profile: bool


# ── Helpers ───────────────────────────────────────────────────────────────────

ProfileSource = sqlite3.Row | Mapping[str, Any]


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 2)


def _truncate(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 3] + "..."


def _load_json_list(value: str | list[Any] | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    if not value:
        return []
    try:
        result = json.loads(value)
        return [str(item) for item in result if str(item).strip()] if isinstance(result, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _load_trigger_rules(value: str | list[Any] | None) -> list[dict[str, str]]:
    if value is None:
        return []
    if isinstance(value, list):
        rules: list[dict[str, str]] = []
        for item in value:
            if not isinstance(item, dict):
                continue
            trigger = str(item.get("trigger", "")).strip()
            reaction = str(item.get("reaction", "")).strip()
            rules.append({"trigger": trigger, "reaction": reaction})
        return rules
    if not value:
        return []
    try:
        result = json.loads(value)
        if not isinstance(result, list):
            return []
        return [
            {
                "trigger": str(item.get("trigger", "")).strip(),
                "reaction": str(item.get("reaction", "")).strip(),
            }
            for item in result
            if isinstance(item, dict)
        ]
    except (json.JSONDecodeError, TypeError):
        return []


def _value(source: ProfileSource, key: str) -> Any:
    if isinstance(source, sqlite3.Row):
        return source[key]
    return source.get(key)


def _profile_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {field: row[field] for field in PROFILE_FIELDS}


def _empty_profile() -> dict[str, Any]:
    profile = {field: None for field in PROFILE_FIELDS}
    profile["user_address"] = "你"
    profile["self_address"] = "我"
    return profile


def _merge_profile_source(
    base_row: sqlite3.Row | None,
    draft_profile: Mapping[str, Any] | None,
) -> dict[str, Any]:
    merged = _profile_row_to_dict(base_row) if base_row is not None else _empty_profile()
    if draft_profile:
        for key, value in draft_profile.items():
            if key in merged:
                merged[key] = value

    if not isinstance(merged.get("user_address"), str) or not str(merged["user_address"]).strip():
        merged["user_address"] = "你"
    if not isinstance(merged.get("self_address"), str) or not str(merged["self_address"]).strip():
        merged["self_address"] = "我"
    return merged


def _has_profile_content(profile: Mapping[str, Any]) -> bool:
    for field in (
        "persona_summary",
        "speaking_style",
        "backstory",
        "values_beliefs",
        "quirks",
        "world_name",
        "world_setting",
        "world_rules",
        "world_key_events",
        "emotion_default",
    ):
        value = profile.get(field)
        if isinstance(value, str) and value.strip():
            return True

    if _load_json_list(profile.get("personality_traits")):
        return True
    if _load_json_list(profile.get("likes")):
        return True
    if _load_json_list(profile.get("dislikes")):
        return True
    if _load_json_list(profile.get("catchphrases")):
        return True
    if _load_json_list(profile.get("forbidden_words")):
        return True
    if _load_trigger_rules(profile.get("trigger_rules")):
        return True

    user_address = str(profile.get("user_address", "")).strip()
    self_address = str(profile.get("self_address", "")).strip()
    return user_address not in ("", "你") or self_address not in ("", "我")


# ── Section builders ──────────────────────────────────────────────────────────

def _build_core_section(source: ProfileSource, char_name: str) -> str:
    parts: list[str] = []

    # Opening line
    summary = _value(source, "persona_summary") or ""
    parts.append(f"你将扮演 {char_name}。{summary}" if summary else f"你将扮演 {char_name}。")

    # Personality
    traits = _load_json_list(_value(source, "personality_traits"))
    if traits:
        parts.append(f"性格特质：{'、'.join(traits)}")

    speaking_style = _value(source, "speaking_style") or ""
    if speaking_style:
        parts.append(f"说话风格：{speaking_style}")

    # Interaction rules
    user_address = str(_value(source, "user_address") or "你")
    self_address = str(_value(source, "self_address") or "我")
    interaction: list[str] = [f"称呼对方为「{user_address}」，自称「{self_address}」"]

    catchphrases = _load_json_list(_value(source, "catchphrases"))
    if catchphrases:
        interaction.append(f"口癖：{'、'.join(catchphrases)}")

    emotion_default = _value(source, "emotion_default") or ""
    if emotion_default:
        interaction.append(f"情感基调：{emotion_default}")

    forbidden_words = _load_json_list(_value(source, "forbidden_words"))
    if forbidden_words:
        interaction.append(f"禁用词：{'、'.join(forbidden_words)}")

    parts.append("\n".join(interaction))

    # Trigger rules
    trigger_rules = _load_trigger_rules(_value(source, "trigger_rules"))
    trigger_lines = [
        f"- 当{rule['trigger']}时：{rule['reaction']}"
        for rule in trigger_rules
        if rule["trigger"] and rule["reaction"]
    ]
    if trigger_lines:
        parts.append("特殊反应规则：\n" + "\n".join(trigger_lines))

    # Behavior constraint (always last)
    parts.append(f"始终以 {char_name} 的身份和语气说话，不要暴露你是 AI 或语言模型。")

    return "\n\n".join(parts)


def _build_story_world_section(source: ProfileSource) -> str:
    parts: list[str] = []

    # Backstory block
    backstory_lines: list[str] = []
    if _value(source, "backstory"):
        backstory_lines.append(f"背景故事：{_value(source, 'backstory')}")
    if _value(source, "values_beliefs"):
        backstory_lines.append(f"价值观：{_value(source, 'values_beliefs')}")
    if _value(source, "quirks"):
        backstory_lines.append(f"癖好：{_value(source, 'quirks')}")
    likes = _load_json_list(_value(source, "likes"))
    if likes:
        backstory_lines.append(f"喜欢：{'、'.join(likes)}")
    dislikes = _load_json_list(_value(source, "dislikes"))
    if dislikes:
        backstory_lines.append(f"厌恶：{'、'.join(dislikes)}")
    if backstory_lines:
        parts.append("\n".join(backstory_lines))

    # Worldbuilding block
    world_lines: list[str] = []
    if _value(source, "world_name"):
        world_lines.append(f"所处世界：{_value(source, 'world_name')}")
    if _value(source, "world_setting"):
        world_lines.append(f"世界背景：{_value(source, 'world_setting')}")
    if _value(source, "world_rules"):
        world_lines.append(f"世界规则：{_value(source, 'world_rules')}")
    if _value(source, "world_key_events"):
        world_lines.append(f"关键历史：{_value(source, 'world_key_events')}")
    if world_lines:
        parts.append("世界观：\n" + "\n".join(world_lines))

    return "\n\n".join(parts)


def _build_memory_section(
    conn: sqlite3.Connection,
    character_id: str,
    recent_user_message: str | None,
    max_chars: int,
) -> MemorySection:
    if max_chars <= 0:
        return MemorySection(text="", used_ids=[])

    # Pinned memories — always included first
    pinned_rows = conn.execute(
        """
        SELECT id, content, rowid
        FROM character_memories
        WHERE character_id = ? AND pinned = 1
        ORDER BY importance DESC, updated_at DESC
        """,
        (character_id,),
    ).fetchall()

    # Recall by FTS5 keyword match (non-pinned)
    fts_rows: list[sqlite3.Row] = []
    if recent_user_message and recent_user_message.strip():
        raw_query = recent_user_message[:100].replace('"', "").strip()
        if raw_query:
            try:
                fts_rows = conn.execute(
                    """
                    SELECT m.id, m.content, m.rowid
                    FROM character_memories m
                    JOIN character_memories_fts fts ON fts.rowid = m.rowid
                    WHERE fts.content MATCH ?
                      AND m.character_id = ?
                      AND m.pinned = 0
                    ORDER BY m.importance DESC
                    LIMIT 5
                    """,
                    (raw_query, character_id),
                ).fetchall()
            except Exception:
                fts_rows = []

    # Fallback: top-importance non-pinned
    if not fts_rows:
        fts_rows = conn.execute(
            """
            SELECT id, content, rowid
            FROM character_memories
            WHERE character_id = ? AND pinned = 0
            ORDER BY importance DESC, updated_at DESC
            LIMIT 5
            """,
            (character_id,),
        ).fetchall()

    # Deduplicate
    seen_ids: set[str] = {row["id"] for row in pinned_rows}
    combined = list(pinned_rows)
    for row in fts_rows:
        if row["id"] not in seen_ids:
            combined.append(row)
            seen_ids.add(row["id"])

    if not combined:
        return MemorySection(text="", used_ids=[])

    header = "你知道关于对方的以下信息：\n"
    used_chars = len(header)
    lines: list[str] = []
    used_ids: list[str] = []

    for row in combined:
        line = f"- {row['content']}"
        if used_chars + len(line) + 1 > max_chars:
            break
        lines.append(line)
        used_chars += len(line) + 1
        used_ids.append(row["id"])

    if not lines:
        return MemorySection(text="", used_ids=[])

    return MemorySection(text=header + "\n".join(lines), used_ids=used_ids)


def _resolve_character_name(
    conn: sqlite3.Connection,
    character_id: str,
    char_name: str | None,
) -> str:
    if char_name is not None:
        return char_name
    char_row = conn.execute(
        "SELECT name FROM characters WHERE id = ?",
        (character_id,),
    ).fetchone()
    return char_row["name"] if char_row else "角色"


def _assemble_prompt_with_conn(
    conn: sqlite3.Connection,
    character_id: str,
    char_name: str | None = None,
    recent_user_message: str | None = None,
    draft_profile: Mapping[str, Any] | None = None,
) -> PromptAssemblyResult:
    profile_row = conn.execute(
        "SELECT * FROM character_profile WHERE character_id = ?",
        (character_id,),
    ).fetchone()

    profile_source = (
        _merge_profile_source(profile_row, draft_profile)
        if profile_row is not None or draft_profile is not None
        else None
    )
    has_profile = profile_source is not None and _has_profile_content(profile_source)

    if not has_profile:
        memory_alloc = max(0, BUDGET_CHARS - len(DEFAULT_SYSTEM_PROMPT))
        memory_section = _build_memory_section(conn, character_id, recent_user_message, memory_alloc)
        sections = [DEFAULT_SYSTEM_PROMPT]
        if memory_section.text:
            sections.append(memory_section.text)
        return PromptAssemblyResult(
            prompt="\n\n".join(sections),
            used_memory_ids=memory_section.used_ids,
            has_profile=False,
        )

    resolved_name = _resolve_character_name(conn, character_id, char_name)
    assert profile_source is not None  # guaranteed by has_profile

    core_text = _build_core_section(profile_source, resolved_name)
    story_world_text = _build_story_world_section(profile_source)

    core_truncated = _truncate(core_text, CORE_BUDGET)
    remaining = BUDGET_CHARS - len(core_truncated)

    story_alloc = min(STORY_WORLD_BUDGET, max(0, remaining - MEMORY_BUDGET))
    story_truncated = (
        _truncate(story_world_text, story_alloc)
        if story_world_text and story_alloc > 0
        else ""
    )

    memory_alloc = min(MEMORY_BUDGET, max(0, remaining - len(story_truncated)))
    memory_section = _build_memory_section(conn, character_id, recent_user_message, memory_alloc)

    sections = [core_truncated]
    if story_truncated:
        sections.append(story_truncated)
    if memory_section.text:
        sections.append(memory_section.text)

    return PromptAssemblyResult(
        prompt="\n\n".join(sections),
        used_memory_ids=memory_section.used_ids,
        has_profile=True,
    )


# ── Public API ────────────────────────────────────────────────────────────────

def build_system_prompt_with_metadata(
    db_path: Path,
    character_id: str,
    char_name: str | None = None,
    recent_user_message: str | None = None,
    draft_profile: Mapping[str, Any] | None = None,
) -> PromptAssemblyResult:
    conn = connect_database(db_path)
    conn.row_factory = sqlite3.Row
    try:
        return _assemble_prompt_with_conn(
            conn,
            character_id,
            char_name=char_name,
            recent_user_message=recent_user_message,
            draft_profile=draft_profile,
        )
    finally:
        conn.close()


def build_system_prompt(
    db_path: Path,
    character_id: str,
    char_name: str | None = None,
    recent_user_message: str | None = None,
) -> str:
    """Assemble and return the full system prompt text."""
    result = build_system_prompt_with_metadata(
        db_path,
        character_id,
        char_name=char_name,
        recent_user_message=recent_user_message,
    )
    return result.prompt


def build_memory_block_with_metadata(
    db_path: Path,
    character_id: str,
    recent_user_message: str | None = None,
) -> MemorySection:
    conn = connect_database(db_path)
    conn.row_factory = sqlite3.Row
    try:
        return _build_memory_section(conn, character_id, recent_user_message, MEMORY_BUDGET)
    finally:
        conn.close()


def build_memory_block(
    db_path: Path,
    character_id: str,
    recent_user_message: str | None = None,
) -> str:
    """Build only the memory section text."""
    return build_memory_block_with_metadata(
        db_path,
        character_id,
        recent_user_message=recent_user_message,
    ).text


def record_memory_hits(db_path: Path, memory_ids: list[str]) -> None:
    unique_ids = list(dict.fromkeys(memory_ids))
    if not unique_ids:
        return

    conn = connect_database(db_path)
    try:
        conn.executemany(
            """
            UPDATE character_memories
            SET hit_count = hit_count + 1,
                last_used_at = datetime('now')
            WHERE id = ?
            """,
            [(memory_id,) for memory_id in unique_ids],
        )
        conn.commit()
    finally:
        conn.close()


def preview_system_prompt(
    db_path: Path,
    character_id: str,
    char_name: str | None = None,
    draft_profile: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Return preview data: {prompt, estimated_tokens, has_profile, memory_count}."""
    conn = connect_database(db_path)
    conn.row_factory = sqlite3.Row
    try:
        memory_count = conn.execute(
            "SELECT COUNT(*) FROM character_memories WHERE character_id = ?",
            (character_id,),
        ).fetchone()[0]
    finally:
        conn.close()

    result = build_system_prompt_with_metadata(
        db_path,
        character_id,
        char_name=char_name,
        draft_profile=draft_profile,
    )
    return {
        "prompt": result.prompt,
        "estimated_tokens": estimate_tokens(result.prompt),
        "has_profile": result.has_profile,
        "memory_count": memory_count,
    }
