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
