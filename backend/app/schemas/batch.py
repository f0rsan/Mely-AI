from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class BatchGenerationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    character_id: str = Field(alias="characterId")
    costume_id: str = Field(alias="costumeId")
    scene_prompts: list[str] = Field(min_length=1, max_length=20, alias="scenePrompts")

    # Shared generation parameters (mirrors GenerationSubmitRequest).
    negative_prompt: str = Field(default="", alias="negativePrompt")
    width: int = Field(ge=64, le=4096, default=1024)
    height: int = Field(ge=64, le=4096, default=1024)
    steps: int = Field(ge=1, le=150, default=28)
    sampler: str = Field(default="DPM++ 2M Karras")
    cfg_scale: float = Field(ge=0.0, le=30.0, alias="cfgScale", default=3.5)
    seed: int | None = None
    lora_weight: float = Field(ge=0.0, le=2.0, alias="loraWeight", default=0.85)
    tags: list[str] = Field(default_factory=list)


class BatchJobItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    task_id: str = Field(alias="taskId")
    scene_prompt: str = Field(alias="scenePrompt")
    status: Literal["pending", "running", "completed", "failed"]
    progress: int = Field(ge=0, le=100)
    message: str | None = None
    error: str | None = None
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class BatchGenerationAcceptedResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    batch_id: str = Field(alias="batchId")
    jobs: list[BatchJobItem]
    total: int
