from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal


LLMTrainingMode = Literal["light", "standard", "fine"]
HardwarePolicyId = Literal["product_8gb", "validation_16gb"]


@dataclass(frozen=True, slots=True)
class LLMTrainingBaseModelConfig:
    ollama_tag: str
    huggingface_model_id: str
    default_lora_rank: int
    max_seq_len: int
    expected_dtype: str
    expected_quantization: str

    def to_dict(self) -> dict[str, object]:
        return {
            "ollamaTag": self.ollama_tag,
            "huggingFaceModelId": self.huggingface_model_id,
            "defaultLoraRank": self.default_lora_rank,
            "maxSeqLen": self.max_seq_len,
            "expectedDtype": self.expected_dtype,
            "expectedQuantization": self.expected_quantization,
        }


@dataclass(frozen=True, slots=True)
class LLMTrainingHardwarePolicy:
    id: HardwarePolicyId
    display_name: str
    allowed_modes: tuple[LLMTrainingMode, ...]


MODE_DISPLAY_NAMES: dict[LLMTrainingMode, str] = {
    "light": "轻量",
    "standard": "标准",
    "fine": "精细",
}

DEFAULT_TRAINING_BASE_MODEL = "qwen2.5:7b-instruct-q4_K_M"

SUPPORTED_TRAINING_BASE_MODELS: tuple[LLMTrainingBaseModelConfig, ...] = (
    LLMTrainingBaseModelConfig(
        ollama_tag="qwen2.5:7b-instruct-q4_K_M",
        huggingface_model_id="Qwen/Qwen2.5-7B-Instruct",
        default_lora_rank=16,
        max_seq_len=4096,
        expected_dtype="bfloat16",
        expected_quantization="Ollama Q4_K_M / Unsloth 4-bit QLoRA",
    ),
    LLMTrainingBaseModelConfig(
        ollama_tag="qwen2.5:3b",
        huggingface_model_id="Qwen/Qwen2.5-3B-Instruct",
        default_lora_rank=16,
        max_seq_len=4096,
        expected_dtype="bfloat16",
        expected_quantization="Ollama Q4_K_M compatible / Unsloth 4-bit QLoRA",
    ),
)

PRODUCT_8GB_POLICY = LLMTrainingHardwarePolicy(
    id="product_8gb",
    display_name="RTX 3070 8GB 产品基线",
    allowed_modes=("light", "standard"),
)

VALIDATION_16GB_POLICY = LLMTrainingHardwarePolicy(
    id="validation_16gb",
    display_name="RTX 5060 16GB 当前验证机",
    allowed_modes=("light", "standard", "fine"),
)


def _normalize_model_name(model_name: str) -> str:
    return model_name.strip().lower()


def _build_model_index() -> dict[str, LLMTrainingBaseModelConfig]:
    return {
        _normalize_model_name(config.ollama_tag): config
        for config in SUPPORTED_TRAINING_BASE_MODELS
    }


MODEL_INDEX = _build_model_index()

HARDWARE_POLICIES: dict[HardwarePolicyId, LLMTrainingHardwarePolicy] = {
    PRODUCT_8GB_POLICY.id: PRODUCT_8GB_POLICY,
    VALIDATION_16GB_POLICY.id: VALIDATION_16GB_POLICY,
}

HARDWARE_POLICY_ALIASES: dict[str, HardwarePolicyId] = {
    "product_8gb": "product_8gb",
    "rtx3070_8gb": "product_8gb",
    "baseline_8gb": "product_8gb",
    "validation_16gb": "validation_16gb",
    "rtx5060_16gb": "validation_16gb",
    "dev_16gb": "validation_16gb",
}


def list_supported_training_base_models() -> list[LLMTrainingBaseModelConfig]:
    return list(SUPPORTED_TRAINING_BASE_MODELS)


def get_training_base_model(model_name: str) -> LLMTrainingBaseModelConfig | None:
    return MODEL_INDEX.get(_normalize_model_name(model_name))


def is_supported_training_base_model(model_name: str) -> bool:
    return get_training_base_model(model_name) is not None


def resolve_hardware_policy(policy_id: str | None = None) -> LLMTrainingHardwarePolicy:
    normalized = (policy_id or "").strip().lower()
    if not normalized:
        return PRODUCT_8GB_POLICY
    resolved_id = HARDWARE_POLICY_ALIASES.get(normalized, "product_8gb")
    return HARDWARE_POLICIES[resolved_id]


def get_active_hardware_policy() -> LLMTrainingHardwarePolicy:
    return resolve_hardware_policy(os.getenv("MELY_LLM_HARDWARE_POLICY"))


def is_mode_allowed_for_policy(mode: LLMTrainingMode, policy: LLMTrainingHardwarePolicy) -> bool:
    return mode in policy.allowed_modes


def build_unsupported_model_error(requested_model: str) -> str:
    supported = "、".join(config.ollama_tag for config in SUPPORTED_TRAINING_BASE_MODELS)
    return (
        f"基础模型“{requested_model}”暂不支持训练。"
        f"当前仅支持：{supported}"
    )


def build_model_not_downloaded_error(model_name: str) -> str:
    return (
        f"基础模型“{model_name}”尚未在 Ollama 中就绪。"
        "请先在语言模型页下载完成后再开始训练。"
    )


def build_mode_not_allowed_error(mode: LLMTrainingMode, policy: LLMTrainingHardwarePolicy) -> str:
    mode_label = MODE_DISPLAY_NAMES.get(mode, mode)
    allowed_labels = "、".join(MODE_DISPLAY_NAMES[m] for m in policy.allowed_modes)
    return (
        f"当前硬件口径为「{policy.display_name}」，暂不允许“{mode_label}”模式。"
        f"可用模式：{allowed_labels}"
    )
