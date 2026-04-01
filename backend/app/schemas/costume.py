"""Pydantic schemas for the Costume API — M4-A."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class CostumeCreateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(min_length=1, max_length=50)
    parent_id: str | None = Field(default=None, alias="parentId")
    costume_prompt: str = Field(min_length=1, alias="costumePrompt")


class CostumeUpdateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str | None = Field(default=None, min_length=1, max_length=50)
    costume_prompt: str | None = Field(default=None, min_length=1, alias="costumePrompt")


class CostumeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    character_id: str = Field(alias="characterId")
    name: str
    parent_id: str | None = Field(alias="parentId")
    costume_lora: str | None = Field(default=None, alias="costumeLora")
    costume_prompt: str = Field(alias="costumePrompt")
    is_root: bool = Field(alias="isRoot")
    preview_count: int = Field(alias="previewCount")
    created_at: str = Field(alias="createdAt")


class CostumeTreeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    character_id: str = Field(alias="characterId")
    costumes: list[CostumeResponse]
    total: int


class CostumePreviewResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    costume_id: str = Field(alias="costumeId")
    image_path: str = Field(alias="imagePath")
    sort_order: int = Field(default=0, alias="sortOrder")


class CostumePreviewListResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    costume_id: str = Field(alias="costumeId")
    previews: list[CostumePreviewResponse]


class CostumePreviewGenerateAcceptedResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    costume_id: str = Field(alias="costumeId")
    task_ids: list[str] = Field(alias="taskIds")
    message: str
