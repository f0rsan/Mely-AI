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
