"""Unit tests for the prompt assembler service."""
import pytest

from app.schemas.prompt import PromptAssembleRequest
from app.services.prompt_assembler import assemble_prompt


def make_request(**kwargs) -> PromptAssembleRequest:
    defaults = dict(
        scenePrompt="在咖啡馆里看书",
        dnaPrompt="pink hair, violet eyes, anime girl",
        triggerWord="hoshino_mika",
        costumePrompt="school uniform, white shirt",
        overridePrompt=None,
    )
    defaults.update(kwargs)
    return PromptAssembleRequest(**defaults)


# ---------------------------------------------------------------------------
# Assembly order and basic output
# ---------------------------------------------------------------------------


def test_trigger_word_appears_first():
    result = assemble_prompt(make_request())
    parts = result.assembled.split(", ")
    assert parts[0] == "hoshino_mika"


def test_scene_prompt_appears_last():
    result = assemble_prompt(make_request())
    # scene_prompt is last; last token should be from the scene
    assert "在咖啡馆里看书" in result.assembled
    assert result.assembled.endswith("在咖啡馆里看书")


def test_assembled_contains_all_sources():
    result = assemble_prompt(make_request())
    assert "hoshino_mika" in result.assembled
    assert "pink hair" in result.assembled
    assert "school uniform" in result.assembled
    assert "在咖啡馆里看书" in result.assembled


def test_assembled_is_comma_separated():
    result = assemble_prompt(make_request())
    assert ", " in result.assembled


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------


def test_duplicate_tokens_removed():
    # "anime girl" appears in both dna_prompt and costume_prompt
    result = assemble_prompt(
        make_request(
            dnaPrompt="pink hair, anime girl",
            costumePrompt="anime girl, school uniform",
        )
    )
    tokens = [t.strip() for t in result.assembled.split(",")]
    assert tokens.count("anime girl") == 1


def test_deduplication_is_case_insensitive():
    result = assemble_prompt(
        make_request(
            dnaPrompt="Pink Hair, anime girl",
            costumePrompt="pink hair, school uniform",
        )
    )
    lower_tokens = [t.strip().lower() for t in result.assembled.split(",")]
    assert lower_tokens.count("pink hair") == 1


def test_first_occurrence_is_kept_over_later_duplicates():
    # trigger_word is first; if dna also has the same token, dna version should be dropped
    result = assemble_prompt(
        make_request(
            triggerWord="star_char",
            dnaPrompt="star_char, blue eyes",
        )
    )
    tokens = [t.strip() for t in result.assembled.split(",")]
    assert tokens.count("star_char") == 1
    assert tokens[0] == "star_char"


# ---------------------------------------------------------------------------
# Empty / missing sources
# ---------------------------------------------------------------------------


def test_empty_sources_are_omitted():
    result = assemble_prompt(
        make_request(
            triggerWord="",
            dnaPrompt="",
            costumePrompt="",
        )
    )
    assert result.assembled == "在咖啡馆里看书"


def test_empty_trigger_word_does_not_leave_leading_comma():
    result = assemble_prompt(
        make_request(
            triggerWord="",
            dnaPrompt="blue eyes",
            costumePrompt="",
        )
    )
    assert not result.assembled.startswith(",")
    assert "blue eyes" in result.assembled


# ---------------------------------------------------------------------------
# Override
# ---------------------------------------------------------------------------


def test_override_prompt_skips_assembly():
    result = assemble_prompt(
        make_request(overridePrompt="completely custom prompt")
    )
    assert result.assembled == "completely custom prompt"
    assert result.was_overridden is True
    assert len(result.components) == 1
    assert result.components[0].source == "override"


def test_override_empty_string_is_accepted():
    result = assemble_prompt(make_request(overridePrompt=""))
    assert result.was_overridden is True
    assert result.assembled == ""


# ---------------------------------------------------------------------------
# Components breakdown
# ---------------------------------------------------------------------------


def test_components_has_four_entries_for_normal_assembly():
    result = assemble_prompt(make_request())
    assert len(result.components) == 4


def test_active_components_reflect_contribution():
    result = assemble_prompt(
        make_request(
            triggerWord="char_a",
            dnaPrompt="blue eyes",
            costumePrompt="",  # empty → inactive
            scenePrompt="smiling",
        )
    )
    source_active = {c.source: c.active for c in result.components}
    assert source_active["trigger_word"] is True
    assert source_active["dna_prompt"] is True
    assert source_active["costume_prompt"] is False
    assert source_active["scene_prompt"] is True


def test_fully_deduped_component_is_marked_inactive():
    # costume_prompt only has tokens already in dna_prompt
    result = assemble_prompt(
        make_request(
            dnaPrompt="pink hair, anime girl",
            costumePrompt="pink hair",  # fully duplicate
        )
    )
    costume_comp = next(c for c in result.components if c.source == "costume_prompt")
    assert costume_comp.active is False


def test_component_labels_are_chinese():
    result = assemble_prompt(make_request())
    label_map = {c.source: c.label for c in result.components}
    assert label_map["trigger_word"] == "LoRA 触发词"
    assert label_map["dna_prompt"] == "角色 DNA"
    assert label_map["costume_prompt"] == "造型词"
    assert label_map["scene_prompt"] == "场景描述"


# ---------------------------------------------------------------------------
# Token count
# ---------------------------------------------------------------------------


def test_token_count_is_nonzero_for_nonempty_prompt():
    result = assemble_prompt(make_request())
    assert result.token_count > 0


def test_token_count_is_zero_for_override_empty():
    result = assemble_prompt(make_request(overridePrompt=""))
    assert result.token_count == 0
