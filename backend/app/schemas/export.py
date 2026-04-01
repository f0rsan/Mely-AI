from pydantic import BaseModel, ConfigDict, Field

class ExportAcceptedResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    export_id: str = Field(alias="exportId")
    task_id: str = Field(alias="taskId")
    character_id: str = Field(alias="characterId")
    message: str

class ExportRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str
    character_id: str = Field(alias="characterId")
    export_type: str = Field(alias="exportType")
    file_path: str = Field(alias="filePath")
    file_size: int | None = Field(default=None, alias="fileSize")
    status: str  # pending / generating / completed / failed
    error_message: str | None = Field(default=None, alias="errorMessage")
    created_at: str = Field(alias="createdAt")
    completed_at: str | None = Field(default=None, alias="completedAt")

class ExportListResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    items: list[ExportRecord]

class ProofExportResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    character_id: str = Field(alias="characterId")
    chain: list[dict]
    total: int
    message: str

class ProofVerifyResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    character_id: str = Field(alias="characterId")
    is_valid: bool = Field(alias="isValid")
    total_proofs: int = Field(alias="totalProofs")
    error_message: str | None = Field(default=None, alias="errorMessage")
