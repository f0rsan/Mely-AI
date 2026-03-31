import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class GenerationArchiveRequest(BaseModel):
    """Payload to archive a completed generation result."""

    model_config = ConfigDict(populate_by_name=True)

    character_id: str = Field(alias="characterId")
    costume_id: str = Field(alias="costumeId")
    # Assembled prompt that was actually sent to the engine.
    assembled_prompt: str = Field(alias="assembledPrompt")
    negative_prompt: str = Field(default="", alias="negativePrompt")
    width: int
    height: int
    steps: int
    sampler: str
    cfg_scale: float = Field(alias="cfgScale")
    seed: int | None = None
    lora_weight: float = Field(alias="loraWeight")
    tags: list[str] = Field(default_factory=list)
    # Base64-encoded image bytes OR a file path already on disk (from engine).
    # For M2-F we accept a base64 PNG so the archive is self-contained in tests.
    image_data_b64: str | None = Field(default=None, alias="imageDataB64")


class GenerationArchiveRecord(BaseModel):
    """Stored generation record returned by the API."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    character_id: str = Field(alias="characterId")
    costume_id: str = Field(alias="costumeId")
    output_path: str = Field(alias="outputPath")
    params_snapshot: dict[str, Any] = Field(alias="paramsSnapshot")
    tags: list[str]
    created_at: str = Field(alias="createdAt")
