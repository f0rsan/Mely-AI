from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


MemoryKind = Literal["fact", "event", "relationship", "preference"]


class TriggerRule(BaseModel):
    trigger: str
    reaction: str


class CharacterProfileData(BaseModel):
    """Shared profile fields — used by both request and response schemas."""
    model_config = ConfigDict(populate_by_name=True)

    # Persona
    persona_summary: str | None = Field(default=None, alias="personaSummary")
    personality_traits: list[str] | None = Field(default=None, alias="personalityTraits")
    speaking_style: str | None = Field(default=None, alias="speakingStyle")
    backstory: str | None = None
    values_beliefs: str | None = Field(default=None, alias="valuesBeliefs")
    quirks: str | None = None
    likes: list[str] | None = None
    dislikes: list[str] | None = None

    # Worldbuilding
    world_name: str | None = Field(default=None, alias="worldName")
    world_setting: str | None = Field(default=None, alias="worldSetting")
    world_rules: str | None = Field(default=None, alias="worldRules")
    world_key_events: str | None = Field(default=None, alias="worldKeyEvents")

    # Interaction
    user_address: str = Field(default="你", alias="userAddress")
    self_address: str = Field(default="我", alias="selfAddress")
    catchphrases: list[str] | None = None
    forbidden_words: list[str] | None = Field(default=None, alias="forbiddenWords")
    emotion_default: str | None = Field(default=None, alias="emotionDefault")
    trigger_rules: list[TriggerRule] | None = Field(default=None, alias="triggerRules")


class CharacterProfileResponse(CharacterProfileData):
    character_id: str = Field(alias="characterId")
    updated_at: str = Field(alias="updatedAt")
    profile_version: int = Field(alias="profileVersion")


class CharacterProfileUpdateRequest(CharacterProfileData):
    pass


class SystemPromptPreviewRequest(CharacterProfileData):
    pass


class SystemPromptPreviewResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    prompt: str
    estimated_tokens: int = Field(alias="estimatedTokens")
    has_profile: bool = Field(alias="hasProfile")
    memory_count: int = Field(alias="memoryCount")


class MemoryCreateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind: MemoryKind = "fact"
    content: str
    importance: int = Field(default=3, ge=1, le=5)
    pinned: bool = False

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("记忆内容不能为空")
        if len(normalized) > 300:
            raise ValueError("记忆内容不能超过 300 字")
        return normalized


class MemoryUpdateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind: MemoryKind | None = None
    content: str | None = None
    importance: int | None = Field(default=None, ge=1, le=5)
    pinned: bool | None = None

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("记忆内容不能为空")
        if len(normalized) > 300:
            raise ValueError("记忆内容不能超过 300 字")
        return normalized


class MemoryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    character_id: str = Field(alias="characterId")
    kind: str
    content: str
    importance: int
    pinned: bool
    source: str
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    last_used_at: str | None = Field(default=None, alias="lastUsedAt")
    hit_count: int = Field(default=0, alias="hitCount")


class MemoryListResponse(BaseModel):
    items: list[MemoryResponse]
    total: int
