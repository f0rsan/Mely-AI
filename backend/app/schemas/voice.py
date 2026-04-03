from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class VoiceUploadResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    character_id: str = Field(alias="characterId")
    reference_audio_path: str = Field(alias="referenceAudioPath")
    duration_seconds: float = Field(alias="durationSeconds")
    audio_format: str = Field(alias="audioFormat")
    status: str  # "extracting"
    message: str


class VoiceStatusResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    character_id: str = Field(alias="characterId")
    has_reference: bool = Field(alias="hasReference")
    status: str  # unbound / extracting / bound / failed
    reference_audio_path: str | None = Field(default=None, alias="referenceAudioPath")
    duration_seconds: float | None = Field(default=None, alias="durationSeconds")
    tts_engine: str | None = Field(default=None, alias="ttsEngine")
    bound_at: str | None = Field(default=None, alias="boundAt")


class TTSSynthesizeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    character_id: str = Field(alias="characterId")
    text: str = Field(min_length=1, max_length=500)
    language: str = Field(default="zh")  # zh / en / zh-en
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    output_format: str = Field(default="wav", alias="outputFormat")


class TTSSynthesizeAcceptedResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    task_id: str = Field(alias="taskId")
    character_id: str = Field(alias="characterId")
    message: str


class TTSEngineStatusResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    state: str
    restart_count: int = Field(alias="restartCount")
    error_message: str | None = Field(default=None, alias="errorMessage")
    pid: int | None = None


class TTSEngineActionResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    status: TTSEngineStatusResponse
    message: str


class VoiceprintExtractAcceptedResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    task_id: str = Field(alias="taskId")
    character_id: str = Field(alias="characterId")
    message: str
