from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.schemas.profile import (
    CharacterProfileResponse,
    SystemPromptPreviewRequest,
    CharacterProfileUpdateRequest,
    MemoryCreateRequest,
    MemoryListResponse,
    MemoryResponse,
    MemoryUpdateRequest,
    SystemPromptPreviewResponse,
)
from app.services.persona_assembler import preview_system_prompt
from app.services.profile_service import (
    MemoryNotFoundError,
    ProfileCharacterNotFoundError,
    ProfileService,
    ProfileServiceError,
    create_profile_service,
)

router = APIRouter()


def _resolve_service(request: Request) -> tuple[ProfileService, Path]:
    bootstrap = getattr(request.app.state, "bootstrap", None)
    if bootstrap is None or bootstrap.status != "ok":
        raise HTTPException(status_code=503, detail="服务初始化失败，请稍后重试")
    service = getattr(request.app.state, "profile_service", None)
    if service is None:
        service = create_profile_service(db_path=bootstrap.db_path)
        request.app.state.profile_service = service
    return service, bootstrap.db_path


# ── Profile endpoints ──────────────────────────────────────────────────────────

@router.get("/characters/{character_id}/profile", response_model=CharacterProfileResponse)
def get_profile(character_id: str, request: Request):
    service, _ = _resolve_service(request)
    try:
        profile = service.get_profile(character_id)
    except ProfileCharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if profile is None:
        raise HTTPException(status_code=404, detail="该角色尚未建立人设档案")
    return profile


@router.put("/characters/{character_id}/profile", response_model=CharacterProfileResponse)
def upsert_profile(
    character_id: str,
    payload: CharacterProfileUpdateRequest,
    request: Request,
):
    service, _ = _resolve_service(request)
    try:
        return service.upsert_profile(character_id, payload)
    except ProfileCharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProfileServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/characters/{character_id}/profile/preview",
    response_model=SystemPromptPreviewResponse,
)
def preview_prompt(
    character_id: str,
    request: Request,
    payload: SystemPromptPreviewRequest | None = None,
):
    service, db_path = _resolve_service(request)
    try:
        service.get_profile(character_id)  # verify character exists
    except ProfileCharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        draft_profile = payload.model_dump(exclude_unset=True) if payload is not None else None
        result = preview_system_prompt(
            db_path,
            character_id,
            draft_profile=draft_profile,
        )
        return SystemPromptPreviewResponse(
            prompt=result["prompt"],
            estimatedTokens=result["estimated_tokens"],
            hasProfile=result["has_profile"],
            memoryCount=result["memory_count"],
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail="预览生成失败，请稍后重试") from exc


# ── Memory endpoints ───────────────────────────────────────────────────────────

@router.get("/characters/{character_id}/memories", response_model=MemoryListResponse)
def list_memories(character_id: str, request: Request):
    service, _ = _resolve_service(request)
    try:
        items = service.list_memories(character_id)
        return MemoryListResponse(items=items, total=len(items))
    except ProfileCharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post(
    "/characters/{character_id}/memories",
    response_model=MemoryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_memory(character_id: str, payload: MemoryCreateRequest, request: Request):
    service, _ = _resolve_service(request)
    try:
        return service.create_memory(character_id, payload)
    except ProfileCharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProfileServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put(
    "/characters/{character_id}/memories/{memory_id}",
    response_model=MemoryResponse,
)
def update_memory(
    character_id: str,
    memory_id: str,
    payload: MemoryUpdateRequest,
    request: Request,
):
    service, _ = _resolve_service(request)
    try:
        return service.update_memory(character_id, memory_id, payload)
    except ProfileCharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except MemoryNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProfileServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete(
    "/characters/{character_id}/memories/{memory_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_memory(character_id: str, memory_id: str, request: Request):
    service, _ = _resolve_service(request)
    try:
        service.delete_memory(character_id, memory_id)
    except ProfileCharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except MemoryNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProfileServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
