from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CharacterDNA(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    hair_color: str | None = Field(default=None, alias="hairColor")
    eye_color: str | None = Field(default=None, alias="eyeColor")
    skin_tone: str | None = Field(default=None, alias="skinTone")
    body_type: str | None = Field(default=None, alias="bodyType")
    style: str | None = None
    extra_tags: list[str] | None = Field(default=None, alias="extraTags")
    auto_prompt: str | None = Field(default=None, alias="autoPrompt")


class CharacterDNAUpdateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    hair_color: str = Field(alias="hairColor")
    eye_color: str = Field(alias="eyeColor")
    skin_tone: str = Field(alias="skinTone")
    body_type: str = Field(alias="bodyType")
    style: str
    extra_tags: list[str] | None = Field(default=None, alias="extraTags")

    @staticmethod
    def _normalize_required_text(value: str, field_name: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError(f"{field_name}不能为空")
        return normalized

    @field_validator("hair_color")
    @classmethod
    def validate_hair_color(cls, value: str) -> str:
        return cls._normalize_required_text(value, "发色")

    @field_validator("eye_color")
    @classmethod
    def validate_eye_color(cls, value: str) -> str:
        return cls._normalize_required_text(value, "瞳色")

    @field_validator("skin_tone")
    @classmethod
    def validate_skin_tone(cls, value: str) -> str:
        return cls._normalize_required_text(value, "肤色")

    @field_validator("body_type")
    @classmethod
    def validate_body_type(cls, value: str) -> str:
        return cls._normalize_required_text(value, "体型")

    @field_validator("style")
    @classmethod
    def validate_style(cls, value: str) -> str:
        return cls._normalize_required_text(value, "风格")

    @field_validator("extra_tags")
    @classmethod
    def validate_extra_tags(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None

        normalized = [item.strip() for item in value if item.strip()]
        return normalized or None


class DNASuggestionOption(BaseModel):
    value: str
    prompt: str


class DNASuggestionField(BaseModel):
    label: str
    recommended: str
    recommended_prompt: str = Field(alias="recommendedPrompt")
    options: list[DNASuggestionOption]


class WD14SuggestionMeta(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    available: bool
    model_id: str | None = Field(default=None, alias="modelId")
    reason: str | None = None
    tags: list[str] = Field(default_factory=list)


class CharacterDNASuggestionResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    character_id: str = Field(alias="characterId")
    source: str
    fields: dict[str, DNASuggestionField]
    auto_prompt_preview: str = Field(alias="autoPromptPreview")
    wd14: WD14SuggestionMeta


class CharacterVisualAssets(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    lora_path: str | None = Field(default=None, alias="loraPath")
    trigger_word: str | None = Field(default=None, alias="triggerWord")
    recommended_weight: float | None = Field(default=None, alias="recommendedWeight")
    base_checkpoint: str | None = Field(default=None, alias="baseCheckpoint")
    training_config: dict[str, Any] | None = Field(default=None, alias="trainingConfig")
    training_status: str | None = Field(default=None, alias="trainingStatus")
    training_progress: float | None = Field(default=None, alias="trainingProgress")


class CharacterVoiceAssets(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    reference_audio_path: str | None = Field(default=None, alias="referenceAudioPath")
    tts_engine: str | None = Field(default=None, alias="ttsEngine")
    custom_model_path: str | None = Field(default=None, alias="customModelPath")


class CharacterCreateRequest(BaseModel):
    name: str
    fingerprint: str | None = None
    dna: CharacterDNA | None = None
    visual: CharacterVisualAssets | None = None
    voice: CharacterVoiceAssets | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("角色名称不能为空")
        return normalized

    @field_validator("fingerprint")
    @classmethod
    def validate_fingerprint(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class CharacterUpdateRequest(BaseModel):
    name: str | None = None
    fingerprint: str | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("角色名称不能为空")
        return normalized

    @field_validator("fingerprint")
    @classmethod
    def validate_fingerprint(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class CharacterListItemResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    created_at: str = Field(alias="createdAt")
    fingerprint: str | None = None
    is_visual_training: bool = Field(default=False, alias="isVisualTraining")


class CharacterListResponse(BaseModel):
    items: list[CharacterListItemResponse]
    total: int


class CharacterDetailResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    created_at: str = Field(alias="createdAt")
    fingerprint: str | None = None
    dna: CharacterDNA | None = None
    visual: CharacterVisualAssets | None = None
    voice: CharacterVoiceAssets | None = None
