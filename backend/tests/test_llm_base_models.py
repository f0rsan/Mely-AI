from __future__ import annotations

from app.services.llm_base_models import (
    DEFAULT_TRAINING_BASE_MODEL,
    build_mode_not_allowed_error,
    build_model_not_downloaded_error,
    build_unsupported_model_error,
    get_training_base_model,
    list_supported_training_base_models,
    resolve_hardware_policy,
)


def test_supported_training_models_have_expected_fields() -> None:
    configs = list_supported_training_base_models()
    assert len(configs) >= 2

    default_config = get_training_base_model(DEFAULT_TRAINING_BASE_MODEL)
    assert default_config is not None
    assert default_config.ollama_tag == "qwen2.5:3b"
    assert default_config.huggingface_model_id == "Qwen/Qwen2.5-3B-Instruct"
    assert default_config.default_lora_rank == 16
    assert default_config.max_seq_len == 4096
    assert "QLoRA" in default_config.expected_quantization


def test_unknown_training_model_returns_none() -> None:
    assert get_training_base_model("not-exist:model") is None


def test_hardware_policy_defaults_to_product_baseline() -> None:
    policy = resolve_hardware_policy(None)
    assert policy.id == "product_8gb"
    assert policy.allowed_modes == ("light", "standard")


def test_hardware_policy_validation_profile_allows_fine() -> None:
    policy = resolve_hardware_policy("validation_16gb")
    assert policy.id == "validation_16gb"
    assert "fine" in policy.allowed_modes


def test_error_messages_are_chinese() -> None:
    product_policy = resolve_hardware_policy("product_8gb")
    unsupported = build_unsupported_model_error("unknown:model")
    not_downloaded = build_model_not_downloaded_error("qwen2.5:3b")
    mode_blocked = build_mode_not_allowed_error("fine", product_policy)

    assert "暂不支持训练" in unsupported
    assert "尚未在 Ollama 中就绪" in not_downloaded
    assert "暂不允许" in mode_blocked
