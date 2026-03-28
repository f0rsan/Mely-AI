from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class GenerationCostumeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    parent_id: str | None = Field(default=None, alias="parentId")
    costume_lora: str | None = Field(default=None, alias="costumeLora")
    costume_prompt: str = Field(alias="costumePrompt")
    created_at: str = Field(alias="createdAt")
    preview_images: list[str] = Field(default_factory=list, alias="previewImages")


class GenerationPromptSources(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    dna_prompt: str = Field(alias="dnaPrompt")
    trigger_word: str = Field(alias="triggerWord")
    costume_prompt: str = Field(alias="costumePrompt")


class GenerationParameterDefaults(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    width: int
    height: int
    steps: int
    sampler: str
    cfg_scale: float = Field(alias="cfgScale")
    seed: int
    lora_weight: float = Field(alias="loraWeight")


class GenerationWorkbenchResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    character_id: str = Field(alias="characterId")
    character_name: str = Field(alias="characterName")
    can_generate: bool = Field(alias="canGenerate")
    blocking_reason: str | None = Field(default=None, alias="blockingReason")
    costumes: list[GenerationCostumeResponse]
    selected_costume_id: str = Field(alias="selectedCostumeId")
    prompt_sources: GenerationPromptSources = Field(alias="promptSources")
    parameter_defaults: GenerationParameterDefaults = Field(alias="parameterDefaults")
    tag_options: list[str] = Field(
        default_factory=lambda: ["封面图", "表情包", "周边", "预告图"],
        alias="tagOptions",
    )


class GenerationSubmitRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    character_id: str = Field(alias="characterId")
    costume_id: str = Field(alias="costumeId")
    scene_prompt: str = Field(min_length=1, alias="scenePrompt")
    negative_prompt: str = Field(default="", alias="negativePrompt")
    width: int = Field(ge=64, le=4096)
    height: int = Field(ge=64, le=4096)
    steps: int = Field(ge=1, le=150)
    sampler: str = Field(min_length=1)
    cfg_scale: float = Field(ge=0.0, le=30.0, alias="cfgScale")
    seed: int | None = None
    lora_weight: float = Field(ge=0.0, le=2.0, alias="loraWeight")
    tags: list[str] = Field(default_factory=list)


class GenerationMockJobResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    task_id: str = Field(alias="taskId")
    character_id: str = Field(alias="characterId")
    costume_id: str = Field(alias="costumeId")
    scene_prompt: str = Field(alias="scenePrompt")
    status: Literal["pending", "running", "completed", "failed"]
    stage: Literal["queued", "running", "completed", "failed"]
    progress: int = Field(ge=0, le=100)
    message: str | None = None
    error: str | None = None
    tags: list[str] = Field(default_factory=list)
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class GenerationJobAcceptedResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    job: GenerationMockJobResponse
