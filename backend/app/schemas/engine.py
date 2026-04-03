from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

EngineState = Literal["stopped", "starting", "running", "crashed", "restarting", "failed"]


class EngineStatus(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    state: EngineState
    restart_count: int = Field(alias="restartCount")
    error_message: str | None = Field(default=None, alias="errorMessage")
    pid: int | None = None


class EngineStartResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    status: EngineStatus
    message: str


class EngineStopResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    status: EngineStatus
    message: str
