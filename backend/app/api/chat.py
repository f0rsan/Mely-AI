from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.services.chat_service import (
    ChatCharacterNotFoundError,
    ChatModelNotReadyError,
    ChatNotFoundError,
)

router = APIRouter(tags=["chat"])


# ── Request / response models ──────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    llmModelId: str | None = None


class ChatSessionPayload(BaseModel):
    id: str
    characterId: str
    llmModelId: str | None
    createdAt: str


class ChatMessagePayload(BaseModel):
    id: str
    chatId: str
    role: str
    content: str
    createdAt: str


class SendMessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _resolve_chat_service(request: Request):
    svc = getattr(request.app.state, "chat_service", None)
    if svc is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="服务初始化失败，请稍后重试",
        )
    return svc


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post(
    "/characters/{character_id}/chats",
    response_model=ChatSessionPayload,
    status_code=status.HTTP_201_CREATED,
)
def create_chat_session(
    character_id: str,
    body: CreateSessionRequest,
    request: Request,
) -> ChatSessionPayload:
    """Create a new chat session for a character."""
    svc = _resolve_chat_service(request)
    try:
        session = svc.create_session(
            character_id=character_id,
            llm_model_id=body.llmModelId,
        )
    except ChatCharacterNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ChatModelNotReadyError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ChatSessionPayload(**session)


@router.get(
    "/characters/{character_id}/chats",
    response_model=list[ChatSessionPayload],
)
def list_chat_sessions(
    character_id: str,
    request: Request,
) -> list[ChatSessionPayload]:
    """List all chat sessions for a character."""
    svc = _resolve_chat_service(request)
    sessions = svc.list_sessions(character_id)
    return [ChatSessionPayload(**s) for s in sessions]


@router.get(
    "/chats/{chat_id}/messages",
    response_model=list[ChatMessagePayload],
)
def get_chat_messages(chat_id: str, request: Request) -> list[ChatMessagePayload]:
    """Get the full message history of a chat session."""
    svc = _resolve_chat_service(request)
    try:
        messages = svc.get_messages(chat_id)
    except ChatNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return [ChatMessagePayload(**m) for m in messages]


@router.delete(
    "/chats/{chat_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_chat_session(chat_id: str, request: Request) -> None:
    """Delete a chat session and all its messages."""
    svc = _resolve_chat_service(request)
    try:
        svc.delete_session(chat_id)
    except ChatNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    "/chats/{chat_id}/stream",
    response_class=StreamingResponse,
)
async def stream_chat_message(
    chat_id: str,
    body: SendMessageRequest,
    request: Request,
) -> StreamingResponse:
    """Send a user message and stream the assistant reply as SSE.

    Each event is one of:
      data: {"type": "chunk", "content": "..."}
      data: {"type": "done", "messageId": "..."}
      data: {"type": "error", "message": "..."}
    """
    svc = _resolve_chat_service(request)
    try:
        svc.get_session(chat_id)  # fast 404 check before streaming
    except ChatNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return StreamingResponse(
        svc.stream_reply(chat_id, body.content),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
