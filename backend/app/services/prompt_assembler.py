"""Prompt assembly service for M2-D.

Assembly order (highest → lowest priority for deduplication):
  1. trigger_word  — must appear first so the LoRA activates correctly
  2. dna_prompt    — character identity tags
  3. costume_prompt — outfit/visual overrides
  4. scene_prompt  — user-supplied scene description

Deduplication removes duplicate comma-separated tokens (case-insensitive),
keeping the first occurrence. Whitespace-only tokens are dropped.
"""
from __future__ import annotations

from app.schemas.prompt import (
    AssembledPromptResponse,
    PromptAssembleRequest,
    PromptComponent,
)

# Source identifiers and their Chinese labels.
_SOURCES: list[tuple[str, str]] = [
    ("trigger_word", "LoRA 触发词"),
    ("dna_prompt", "角色 DNA"),
    ("costume_prompt", "造型词"),
    ("scene_prompt", "场景描述"),
]

# Naive token count: split on whitespace and commas.
_MAX_TOKENS = 250  # safety cap; FLUX T5 supports ~225 tokens for effective prompting


def _split_tokens(text: str) -> list[str]:
    """Split a prompt string into individual tags (comma-separated)."""
    return [t.strip() for t in text.split(",") if t.strip()]


def _count_tokens(text: str) -> int:
    """Naive token count: split on whitespace."""
    return len(text.split()) if text.strip() else 0


def _deduplicate(parts: list[tuple[str, list[str]]]) -> list[tuple[str, list[str]]]:
    """Remove duplicate tokens across all parts, keeping first occurrence.

    Returns the same structure with duplicate tokens removed per part.
    """
    seen: set[str] = set()
    result: list[tuple[str, list[str]]] = []
    for source, tokens in parts:
        kept: list[str] = []
        for token in tokens:
            key = token.lower()
            if key not in seen:
                seen.add(key)
                kept.append(token)
        result.append((source, kept))
    return result


def assemble_prompt(request: PromptAssembleRequest) -> AssembledPromptResponse:
    # Handle user override: skip assembly entirely.
    if request.override_prompt is not None:
        override = request.override_prompt.strip()
        return AssembledPromptResponse(
            assembled=override,
            tokenCount=_count_tokens(override),
            components=[
                PromptComponent(
                    source="override",
                    label="用户自定义",
                    content=override,
                    active=bool(override),
                )
            ],
            wasOverridden=True,
        )

    # Build ordered parts list.
    raw_parts: list[tuple[str, str]] = [
        ("trigger_word", request.trigger_word),
        ("dna_prompt", request.dna_prompt),
        ("costume_prompt", request.costume_prompt),
        ("scene_prompt", request.scene_prompt),
    ]

    tokenized: list[tuple[str, list[str]]] = [
        (source, _split_tokens(text)) for source, text in raw_parts
    ]

    deduped = _deduplicate(tokenized)

    # Flatten all tokens, then apply max-token cap.
    all_tokens: list[str] = []
    for _, tokens in deduped:
        all_tokens.extend(tokens)

    # Apply safety cap (drop trailing tokens rather than truncating mid-tag).
    token_budget = _MAX_TOKENS
    capped_tokens: list[str] = []
    running_count = 0
    for token in all_tokens:
        tc = _count_tokens(token)
        if running_count + tc > token_budget:
            break
        capped_tokens.append(token)
        running_count += tc

    assembled = ", ".join(capped_tokens)

    # Build component breakdown (for UI display).
    # Mark a component active only if it contributed ≥1 token in the final assembled string.
    capped_set: set[str] = {t.lower() for t in capped_tokens}
    components: list[PromptComponent] = []
    label_map = dict(_SOURCES)

    for source, tokens in deduped:
        contributed = [t for t in tokens if t.lower() in capped_set]
        original_text = dict(raw_parts)[source]
        components.append(
            PromptComponent(
                source=source,
                label=label_map.get(source, source),
                content=", ".join(contributed),
                active=bool(contributed),
            )
        )
        # If none of this source's tokens made it (all deduped), content stays empty.
        # Provide the original text for display even if it was fully deduped.
        if not contributed and original_text.strip():
            components[-1].content = original_text.strip()
            # active stays False

    return AssembledPromptResponse(
        assembled=assembled,
        tokenCount=_count_tokens(assembled),
        components=components,
        wasOverridden=False,
    )
